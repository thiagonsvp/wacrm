import type { MessagingChannel } from './channels'

// ------------------------------------------------------------
// Outbound for Instagram Direct and Messenger.
//
// Both run on the Messenger Platform and share one endpoint: a POST to
// the Page's /messages edge with the recipient's page-scoped id. What
// differs is which id you hold (IGSID vs PSID) and which permission was
// approved, not the call itself.
//
// Docs: https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview
// ------------------------------------------------------------

const GRAPH_VERSION = 'v21.0'
const REQUEST_TIMEOUT_MS = 15_000

/**
 * Meta lets a business reply freely only within 24 hours of the
 * customer's last message. After that a plain send is rejected; the
 * HUMAN_AGENT tag extends the window to 7 days and is exactly what a CRM
 * with a person typing the reply is for.
 */
export const STANDARD_WINDOW_MS = 24 * 60 * 60 * 1000
export const HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export type MessagingWindow = 'standard' | 'human_agent' | 'expired'

/**
 * Which sending window applies, given when the customer last wrote.
 *
 * Returning 'expired' rather than attempting the send is deliberate: a
 * rejected send still counts against the app's error rate with Meta, and
 * a clear "this thread is too old to reply to" is more useful to an
 * agent than a generic API failure.
 */
export function messagingWindow(
  lastInboundAt: Date | null,
  now: Date = new Date(),
): MessagingWindow {
  if (!lastInboundAt) return 'expired'
  const age = now.getTime() - lastInboundAt.getTime()
  if (age < 0) return 'standard' // clock skew; treat as fresh
  if (age <= STANDARD_WINDOW_MS) return 'standard'
  if (age <= HUMAN_AGENT_WINDOW_MS) return 'human_agent'
  return 'expired'
}

export interface MetaSendResult {
  ok: boolean
  messageId?: string
  error?: string
  /** True when retrying could plausibly succeed. */
  retryable?: boolean
}

export interface MetaSendArgs {
  pageId: string
  accessToken: string
  /** IGSID (Instagram) or PSID (Messenger). */
  recipientId: string
  text: string
  channel: MessagingChannel
  /** When the customer last wrote, for the window rules above. */
  lastInboundAt: Date | null
}

/**
 * Send a text message. Never throws — returns a typed result the caller
 * records against the message row.
 */
export async function sendMetaMessage(args: MetaSendArgs): Promise<MetaSendResult> {
  const window = messagingWindow(args.lastInboundAt)
  if (window === 'expired') {
    return {
      ok: false,
      error:
        'Fora da janela de resposta da Meta: o cliente não escreve há mais de 7 dias.',
    }
  }

  const body: Record<string, unknown> = {
    recipient: { id: args.recipientId },
    message: { text: args.text },
    messaging_type: 'RESPONSE',
  }
  // Past 24h only the human-agent tag is accepted, and it is honest
  // here: a person in the CRM is typing this reply.
  if (window === 'human_agent') body.tag = 'HUMAN_AGENT'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(args.pageId)}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Header rather than ?access_token= so the token never lands
          // in an access log or an error URL.
          Authorization: `Bearer ${args.accessToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    )

    const raw = await res.text()
    let parsed: Record<string, unknown> | null = null
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>
    } catch {
      // Non-JSON (gateway error page).
    }

    if (!res.ok) {
      const err = (parsed?.error ?? null) as { message?: string; code?: number } | null
      return {
        ok: false,
        error: err?.message ?? `HTTP ${res.status}: ${raw.slice(0, 200)}`,
        retryable: res.status === 429 || res.status >= 500,
      }
    }

    return { ok: true, messageId: String(parsed?.message_id ?? '') || undefined }
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
