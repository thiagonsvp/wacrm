import type { SupabaseClient } from '@supabase/supabase-js'

// ------------------------------------------------------------
// Channels other than WhatsApp.
//
// A person who writes from Instagram Direct or Messenger has no phone
// number. Meta identifies them by an opaque id that is scoped to the
// Page they wrote to (IGSID for Instagram, PSID for Messenger) — the
// same human writing to two different Pages is two different ids, and
// nothing links either id back to a phone.
//
// So identity here cannot reuse the WhatsApp path, which is entirely
// phone-based (see lib/contacts/dedupe.ts). Contacts carry a `channel`
// plus an `external_id`, unique per account and channel.
// ------------------------------------------------------------

export type MessagingChannel = 'whatsapp' | 'instagram' | 'messenger'

/** Meta's webhook `object` field → our channel. */
export function channelFromWebhookObject(object: string): MessagingChannel | null {
  if (object === 'instagram') return 'instagram'
  if (object === 'page') return 'messenger'
  return null
}

export interface MetaMessagingConfig {
  accountId: string
  pageId: string | null
  instagramAccountId: string | null
  /** Decrypted Page access token. */
  pageAccessToken: string
  instagramEnabled: boolean
  messengerEnabled: boolean
}

/**
 * Is this channel switched on for the account?
 *
 * Kept separate from "is the config active" so an operator can run
 * Messenger while leaving Instagram off (or the reverse) without
 * deleting credentials they will want back.
 */
export function channelEnabled(
  config: MetaMessagingConfig,
  channel: MessagingChannel,
): boolean {
  if (channel === 'instagram') return config.instagramEnabled
  if (channel === 'messenger') return config.messengerEnabled
  return false
}

export interface ChannelContactOutcome {
  contact: Record<string, unknown>
  wasCreated: boolean
}

/**
 * Find or create the contact behind a Direct/Messenger sender.
 *
 * Matched on (account, channel, external_id) — the partial unique index
 * from migration 049. Deliberately NOT matched against WhatsApp contacts
 * even when the display name is identical: merging a Direct identity
 * into a phone identity on a name match would silently fuse two
 * different people, and Meta gives us nothing that would justify it.
 */
export async function findOrCreateChannelContact(
  db: SupabaseClient,
  args: {
    accountId: string
    ownerUserId: string
    channel: MessagingChannel
    externalId: string
    name?: string | null
    avatarUrl?: string | null
  },
): Promise<ChannelContactOutcome | null> {
  const { accountId, ownerUserId, channel, externalId } = args

  const { data: existing, error: findErr } = await db
    .from('contacts')
    .select('*')
    .eq('account_id', accountId)
    .eq('channel', channel)
    .eq('external_id', externalId)
    .maybeSingle()

  if (findErr) {
    console.error('[messaging] contact lookup failed:', findErr)
    return null
  }

  if (existing) {
    // Only fill gaps. Meta's display name changes whenever the person
    // edits their profile, and an agent may have renamed the contact to
    // something more useful — overwriting either would be worse than a
    // slightly stale name.
    const patch: Record<string, unknown> = {}
    if (args.name && !existing.name) patch.name = args.name
    if (args.avatarUrl && !existing.avatar_url) patch.avatar_url = args.avatarUrl
    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString()
      await db.from('contacts').update(patch).eq('id', existing.id)
    }
    return { contact: existing, wasCreated: false }
  }

  const { data: created, error: createErr } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      channel,
      external_id: externalId,
      // No phone: the column is nullable since 049, and the phone
      // dedupe index is partial so a null simply is not indexed.
      phone: null,
      name: args.name || `${channel === 'instagram' ? 'Instagram' : 'Messenger'} ${externalId.slice(-6)}`,
      ...(args.avatarUrl ? { avatar_url: args.avatarUrl } : {}),
    })
    .select()
    .single()

  if (createErr) {
    // Lost a race with a concurrent delivery — re-read rather than drop
    // the message (same pattern as the WhatsApp inbound path).
    if (createErr.code === '23505') {
      const { data: raced } = await db
        .from('contacts')
        .select('*')
        .eq('account_id', accountId)
        .eq('channel', channel)
        .eq('external_id', externalId)
        .maybeSingle()
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('[messaging] contact create failed:', createErr)
    return null
  }

  return { contact: created, wasCreated: true }
}

/**
 * Find or create the conversation for a channel contact.
 *
 * Mirrors findOrCreateConversation in lib/whatsapp/inbound.ts, but
 * stamps the channel so the inbox can label the thread and the outbound
 * path knows which API to send through.
 */
export async function findOrCreateChannelConversation(
  db: SupabaseClient,
  args: {
    accountId: string
    ownerUserId: string
    contactId: string
    channel: MessagingChannel
  },
): Promise<{ conversation: Record<string, unknown>; created: boolean } | null> {
  const { data: existing } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (existing?.[0]) return { conversation: existing[0], created: false }

  const { data: created, error } = await db
    .from('conversations')
    .insert({
      account_id: args.accountId,
      user_id: args.ownerUserId,
      contact_id: args.contactId,
      channel: args.channel,
      status: 'pending',
    })
    .select()
    .single()

  if (error) {
    console.error('[messaging] conversation create failed:', error)
    return null
  }
  return { conversation: created, created: true }
}
