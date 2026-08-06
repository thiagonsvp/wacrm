import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { decrypt } from '@/lib/whatsapp/encryption'
import { downloadMedia } from '@/lib/whatsapp/providers/uazapi'
import {
  findOrCreateContact,
  findOrCreateConversation,
  persistInboundMessage,
  persistAgentDeviceMessage,
  ALLOWED_CONTENT_TYPES,
} from '@/lib/whatsapp/inbound'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

// Matches the Meta webhook (api/whatsapp/webhook/route.ts). The `after()`
// callback below runs within this route's max duration, and that callback
// owns the whole inbound chain — media download, profile photo fetch,
// contact/conversation/message writes, flows, automations, AI reply. The
// platform default is far too tight for that, and anything still running
// when it expires is killed silently.
export const maxDuration = 60

/**
 * POST /api/whatsapp/webhook/uazapi/[configId]
 *
 * Auth: UAZAPI's webhook config (POST /webhook, see providers/uazapi.ts
 * `setWebhook`) has no documented per-call signature/token header, so
 * the account is identified by an unguessable UUID path segment
 * (`whatsapp_config.id`) baked into the URL we register — the same
 * security property a bearer token would give, without depending on
 * an unconfirmed header format.
 *
 * Always resolves to 200 (mirroring the Meta/Evolution webhooks'
 * retry-avoidance practice), except for an unknown configId.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ configId: string }> },
) {
  const { configId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // TEMP DIAGNOSTIC — remove once the UAZAPI inbound payload shape is
  // confirmed against real traffic. Best-effort, must never break the
  // main processing path below.
  try {
    await supabaseAdmin()
      .from('whatsapp_webhook_debug')
      .insert({ provider: 'uazapi', raw_body: body })
  } catch (err) {
    console.error('[uazapi-webhook] TEMP DIAGNOSTIC insert failed:', err)
  }

  const { data: config, error: configError } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('*')
    .eq('provider', 'uazapi')
    .eq('id', configId)
    .maybeSingle()

  if (configError || !config) {
    console.error('[uazapi-webhook] no config for id:', configId, configError)
    return NextResponse.json({ status: 'ignored' }, { status: 200 })
  }

  warnOnInstanceMismatch(body as UazapiWebhookPayload & { token?: string }, config)

  after(async () => {
    try {
      await processUazapiWebhook(body as UazapiWebhookPayload, config)
    } catch (error) {
      console.error('[uazapi-webhook] processing error:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

// Confirmed live against real UAZAPI traffic (captured via the TEMP
// DIAGNOSTIC table above) — NOT a Baileys `key`/`message` envelope
// like Evolution. UAZAPI flattens the message and includes rich
// `chat` metadata alongside it.
interface UazapiMessage {
  messageid?: string
  id?: string
  text?: string
  type?: string
  messageType?: string
  fromMe?: boolean | string
  from_me?: boolean | string
  isFromMe?: boolean | string
  isGroup?: boolean
  chatid?: string
  sender?: string
  /** Phone-based JID for the sender — reliable even when `sender`/`chatid` use `@lid` addressing. */
  sender_pn?: string
  senderName?: string
  /** Epoch MILLISECONDS (not seconds, unlike Evolution/raw Baileys). */
  messageTimestamp?: number
  content?: {
    contextInfo?: {
      externalAdReply?: {
        sourceID?: string
        sourceId?: string
        sourceApp?: string
        sourceURL?: string
        sourceUrl?: string
        sourceType?: string
        title?: string
        body?: string
        ctwaClid?: string
        thumbnailUrl?: string
        thumbnail_url?: string
      }
    }
  }
}

interface UazapiWebhookPayload {
  EventType?: string
  message?: UazapiMessage
  chat?: { wa_contactName?: string; lead_name?: string; name?: string; image?: string; imagePreview?: string; chatid?: string; wa_chatid?: string; phone?: string; wa_phone?: string }
  instanceName?: string
  /** The sending instance's own token — used to detect a config mismatch. */
  token?: string
}

const MEDIA_TYPE_MAP: Record<string, string> = {
  image: 'image',
  video: 'video',
  document: 'document',
  audio: 'audio',
  ptt: 'audio',
}

function inferContentType(msg: UazapiMessage): string {
  const messageType = (msg.messageType || '').toLowerCase()
  for (const [needle, contentType] of Object.entries(MEDIA_TYPE_MAP)) {
    if (messageType.includes(needle)) return contentType
  }
  return 'text'
}

const MEDIA_CONTENT_TYPES = new Set(['image', 'video', 'audio', 'document'])

async function fetchFullProfilePhoto(config: any, phone: string): Promise<string | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!config.uazapi_base_url || !config.uazapi_token || !config.uazapi_instance_name) return null
  try {
    const token = decrypt(config.uazapi_token)
    const response = await fetch(
      `${config.uazapi_base_url.replace(/\/+$/, '')}/chat/fetchProfilePictureUrl/${encodeURIComponent(config.uazapi_instance_name)}`,
      {
        method: 'POST',
        headers: { token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: phone }),
      },
    )
    if (!response.ok) return null
    const data = await response.json()
    return data?.profilePictureUrl || data?.profile_picture_url || data?.url || null
  } catch (error) {
    console.warn('[uazapi-webhook] full profile photo lookup failed:', error)
    return null
  }
}

function extractAcquisition(msg: UazapiMessage) {
  const ad = msg.content?.contextInfo?.externalAdReply
  if (!ad) return undefined
  const sourceUrl = ad.sourceURL || ad.sourceUrl || null
  const sourceText = `${ad.sourceApp || ''} ${sourceUrl || ''}`.toLowerCase()
  const source = sourceText.includes('instagram')
    ? 'Instagram' as const
    : sourceText.includes('facebook')
      ? 'Facebook' as const
      : null
  return {
    source,
    sourceId: ad.sourceID || ad.sourceId || null,
    campaign: ad.title || null,
    adText: ad.body || null,
    url: sourceUrl,
    avatarUrl: null,
    // The click id is what makes a later conversion attributable to the
    // ad that produced it. It only ever appears on the FIRST message
    // after the click, so if it is not stored now it is gone for good.
    ctwaClid: ad.ctwaClid || null,
    adImageUrl: ad.thumbnailUrl || ad.thumbnail_url || null,
  }
}

/**
 * Warn when the instance that sent this event is not the instance our
 * stored credentials belong to.
 *
 * UAZAPI includes the sending instance's own token in every webhook body,
 * which makes this a free integrity check. It exists because on
 * 2026-08-06 an admin saved company B's credentials while still switched
 * into company A: text kept flowing (the webhook needs no auth), but every
 * media download authenticated as B and came back "Message not found",
 * silently storing 60 attachments with a null media_url. Nothing surfaced
 * the mismatch until someone opened a conversation days later.
 */
function warnOnInstanceMismatch(
  body: UazapiWebhookPayload & { token?: string; instanceName?: string },
  config: any, // eslint-disable-line @typescript-eslint/no-explicit-any
): void {
  if (!body?.token) return
  try {
    if (decrypt(config.uazapi_token) === body.token) return
  } catch {
    return // token undecryptable — a different problem, reported elsewhere
  }
  console.error(
    '[uazapi-webhook] CONFIG MISMATCH: event came from instance ' +
      `"${body.instanceName ?? 'unknown'}" but account ${config.account_id} has ` +
      `"${config.uazapi_instance_name}" stored. Media downloads WILL fail ` +
      '("Message not found") until the correct token is saved for this company.',
  )
}

/**
 * Resolve the plaintext, publicly-fetchable URL for a media message.
 * Best-effort — the message still gets persisted (with a null
 * mediaUrl) if this fails, rather than dropping it.
 */
async function resolveMediaUrl(
  config: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  contentType: string,
  messageId: string,
): Promise<string | null> {
  if (!MEDIA_CONTENT_TYPES.has(contentType)) return null
  try {
    const token = decrypt(config.uazapi_token)
    const result = await downloadMedia({ baseUrl: config.uazapi_base_url, token, messageId })
    return result.fileUrl
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // "Message not found" almost always means the stored token belongs to
    // a different instance than the one that received the message, not
    // that the media is gone — name it so the next reader isn't hunting
    // through UAZAPI internals.
    const hint = /not found/i.test(message)
      ? ` — instance "${config.uazapi_instance_name}" does not know message ${messageId}; the stored token likely belongs to another instance`
      : ''
    console.error(`[uazapi-webhook] media download failed: ${message}${hint}`)
    return null
  }
}

async function processUazapiWebhook(body: UazapiWebhookPayload, config: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (body.EventType !== 'messages') return

  const msg = body.message
  if (!msg || msg.isGroup) return

  // `chatid` identifies the CHAT (the lead), regardless of who sent
  // this particular message — never the sender. It can be `@lid`
  // (opaque linked-device id); `sender_pn` is a safe phone-based
  // fallback ONLY for inbound (non-fromMe) messages, where the sender
  // IS the chat partner. For an agent-device (fromMe) message the
  // sender is the agent's own number, so no such fallback applies —
  // skip rather than risk misattributing to the wrong contact.
  const fromMe = [msg.fromMe, msg.from_me, msg.isFromMe].some(
    value => value === true || value === 'true' || value === '1',
  )
  const chat = body.chat
  const chatIdentity = msg.chatid || chat?.chatid || chat?.wa_chatid || chat?.phone || chat?.wa_phone
  const rawJid = chatIdentity?.endsWith('@lid') && msg.sender_pn && !fromMe
    ? msg.sender_pn
    : chatIdentity
  if (!rawJid || rawJid.endsWith('@lid')) return

  const phone = normalizePhone(rawJid.replace(/@.*/, ''))

  let contentType = inferContentType(msg)
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) contentType = 'text'
  const contentText = msg.text ?? null
  const timestamp = msg.messageTimestamp ? new Date(msg.messageTimestamp) : new Date()
  const externalMessageId = msg.messageid || msg.id || `uazapi-${Date.now()}`

  const db = supabaseAdmin()
  const mediaUrl = await resolveMediaUrl(config, contentType, externalMessageId)

  if (fromMe) {
    // Sent from the agent's own linked phone, not through the CRM
    // (UAZAPI's `excludeMessages: wasSentByApi` keeps CRM-originated
    // sends from ever reaching this webhook). The chat id identifies the
    // lead, so bootstrap the contact/conversation when the agent starts
    // the conversation from WhatsApp. Previously this returned early for
    // new leads, dropping the initial messages from the CRM entirely.
    const contactName = body.chat?.wa_contactName || body.chat?.lead_name || phone
    const contactOutcome = await findOrCreateContact(
      db,
      config.account_id,
      config.user_id,
      phone,
      contactName,
      { avatarUrl: body.chat?.image || body.chat?.imagePreview || null },
    )
    if (!contactOutcome) return
    const convResult = await findOrCreateConversation(db, config.account_id, config.user_id, contactOutcome.contact.id)
    if (!convResult) return
    await persistAgentDeviceMessage({
      db,
      conversation: convResult.conversation,
      contentType,
      contentText,
      mediaUrl,
      externalMessageId,
      timestamp,
    })
    return
  }

  const contactName = body.chat?.wa_contactName || body.chat?.lead_name || msg.senderName || phone
  const acquisition = extractAcquisition(msg)
  // `imagePreview` is a small thumbnail; prefer the full profile image.
  const avatarUrl = await fetchFullProfilePhoto(config, phone)
    || body.chat?.image
    || body.chat?.imagePreview
    || null

  const contactOutcome = await findOrCreateContact(
    db,
    config.account_id,
    config.user_id,
    phone,
    contactName,
    { ...acquisition, avatarUrl },
  )
  if (!contactOutcome) return

  const convResult = await findOrCreateConversation(
    db,
    config.account_id,
    config.user_id,
    contactOutcome.contact.id,
  )
  if (!convResult) return

  await persistInboundMessage({
    db,
    accountId: config.account_id,
    configOwnerUserId: config.user_id,
    contact: contactOutcome.contact,
    contactWasCreated: contactOutcome.wasCreated,
    conversation: convResult.conversation,
    conversationWasCreated: convResult.created,
    contentType,
    contentText,
    mediaUrl,
    externalMessageId,
    timestamp,
  })
}
