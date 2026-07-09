import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
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

interface EvolutionMessageKey {
  remoteJid: string
  fromMe: boolean
  id: string
}

interface EvolutionMessageContent {
  conversation?: string
  extendedTextMessage?: { text: string }
  imageMessage?: { caption?: string }
  videoMessage?: { caption?: string }
  documentMessage?: { caption?: string; fileName?: string }
  audioMessage?: Record<string, unknown>
}

interface EvolutionUpsertPayload {
  event: 'messages.upsert'
  instance: string
  data: {
    key: EvolutionMessageKey
    message?: EvolutionMessageContent
    messageTimestamp?: number
    pushName?: string
  }
}

interface EvolutionConnectionPayload {
  event: 'connection.update'
  instance: string
  data: { state?: string }
}

type EvolutionWebhookPayload = EvolutionUpsertPayload | EvolutionConnectionPayload | { event: string; instance: string; data: unknown }

/**
 * POST /api/whatsapp/webhook/evolution
 *
 * Auth: `x-webhook-token` header compared against the account's
 * `evolution_api_key` (decrypted). Reusing the API key rather than a
 * dedicated webhook-secret column avoids a schema addition for a
 * single-tenant-per-instance setup — the same key already gates every
 * outbound call Evolution accepts from us, so an attacker who has it
 * could impersonate us regardless.
 *
 * Always resolves to 200 (mirroring the Meta webhook's retry-avoidance
 * practice) except for a missing/invalid token, which 401s.
 */
export async function POST(request: Request) {
  let body: EvolutionWebhookPayload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const instanceName = body.instance
  if (!instanceName) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 })
  }

  const { data: config, error: configError } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('*')
    .eq('provider', 'evolution')
    .eq('evolution_instance_name', instanceName)
    .maybeSingle()

  if (configError || !config) {
    console.error('[evolution-webhook] no config for instance:', instanceName, configError)
    return NextResponse.json({ status: 'ignored' }, { status: 200 })
  }

  const providedToken = request.headers.get('x-webhook-token')
  let expectedToken: string
  try {
    expectedToken = config.evolution_api_key ? decrypt(config.evolution_api_key) : ''
  } catch (err) {
    console.error('[evolution-webhook] failed to decrypt evolution_api_key:', err)
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 401 })
  }
  if (!expectedToken || providedToken !== expectedToken) {
    console.warn('[evolution-webhook] rejected request with invalid webhook token')
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  after(async () => {
    try {
      await processEvolutionWebhook(body, config)
    } catch (error) {
      console.error('[evolution-webhook] processing error:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processEvolutionWebhook(body: EvolutionWebhookPayload, config: any) {
  if (body.event === 'connection.update') {
    const state = (body as EvolutionConnectionPayload).data?.state
    const status = state === 'open' ? 'connected' : state === 'close' ? 'disconnected' : undefined
    if (status) {
      const { error } = await supabaseAdmin()
        .from('whatsapp_config')
        .update({ status, connected_at: status === 'connected' ? new Date().toISOString() : config.connected_at })
        .eq('id', config.id)
      if (error) console.error('[evolution-webhook] status update failed:', error)
    }
    return
  }

  if (body.event !== 'messages.upsert') return

  const data = (body as EvolutionUpsertPayload).data
  if (!data?.key || data.key.fromMe) return

  const phone = normalizePhone(data.key.remoteJid.replace(/@.*/, ''))
  const contactName = data.pushName || phone
  const msg = data.message ?? {}

  // Media download isn't implemented for Evolution yet — only text /
  // captions are persisted; mediaUrl stays null until a follow-up adds
  // base64 → proxy-URL handling analogous to the Meta media proxy.
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
