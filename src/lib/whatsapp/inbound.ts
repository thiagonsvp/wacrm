import type { SupabaseClient } from '@supabase/supabase-js'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

/**
 * Provider-agnostic inbound-message persistence, extracted from the
 * Meta webhook's `processMessage` so the Evolution webhook can reuse
 * the exact same find-or-create-contact/conversation + insert-message
 * + engine-dispatch pipeline instead of a second hand-rolled copy.
 * Meta-specific parsing (media-id resolution, reactions, interactive
 * button/list taps, swipe-reply context) stays in the Meta webhook
 * route and is normalized to the params below before calling in here.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

export interface ContactOutcome {
  contact: Row
  /** True when this call created the row. */
  wasCreated: boolean
}

export async function findOrCreateContact(
  db: SupabaseClient,
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string,
): Promise<ContactOutcome | null> {
  const existingContact = await findExistingContact(db, accountId, phone)

  if (existingContact) {
    if (name && name !== existingContact.name) {
      await db
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existingContact.id)
    }
    return { contact: existingContact, wasCreated: false }
  }

  const { data: newContact, error: createError } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name: name || phone,
    })
    .select()
    .single()

  if (createError) {
    // Lost a race with a concurrent inbound delivery — re-resolve
    // instead of dropping the message (unique index from migration 022).
    if (isUniqueViolation(createError)) {
      const raced = await findExistingContact(db, accountId, phone)
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('[inbound] Error creating contact:', createError)
    return null
  }

  return { contact: newContact, wasCreated: true }
}

export interface ConversationOutcome {
  conversation: Row
  created: boolean
}

export async function findOrCreateConversation(
  db: SupabaseClient,
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
): Promise<ConversationOutcome | null> {
  const { data: existing, error: findError } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .single()

  if (!findError && existing) {
    return { conversation: existing, created: false }
  }

  const { data: newConv, error: createError } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId,
    })
    .select()
    .single()

  if (createError) {
    console.error('[inbound] Error creating conversation:', createError)
    return null
  }

  return { conversation: newConv, created: true }
}

/**
 * If this contact is on a still-unreplied broadcast, flip it to
 * `replied` so the parent broadcast's reply count advances. Best
 * effort — failures must never break the main inbound flow.
 */
export async function flagBroadcastReplyIfAny(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<void> {
  try {
    const { data: recs, error } = await db
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1)

    if (error || !recs || recs.length === 0) return

    const row = recs[0]
    const { error: updErr } = await db
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', row.id)

    if (updErr) {
      console.error('[inbound] Error marking broadcast recipient replied:', updErr)
    }
  } catch (err) {
    console.error('[inbound] flagBroadcastReplyIfAny failed:', err)
  }
}

/** Resolve a provider message id to our internal UUID, scoped to one conversation. */
export async function lookupInternalIdByExternalId(
  db: SupabaseClient,
  externalId: string,
  conversationId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('message_id', externalId)
    .eq('conversation_id', conversationId)
    .maybeSingle()
  if (error) {
    console.error('[inbound] lookupInternalIdByExternalId failed:', error.message)
    return null
  }
  return data?.id ?? null
}

export const ALLOWED_CONTENT_TYPES = new Set([
  'text', 'image', 'document', 'audio', 'video',
  'location', 'template', 'interactive',
])

export interface PersistInboundMessageParams {
  db: SupabaseClient
  accountId: string
  configOwnerUserId: string
  contact: Row
  contactWasCreated: boolean
  conversation: Row
  conversationWasCreated: boolean
  /** Already mapped onto the messages.content_type CHECK constraint. */
  contentType: string
  contentText: string | null
  mediaUrl: string | null
  /** Provider's message id (Meta wamid / Evolution key.id). */
  externalMessageId: string
  timestamp: Date
  interactiveReplyId?: string | null
  replyToInternalId?: string | null
}

/**
 * Insert the inbound message, update the conversation, and fan out to
 * every downstream consumer (broadcast reply flag, Flows, automations,
 * AI auto-reply, outbound webhooks) — identical to what the Meta
 * webhook did inline before this extraction.
 */
export async function persistInboundMessage(
  params: PersistInboundMessageParams,
): Promise<{ ok: boolean; flowConsumed: boolean }> {
  const {
    db,
    accountId,
    configOwnerUserId,
    contact,
    contactWasCreated,
    conversation,
    conversationWasCreated,
    contentType,
    contentText,
    mediaUrl,
    externalMessageId,
    timestamp,
    interactiveReplyId = null,
    replyToInternalId = null,
  } = params

  if (conversationWasCreated) {
    await dispatchWebhookEvent(db, accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contact.id,
    })
  }

  const { count: priorCustomerMsgCount } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  const { error: msgError } = await db.from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: contentType,
    content_text: contentText,
    media_url: mediaUrl,
    message_id: externalMessageId,
    status: 'delivered',
    created_at: timestamp.toISOString(),
    reply_to_message_id: replyToInternalId,
    interactive_reply_id: interactiveReplyId,
  })

  if (msgError) {
    console.error('[inbound] Error inserting message:', msgError)
    return { ok: false, flowConsumed: false }
  }

  const { error: convError } = await db
    .from('conversations')
    .update({
      last_message_text: contentText || `[${contentType}]`,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  if (convError) {
    console.error('[inbound] Error updating conversation:', convError)
  }

  await flagBroadcastReplyIfAny(db, accountId, contact.id)

  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contact.id,
    conversationId: conversation.id,
    message:
      interactiveReplyId
        ? {
            kind: 'interactive_reply',
            reply_id: interactiveReplyId,
            reply_title: contentText ?? '',
            meta_message_id: externalMessageId,
          }
        : {
            kind: 'text',
            text: contentText ?? '',
            meta_message_id: externalMessageId,
          },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  const inboundText = contentText ?? ''
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
    | 'interactive_reply'
  )[] = []
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
    if (interactiveReplyId) {
      automationTriggers.push('interactive_reply')
    }
  }
  if (contactWasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')
  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contact.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
        interactive_reply_id: interactiveReplyId ?? undefined,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err))
  }

  if (!flowConsumed && !interactiveReplyId && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId: conversation.id,
      contactId: contact.id,
      configOwnerUserId,
    })
  }

  await dispatchWebhookEvent(db, accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contact.id,
    whatsapp_message_id: externalMessageId,
    content_type: contentType,
    text: contentText,
  })

  return { ok: true, flowConsumed }
}
