/**
 * UAZAPI (unofficial WhatsApp, QR-code / Baileys) HTTP client.
 *
 * Mirrors the style of `./evolution-api.ts` — named-params objects, a
 * `throwUazapiError` helper, no external deps beyond `fetch`. Auth is
 * the raw `token` header (not Bearer). Endpoints confirmed live
 * against a real UAZAPI server.
 */

interface UazapiErrorResponse {
  message?: string
  error?: string
}

async function throwUazapiError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as UazapiErrorResponse
    message = data.message ?? data.error ?? fallback
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

function baseHeaders(token: string): Record<string, string> {
  return { token, 'Content-Type': 'application/json' }
}

/**
 * Header do token de ADMINISTRADOR do servidor.
 *
 * Diferente de `baseHeaders`, que manda o token por-instância em
 * `token`. A uazapiGO v2.1.1 responde 401 ao admin token enviado como
 * `token` — verificado contra servidor real em 2026-08-31.
 */
function adminHeaders(adminToken: string): Record<string, string> {
  return { admintoken: adminToken, 'Content-Type': 'application/json' }
}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

// ============================================================
// Instance lifecycle
// ============================================================

export interface CreateInstanceArgs {
  baseUrl: string
  /** Admin token do servidor. Só ele pode criar instâncias. */
  adminToken: string
  name: string
  /** Marca de posse: o `account_id` da empresa dona. */
  adminField01?: string
}

export interface CreateInstanceResult {
  id: string
  /** Token por-instância, usado em todas as chamadas seguintes. */
  token: string
}

export async function createInstance(
  args: CreateInstanceArgs,
): Promise<CreateInstanceResult> {
  const { baseUrl, adminToken, name, adminField01 } = args
  const body: Record<string, unknown> = { name }
  if (adminField01) body.adminField01 = adminField01

  const response = await fetch(`${trimBaseUrl(baseUrl)}/instance/create`, {
    method: 'POST',
    headers: adminHeaders(adminToken),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwUazapiError(response, `UAZAPI error: ${response.status}`)
  }
  const data = await response.json()
  // A resposta traz o token no topo E dentro de `instance`. Ler os dois
  // evita depender de qual das duas formas o servidor usa na versão
  // instalada.
  const token: string | undefined = data?.token ?? data?.instance?.token
  const id: string | undefined = data?.instance?.id ?? data?.id
  if (!token) throw new Error('UAZAPI did not return an instance token.')
  if (!id) throw new Error('UAZAPI did not return an instance id.')
  return { id, token }
}

/**
 * Uma instância como o servidor a descreve. `token` está presente aqui
 * porque `/instance/all` o devolve — mas ele NUNCA pode ser serializado
 * para o browser. Use `toPublicInstance` de `uazapi-ownership.ts`.
 */
export interface UazapiInstance {
  id: string
  token: string
  name: string
  status: string
  owner?: string
  profileName?: string
  profilePicUrl?: string
  adminField01?: string
  adminField02?: string
  created?: string
}

export async function listInstances(args: {
  baseUrl: string
  adminToken: string
}): Promise<UazapiInstance[]> {
  const { baseUrl, adminToken } = args
  const response = await fetch(`${trimBaseUrl(baseUrl)}/instance/all`, {
    headers: adminHeaders(adminToken),
  })
  if (!response.ok) {
    await throwUazapiError(response, `UAZAPI error: ${response.status}`)
  }
  const data = await response.json()
  return Array.isArray(data) ? (data as UazapiInstance[]) : []
}

export async function stampAdminFields(args: {
  baseUrl: string
  adminToken: string
  id: string
  adminField01: string
}): Promise<void> {
  const { baseUrl, adminToken, id, adminField01 } = args
  const response = await fetch(
    `${trimBaseUrl(baseUrl)}/instance/updateAdminFields`,
    {
      method: 'POST',
      headers: adminHeaders(adminToken),
      body: JSON.stringify({ id, adminField01 }),
    },
  )
  if (!response.ok) {
    await throwUazapiError(response, `UAZAPI error: ${response.status}`)
  }
}

export async function renameInstance(args: {
  baseUrl: string
  /** Token da instância — renomear não é operação de admin. */
  token: string
  name: string
}): Promise<void> {
  const { baseUrl, token, name } = args
  const response = await fetch(
    `${trimBaseUrl(baseUrl)}/instance/updateInstanceName`,
    {
      method: 'POST',
      headers: baseHeaders(token),
      body: JSON.stringify({ name }),
    },
  )
  if (!response.ok) {
    await throwUazapiError(response, `UAZAPI error: ${response.status}`)
  }
}

export interface UazapiInstanceArgs {
  baseUrl: string
  token: string
}

export interface ConnectInstanceArgs extends UazapiInstanceArgs {
  phone?: string
}

export interface ConnectInstanceResult {
  qrcode?: string
  paircode?: string
}

export async function connectInstance(args: ConnectInstanceArgs): Promise<ConnectInstanceResult> {
  const { baseUrl, token, phone } = args
  const response = await fetch(`${trimBaseUrl(baseUrl)}/instance/connect`, {
    method: 'POST',
    headers: baseHeaders(token),
    body: JSON.stringify(phone ? { phone } : {}),
  })
  if (!response.ok) {
    await throwUazapiError(response, `UAZAPI error: ${response.status}`)
  }
  const data = await response.json()
  const rawQr: string | undefined = data?.qrcode || data?.instance?.qrcode
  const qrcode = rawQr
    ? rawQr.startsWith('data:')
      ? rawQr
      : `data:image/png;base64,${rawQr}`
    : undefined
  const paircode: string | undefined = data?.paircode || data?.instance?.paircode
  return { qrcode: qrcode || undefined, paircode: paircode || undefined }
}

export interface UazapiStatusResult {
  connected: boolean
  loggedIn?: boolean
  jid?: string
  status?: string
  /** Instance this token actually belongs to — the token is per-instance,
   *  so this is the authoritative answer to "whose credentials are these?"
   *  regardless of what the caller *says* it is saving. */
  instanceName?: string
  /** The WhatsApp number behind the instance. */
  owner?: string
  profileName?: string
}

export async function getInstanceStatus(args: UazapiInstanceArgs): Promise<UazapiStatusResult> {
  const { baseUrl, token } = args
  const response = await fetch(`${trimBaseUrl(baseUrl)}/instance/status`, {
    headers: baseHeaders(token),
  })
  if (!response.ok) {
    await throwUazapiError(response, `UAZAPI error: ${response.status}`)
  }
  const data = await response.json()
  return {
    connected: !!data?.status?.connected,
    loggedIn: data?.status?.loggedIn,
    jid: data?.status?.jid,
    status: data?.instance?.status,
    instanceName: data?.instance?.name || undefined,
    owner: data?.instance?.owner || undefined,
    profileName: data?.instance?.profileName || undefined,
  }
}

export async function disconnectInstance(args: UazapiInstanceArgs): Promise<void> {
  const { baseUrl, token } = args
  const response = await fetch(`${trimBaseUrl(baseUrl)}/instance/disconnect`, {
    method: 'POST',
    headers: baseHeaders(token),
  })
  if (!response.ok) {
    await throwUazapiError(response, `UAZAPI error: ${response.status}`)
  }
}

export async function deleteInstance(args: UazapiInstanceArgs): Promise<void> {
  const { baseUrl, token } = args
  const response = await fetch(`${trimBaseUrl(baseUrl)}/instance`, {
    method: 'DELETE',
    headers: baseHeaders(token),
  })
  if (response.status === 404) return
  if (!response.ok) {
    await throwUazapiError(response, `UAZAPI error: ${response.status}`)
  }
}

// ============================================================
// Webhook config
// ============================================================

export interface SetWebhookArgs extends UazapiInstanceArgs {
  webhookUrl: string
  /**
   * `false` desliga a entrega sem apagar a configuração. O bind usa
   * isso na instância que deixa de ser a vinculada, para que duas
   * instâncias nunca postem na mesma URL de webhook.
   */
  enabled?: boolean
}

export async function setWebhook(args: SetWebhookArgs): Promise<void> {
  const { baseUrl, token, webhookUrl, enabled = true } = args
  const response = await fetch(`${trimBaseUrl(baseUrl)}/webhook`, {
    method: 'POST',
    headers: baseHeaders(token),
    body: JSON.stringify({
      url: webhookUrl,
      enabled,
      events: ['messages', 'messages_update'],
      excludeMessages: ['wasSentByApi'],
    }),
  })
  if (!response.ok) {
    await throwUazapiError(response, `UAZAPI error: ${response.status}`)
  }
}

// ============================================================
// Inbound media
// ============================================================
//
// Inbound media/audio messages carry only an ENCRYPTED WhatsApp CDN
// URL (mmg.whatsapp.net/.../*.enc) plus a mediaKey — unusable directly
// as an <img>/<audio> src. UAZAPI decrypts it server-side and re-hosts
// the plaintext file; confirmed live against a real server.

export interface DownloadMediaArgs extends UazapiInstanceArgs {
  /** The message's `messageid` (short form, not the `owner:id` composite). */
  messageId: string
}

export interface DownloadMediaResult {
  fileUrl: string
  mimetype?: string
}

export async function downloadMedia(args: DownloadMediaArgs): Promise<DownloadMediaResult> {
  const { baseUrl, token, messageId } = args
  const response = await fetch(`${trimBaseUrl(baseUrl)}/message/download`, {
    method: 'POST',
    headers: baseHeaders(token),
    body: JSON.stringify({ id: messageId }),
  })
  if (!response.ok) {
    await throwUazapiError(response, `UAZAPI error: ${response.status}`)
  }
  const data = await response.json()
  if (!data?.fileURL) throw new Error('UAZAPI did not return a fileURL.')
  return { fileUrl: data.fileURL, mimetype: data.mimetype }
}

// ============================================================
// Sending
// ============================================================

export interface UazapiSendResult {
  messageId: string
}

export interface SendTextArgs extends UazapiInstanceArgs {
  number: string
  text: string
}

export async function sendText(args: SendTextArgs): Promise<UazapiSendResult> {
  const { baseUrl, token, number, text } = args
  const response = await fetch(`${trimBaseUrl(baseUrl)}/send/text`, {
    method: 'POST',
    headers: baseHeaders(token),
    body: JSON.stringify({ number, text }),
  })
  if (!response.ok) {
    await throwUazapiError(response, `UAZAPI error: ${response.status}`)
  }
  const data = await response.json()
  const messageId = data?.id ?? data?.key?.id ?? data?.messageid
  if (!messageId) throw new Error('UAZAPI did not return a message id.')
  return { messageId }
}

export type UazapiMediaKind = 'image' | 'video' | 'audio' | 'document' | 'ptt' | 'sticker'

export interface SendMediaArgs extends UazapiInstanceArgs {
  number: string
  type: UazapiMediaKind
  /** Public URL or base64. Passed through as given. */
  file: string
  caption?: string
}

export async function sendMedia(args: SendMediaArgs): Promise<UazapiSendResult> {
  const { baseUrl, token, number, type, file, caption } = args
  const body: Record<string, unknown> = { number, type, file }
  if (caption) body.caption = caption
  const response = await fetch(`${trimBaseUrl(baseUrl)}/send/media`, {
    method: 'POST',
    headers: baseHeaders(token),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwUazapiError(response, `UAZAPI error: ${response.status}`)
  }
  const data = await response.json()
  const messageId = data?.id ?? data?.key?.id ?? data?.messageid
  if (!messageId) throw new Error('UAZAPI did not return a message id.')
  return { messageId }
}
