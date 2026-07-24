import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import {
  findOrCreateContact,
  findOrCreateConversation,
  persistInboundMessage,
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
  fromMe?: boolean
  isGroup?: boolean
  chatid?: string
  sender?: string
  /** Phone-based JID for the sender — reliable even when `sender`/`chatid` use `@lid` addressing. */
  sender_pn?: string
  senderName?: string
  /** Epoch MILLISECONDS (not seconds, unlike Evolution/raw Baileys). */
  messageTimestamp?: number
}

interface UazapiWebhookPayload {
  EventType?: string
  message?: UazapiMessage
  chat?: { wa_contactName?: string; lead_name?: string; name?: string }
  instanceName?: string
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

async function processUazapiWebhook(body: UazapiWebhookPayload, config: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (body.EventType !== 'messages') return

  const msg = body.message
  if (!msg || msg.fromMe || msg.isGroup) return

  // `chatid`/`sender` can be `@lid` (opaque linked-device id) for an
  // increasing share of traffic — `sender_pn` is UAZAPI's own
  // phone-based JID field for exactly that case.
  const rawJid = msg.chatid?.endsWith('@lid') && msg.sender_pn ? msg.sender_pn : msg.chatid
  if (!rawJid) return

  const phone = normalizePhone(rawJid.replace(/@.*/, ''))
  const contactName = body.chat?.wa_contactName || body.chat?.lead_name || msg.senderName || phone

  let contentType = inferContentType(msg)
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) contentType = 'text'
  const contentText = msg.text ?? null

  const db = supabaseAdmin()
  const contactOutcome = await findOrCreateContact(
    db,
    config.account_id,
    config.user_id,
    phone,
    contactName,
  )
  if (!contactOutcome) return

  const convResult = await findOrCreateConversation(
    db,
    config.account_id,
    config.user_id,
    contactOutcome.contact.id,
  )
  if (!convResult) return

  const timestamp = msg.messageTimestamp ? new Date(msg.messageTimestamp) : new Date()

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
    mediaUrl: null,
    externalMessageId: msg.messageid || msg.id || `uazapi-${Date.now()}`,
    timestamp,
  })
}
