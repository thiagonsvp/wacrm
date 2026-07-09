/**
 * Evolution API (unofficial WhatsApp, QR-code / Baileys) HTTP client.
 *
 * Mirrors the style of `../meta-api.ts` — named-params objects, a
 * `throwEvolutionError` helper, no external deps beyond `fetch`.
 * Docs: https://doc.evolution-api.com/
 */

interface EvolutionErrorResponse {
  message?: string | string[]
  error?: string
  response?: { message?: string | string[] }
}

async function throwEvolutionError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as EvolutionErrorResponse
    const raw = data.response?.message ?? data.message ?? data.error
    if (Array.isArray(raw)) message = raw.join('; ')
    else if (typeof raw === 'string') message = raw
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

function baseHeaders(apiKey: string): Record<string, string> {
  return { apikey: apiKey, 'Content-Type': 'application/json' }
}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

// ============================================================
// Instance lifecycle
// ============================================================

export interface CreateInstanceArgs {
  baseUrl: string
  apiKey: string
  instanceName: string
  /** Where Evolution should POST inbound events. Omit to skip webhook registration. */
  webhookUrl?: string
}

export interface CreateInstanceResult {
  instanceName: string
  qrcode?: { base64?: string; code?: string }
}

export async function createInstance(args: CreateInstanceArgs): Promise<CreateInstanceResult> {
  const { baseUrl, apiKey, instanceName, webhookUrl } = args
  const body: Record<string, unknown> = {
    instanceName,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
  }
  if (webhookUrl) {
    body.webhook = { url: webhookUrl, events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'] }
  }
  const response = await fetch(`${trimBaseUrl(baseUrl)}/instance/create`, {
    method: 'POST',
    headers: baseHeaders(apiKey),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error: ${response.status}`)
  }
  const data = await response.json()
  return {
    instanceName,
    qrcode: data.qrcode ?? undefined,
  }
}

export interface EvolutionInstanceArgs {
  baseUrl: string
  apiKey: string
  instanceName: string
}

export interface GetQrCodeResult {
  base64?: string
  code?: string
  /** True when Evolution reports the session is already connected (no QR to show). */
  alreadyConnected?: boolean
}

export async function getQrCode(args: EvolutionInstanceArgs): Promise<GetQrCodeResult> {
  const { baseUrl, apiKey, instanceName } = args
  const response = await fetch(
    `${trimBaseUrl(baseUrl)}/instance/connect/${encodeURIComponent(instanceName)}`,
    { headers: baseHeaders(apiKey) },
  )
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error: ${response.status}`)
  }
  const data = await response.json()
  if (data.base64 || data.code) {
    return { base64: data.base64, code: data.code }
  }
  // Evolution returns instance/connection info (no `base64`) once already paired.
  return { alreadyConnected: true }
}

export type EvolutionConnectionState = 'open' | 'connecting' | 'close'

export async function getConnectionState(
  args: EvolutionInstanceArgs,
): Promise<EvolutionConnectionState> {
  const { baseUrl, apiKey, instanceName } = args
  const response = await fetch(
    `${trimBaseUrl(baseUrl)}/instance/connectionState/${encodeURIComponent(instanceName)}`,
    { headers: baseHeaders(apiKey) },
  )
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error: ${response.status}`)
  }
  const data = await response.json()
  const state = data?.instance?.state ?? data?.state
  if (state === 'open' || state === 'connecting' || state === 'close') return state
  return 'close'
}

export interface SetWebhookArgs extends EvolutionInstanceArgs {
  webhookUrl: string
}

/**
 * Point the instance's webhook at `webhookUrl`, overwriting whatever
 * was configured before (e.g. a pre-existing instance wired to a
 * different consumer like n8n). Called unconditionally by the connect
 * flow so the CRM always ends up as the receiver, regardless of
 * whether the instance was just created or already existed.
 */
export async function setWebhook(args: SetWebhookArgs): Promise<void> {
  const { baseUrl, apiKey, instanceName, webhookUrl } = args
  const response = await fetch(
    `${trimBaseUrl(baseUrl)}/webhook/set/${encodeURIComponent(instanceName)}`,
    {
      method: 'POST',
      headers: baseHeaders(apiKey),
      body: JSON.stringify({
        webhook: {
          url: webhookUrl,
          enabled: true,
          events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
          webhookBase64: true,
        },
      }),
    },
  )
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error: ${response.status}`)
  }
}

export async function deleteInstance(args: EvolutionInstanceArgs): Promise<void> {
  const { baseUrl, apiKey, instanceName } = args
  const response = await fetch(
    `${trimBaseUrl(baseUrl)}/instance/delete/${encodeURIComponent(instanceName)}`,
    { method: 'DELETE', headers: baseHeaders(apiKey) },
  )
  // 404 means it's already gone — treat as success, same pattern as Meta's
  // deleteMessageTemplate.
  if (response.status === 404) return
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error: ${response.status}`)
  }
}

export async function logoutInstance(args: EvolutionInstanceArgs): Promise<void> {
  const { baseUrl, apiKey, instanceName } = args
  const response = await fetch(
    `${trimBaseUrl(baseUrl)}/instance/logout/${encodeURIComponent(instanceName)}`,
    { method: 'DELETE', headers: baseHeaders(apiKey) },
  )
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error: ${response.status}`)
  }
}

// ============================================================
// Sending
// ============================================================

export interface EvolutionSendResult {
  messageId: string
}

export interface SendTextArgs {
  baseUrl: string
  apiKey: string
  instanceName: string
  /** Recipient number, digits only (Evolution accepts plain E.164 digits without '+'). */
  number: string
  text: string
}

export async function sendText(args: SendTextArgs): Promise<EvolutionSendResult> {
  const { baseUrl, apiKey, instanceName, number, text } = args
  const response = await fetch(
    `${trimBaseUrl(baseUrl)}/message/sendText/${encodeURIComponent(instanceName)}`,
    {
      method: 'POST',
      headers: baseHeaders(apiKey),
      body: JSON.stringify({ number, text }),
    },
  )
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error: ${response.status}`)
  }
  const data = await response.json()
  const messageId = data?.key?.id
  if (!messageId) throw new Error('Evolution API did not return a message id.')
  return { messageId }
}

export type EvolutionMediaKind = 'image' | 'video' | 'document' | 'audio'

export interface SendMediaArgs {
  baseUrl: string
  apiKey: string
  instanceName: string
  number: string
  mediatype: EvolutionMediaKind
  /** Public URL Evolution fetches at send time. */
  media: string
  caption?: string
  fileName?: string
}

export async function sendMedia(args: SendMediaArgs): Promise<EvolutionSendResult> {
  const { baseUrl, apiKey, instanceName, number, mediatype, media, caption, fileName } = args
  const body: Record<string, unknown> = { number, mediatype, media }
  if (caption) body.caption = caption
  if (fileName) body.fileName = fileName
  const response = await fetch(
    `${trimBaseUrl(baseUrl)}/message/sendMedia/${encodeURIComponent(instanceName)}`,
    {
      method: 'POST',
      headers: baseHeaders(apiKey),
      body: JSON.stringify(body),
    },
  )
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error: ${response.status}`)
  }
  const data = await response.json()
  const messageId = data?.key?.id
  if (!messageId) throw new Error('Evolution API did not return a message id.')
  return { messageId }
}
