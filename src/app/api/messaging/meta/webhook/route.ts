import { NextResponse, after } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  channelFromWebhookObject,
  findOrCreateChannelContact,
  findOrCreateChannelConversation,
  type MessagingChannel,
} from '@/lib/messaging/channels'

/**
 * Instagram Direct + Messenger inbound.
 *
 * Both channels arrive on this one endpoint; Meta distinguishes them by
 * the payload's `object` field ("instagram" vs "page"). The account is
 * resolved from the recipient id, which is the Page id for Messenger and
 * the Instagram account id for Direct — both unique per deployment
 * (migration 049).
 *
 * Mirrors the WhatsApp webhook's shape deliberately: verify fast, ack
 * within Meta's timeout, and do the work inside `after()` so a slow
 * database write never turns into a retry storm. The processing runs to
 * completion because `after()` hands the callback to the runtime rather
 * than leaving a floating promise (see issue #301 and the comment in
 * api/whatsapp/webhook/route.ts).
 */

export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

/**
 * GET — Meta's subscription handshake.
 *
 * The token is compared against the one stored for the account rather
 * than a single deployment-wide env var, so each company can register
 * its own webhook with its own secret.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode !== 'subscribe' || !token) {
    return new NextResponse('Bad Request', { status: 400 })
  }

  const { data } = await supabaseAdmin()
    .from('meta_messaging_configs')
    .select('id')
    .eq('verify_token', token)
    .maybeSingle()

  if (!data) return new NextResponse('Forbidden', { status: 403 })
  return new NextResponse(challenge ?? '', { status: 200 })
}

interface MetaMessagingEvent {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: {
    mid?: string
    text?: string
    is_echo?: boolean
    attachments?: { type?: string; payload?: { url?: string } }[]
  }
}

interface MetaWebhookBody {
  object?: string
  entry?: { id?: string; time?: number; messaging?: MetaMessagingEvent[] }[]
}

export async function POST(request: Request) {
  const raw = await request.text()

  let body: MetaWebhookBody
  try {
    body = JSON.parse(raw) as MetaWebhookBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const channel = channelFromWebhookObject(body.object ?? '')
  if (!channel) {
    // Another product on the same app (WhatsApp, page feed…) — not ours.
    return NextResponse.json({ status: 'ignored' }, { status: 200 })
  }

  // Signature is verified against the app secret when one is configured.
  // Meta signs every delivery; skipping the check would let anyone who
  // learns the URL inject messages into a customer's inbox.
  const appSecret = process.env.META_APP_SECRET
  if (appSecret) {
    const signature = request.headers.get('x-hub-signature-256') ?? ''
    const expected =
      'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex')
    const ok =
      signature.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    if (!ok) {
      console.warn('[meta-messaging] rejected a delivery with a bad signature')
      return NextResponse.json({ error: 'Bad signature' }, { status: 401 })
    }
  }

  after(async () => {
    try {
      await processMetaMessaging(body, channel)
    } catch (err) {
      console.error('[meta-messaging] processing error:', err)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processMetaMessaging(body: MetaWebhookBody, channel: MessagingChannel) {
  const db = supabaseAdmin()

  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      // Echoes are our own outbound coming back. They already exist in
      // the thread, so persisting them would duplicate every reply.
      if (event.message?.is_echo) continue

      const senderId = event.sender?.id
      const recipientId = event.recipient?.id
      if (!senderId || !recipientId) continue

      // The recipient is the business: the Page for Messenger, the
      // Instagram account for Direct. `entry.id` is the same value on
      // most payloads, and is the fallback when recipient is absent.
      const businessId = recipientId || entry.id
      const column = channel === 'instagram' ? 'instagram_account_id' : 'page_id'

      const { data: config } = await db
        .from('meta_messaging_configs')
        .select('*')
        .eq(column, businessId)
        .maybeSingle()

      if (!config || !config.is_active) continue
      if (channel === 'instagram' && !config.instagram_enabled) continue
      if (channel === 'messenger' && !config.messenger_enabled) continue

      const { data: owner } = await db
        .from('profiles')
        .select('user_id')
        .eq('account_id', config.account_id)
        .eq('account_role', 'owner')
        .maybeSingle()
      const ownerUserId = owner?.user_id ?? config.created_by
      if (!ownerUserId) continue

      const profile = await fetchSenderProfile(config, senderId, channel)

      const contactOutcome = await findOrCreateChannelContact(db, {
        accountId: config.account_id,
        ownerUserId,
        channel,
        externalId: senderId,
        name: profile?.name ?? null,
        avatarUrl: profile?.avatarUrl ?? null,
      })
      if (!contactOutcome) continue

      const convOutcome = await findOrCreateChannelConversation(db, {
        accountId: config.account_id,
        ownerUserId,
        contactId: contactOutcome.contact.id as string,
        channel,
      })
      if (!convOutcome) continue

      const text = event.message?.text ?? null
      const attachment = event.message?.attachments?.[0]
      const contentType = attachmentContentType(attachment?.type)
      const timestamp = event.timestamp ? new Date(event.timestamp) : new Date()

      const { error: msgErr } = await db.from('messages').insert({
        conversation_id: convOutcome.conversation.id,
        sender_type: 'customer',
        content_type: contentType,
        content_text: text,
        media_url: attachment?.payload?.url ?? null,
        message_id: event.message?.mid ?? `meta-${Date.now()}`,
        status: 'delivered',
        created_at: timestamp.toISOString(),
      })
      if (msgErr) {
        console.error('[meta-messaging] message insert failed:', msgErr)
        continue
      }

      await db
        .from('conversations')
        .update({
          last_message_text: text || `[${contentType}]`,
          last_message_at: new Date().toISOString(),
          unread_count: (convOutcome.conversation.unread_count as number || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', convOutcome.conversation.id)
    }
  }
}

/** Meta's attachment types → the CHECK-constrained set on `messages`. */
function attachmentContentType(type?: string): string {
  switch (type) {
    case 'image':
      return 'image'
    case 'video':
      return 'video'
    case 'audio':
      return 'audio'
    case 'file':
      return 'document'
    default:
      return 'text'
  }
}

/**
 * Look up the sender's display name and picture. Best effort: Direct
 * senders are often not resolvable (privacy settings, or the person
 * never interacted with the Page before), and a message with a
 * placeholder name is far better than a dropped one.
 */
async function fetchSenderProfile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any,
  senderId: string,
  channel: MessagingChannel,
): Promise<{ name: string | null; avatarUrl: string | null } | null> {
  if (!config.page_access_token) return null
  try {
    const token = decrypt(config.page_access_token)
    const fields = channel === 'instagram' ? 'name,username,profile_pic' : 'name,profile_pic'
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(senderId)}?fields=${fields}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) return null
    const data = await res.json()
    return {
      name: data?.name ?? data?.username ?? null,
      avatarUrl: data?.profile_pic ?? null,
    }
  } catch (err) {
    console.warn('[meta-messaging] sender profile lookup failed:', err)
    return null
  }
}
