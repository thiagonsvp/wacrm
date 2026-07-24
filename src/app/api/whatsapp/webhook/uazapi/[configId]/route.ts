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
      await processUazapiWebhook(body, config)
    } catch (error) {
      console.error('[uazapi-webhook] processing error:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

// Baileys-like shape, mirroring the Evolution webhook's payload —
// UNCONFIRMED for UAZAPI (docs could not be scraped). Both APIs wrap
// Baileys under the hood, so this is the best available guess; the
// TEMP DIAGNOSTIC table above exists specifically to verify/correct
// this shape against real deliveries.
interface UazapiMessageKey {
  remoteJid: string
  fromMe: boolean
  id: string
  remoteJidAlt?: string
}

interface UazapiMessageContent {
  conversation?: string
  extendedTextMessage?: { text: string }
  imageMessage?: { caption?: string }
  videoMessage?: { caption?: string }
  documentMessage?: { caption?: string; fileName?: string }
  audioMessage?: Record<string, unknown>
}

interface UazapiUpsertLike {
  key?: UazapiMessageKey
  message?: UazapiMessageContent
  messageTimestamp?: number
  pushName?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processUazapiWebhook(body: any, config: any) {
  // UAZAPI may nest the message under `.message`/`.data`, or send it
  // flat at the top level — try both since the exact envelope is
  // unconfirmed.
  const data: UazapiUpsertLike | undefined = body?.message ?? body?.data ?? body

  if (!data?.key || data.key.fromMe) return

  const rawJid = data.key.remoteJid?.endsWith('@lid') && data.key.remoteJidAlt
    ? data.key.remoteJidAlt
    : data.key.remoteJid
  if (!rawJid) return

  const phone = normalizePhone(rawJid.replace(/@.*/, ''))
  const contactName = data.pushName || phone
  const msg = data.message ?? {}

  let contentText: string | null = null
  let contentType = 'text'
  if (msg.conversation) {
    contentText = msg.conversation
  } else if (msg.extendedTextMessage?.text) {
    contentText = msg.extendedTextMessage.text
  } else if (msg.imageMessage) {
    contentType = 'image'
    contentText = msg.imageMessage.caption ?? null
  } else if (msg.videoMessage) {
    contentType = 'video'
    contentText = msg.videoMessage.caption ?? null
  } else if (msg.documentMessage) {
    contentType = 'document'
    contentText = msg.documentMessage.caption ?? msg.documentMessage.fileName ?? null
  } else if (msg.audioMessage) {
    contentType = 'audio'
  }
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) contentType = 'text'

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

  const timestamp = data.messageTimestamp
    ? new Date(data.messageTimestamp * 1000)
    : new Date()

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
    externalMessageId: data.key.id,
    timestamp,
  })
}
