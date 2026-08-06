import crypto from 'crypto'

// ------------------------------------------------------------
// Meta Conversions API — Business Messaging (Click-to-WhatsApp).
//
// Sends the outcomes this CRM already knows about (a lead qualified, a
// deal won) back to Meta, so ads that click to WhatsApp can optimise for
// real sales instead of for raw message volume.
//
// Docs: https://developers.facebook.com/documentation/ads-commerce/conversions-api/business-messaging
//
// The whole feature hinges on `ctwa_clid`, the click id Meta puts on the
// FIRST message after an ad click. Without it Meta accepts the event and
// attributes it to nothing, which looks like success and silently buys
// no optimisation at all.
// ------------------------------------------------------------

const GRAPH_VERSION = 'v21.0'
const REQUEST_TIMEOUT_MS = 10_000

/**
 * Meta rejects an event whose `event_time` is more than 7 days old — and
 * rejects the ENTIRE request, processing none of it, if a single event
 * in the batch is stale. Callers must filter before batching; we keep a
 * safety margin so an event sitting in a retry queue near the boundary
 * doesn't poison a whole send.
 */
export const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000
const AGE_SAFETY_MARGIN_MS = 60 * 60 * 1000

/** Event names this integration sends. Both are Meta standard events. */
export type MetaEventName = 'QualifiedLead' | 'Purchase'

export interface MetaCapiConfig {
  datasetId: string
  /** Decrypted token. */
  accessToken: string
  /** WhatsApp Business Account id — required by Meta for this channel. */
  wabaId: string | null
  /** When set, events land in Events Manager's Test Events tab instead
   *  of counting as real conversions. */
  testEventCode: string | null
}

export interface MetaCapiEvent {
  eventName: MetaEventName
  /** Idempotency key echoed to Meta, which dedupes on it. */
  eventId: string
  /** When the conversion happened (not when we send it). */
  eventTime: Date
  ctwaClid: string
  /** Customer phone in E.164 without '+', hashed before sending. */
  phone?: string | null
  value?: number | null
  currency?: string | null
}

export interface MetaCapiResult {
  ok: boolean
  /** Events Meta reported as received. */
  received?: number
  error?: string
  /** True when retrying could plausibly succeed (network, 5xx, throttle). */
  retryable?: boolean
}

/**
 * Meta requires customer identifiers to be SHA-256 hashed, lowercase and
 * whitespace-trimmed, before they leave our server. `ctwa_clid` is the
 * exception — it is Meta's own opaque token and must be sent as-is;
 * hashing it would make attribution impossible.
 */
export function hashIdentifier(raw: string): string {
  return crypto.createHash('sha256').update(raw.trim().toLowerCase()).digest('hex')
}

/** Digits only, no leading '+' — Meta's normalisation for phone before hashing. */
export function normalizePhoneForHash(phone: string): string {
  return phone.replace(/\D/g, '')
}

/** True when this event is still inside Meta's 7-day acceptance window. */
export function isWithinEventWindow(eventTime: Date, now: Date = new Date()): boolean {
  const age = now.getTime() - eventTime.getTime()
  // A future timestamp is a clock problem, not an acceptable event.
  if (age < 0) return false
  return age <= MAX_EVENT_AGE_MS - AGE_SAFETY_MARGIN_MS
}

/** Build the `data` entry for one event. Exported for testing. */
export function buildEventPayload(
  event: MetaCapiEvent,
  config: MetaCapiConfig,
): Record<string, unknown> {
  const userData: Record<string, unknown> = {
  }
  // The Business Messaging contract is only valid for the official
  // WhatsApp Cloud API. UAZAPI has no WABA id, so use a generic dataset
  // event and do not send WhatsApp-only fields.
  const isBusinessMessaging = Boolean(config.wabaId)
  if (isBusinessMessaging) {
    userData.ctwa_clid = event.ctwaClid
    userData.whatsapp_business_account_id = config.wabaId
  }
  if (event.phone) {
    userData.ph = hashIdentifier(normalizePhoneForHash(event.phone))
  }

  const payload: Record<string, unknown> = {
    event_name: event.eventName,
    event_time: Math.floor(event.eventTime.getTime() / 1000),
    event_id: event.eventId,
    action_source: isBusinessMessaging ? 'business_messaging' : 'other',
    user_data: userData,
  }
  if (isBusinessMessaging) payload.messaging_channel = 'whatsapp'

  // Only attach custom_data when there is a real amount. Sending
  // value: 0 would teach Meta that these conversions are worthless.
  if (event.value != null && event.value > 0) {
    payload.custom_data = {
      currency: (event.currency ?? 'USD').toUpperCase(),
      value: event.value,
    }
  }

  return payload
}

/**
 * POST one event to the Conversions API.
 *
 * Deliberately one event per request rather than batching: a single
 * stale or malformed event makes Meta reject the whole batch, so
 * batching would let one bad deal silently drop every other conversion
 * sent alongside it.
 *
 * Never throws — returns a typed result the caller records in the
 * `meta_capi_events` ledger.
 */
export async function sendMetaCapiEvent(
  event: MetaCapiEvent,
  config: MetaCapiConfig,
): Promise<MetaCapiResult> {
  if (config.wabaId && !event.ctwaClid) {
    return { ok: false, error: 'missing ctwa_clid — event would not be attributable' }
  }
  if (!isWithinEventWindow(event.eventTime)) {
    return {
      ok: false,
      error: 'event_time is outside Meta\'s 7-day acceptance window',
    }
  }

  const body: Record<string, unknown> = {
    data: [buildEventPayload(event, config)],
  }
  if (config.testEventCode) body.test_event_code = config.testEventCode

  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/` +
    `${encodeURIComponent(config.datasetId)}/events`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Bearer header rather than ?access_token= so the token never
        // lands in an access log or an error URL.
        Authorization: `Bearer ${config.accessToken}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const text = await res.text()
    let parsed: Record<string, unknown> | null = null
    try {
      parsed = JSON.parse(text) as Record<string, unknown>
    } catch {
      // Meta returned something non-JSON (gateway error page, etc).
    }

    if (!res.ok) {
      const metaError = (parsed?.error ?? null) as { message?: string } | null
      return {
        ok: false,
        error: metaError?.message ?? `HTTP ${res.status}: ${text.slice(0, 200)}`,
        // 4xx is our payload's fault and will fail identically on retry;
        // 429/5xx is Meta's side and may clear.
        retryable: res.status === 429 || res.status >= 500,
      }
    }

    return { ok: true, received: Number(parsed?.events_received ?? 1) }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    return {
      ok: false,
      error: aborted
        ? `timed out after ${REQUEST_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err),
      retryable: true,
    }
  } finally {
    clearTimeout(timer)
  }
}
