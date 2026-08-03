import type { SupabaseClient } from '@supabase/supabase-js'

// ------------------------------------------------------------
// Expire deals nobody has touched.
//
// A lead that stopped replying is not a live negotiation, but it looks
// like one: it keeps its stage, keeps counting toward the funnel total,
// and quietly overstates the pipeline. Closing it as lost after a period
// of silence keeps the board honest without anyone having to tidy up.
//
// Reversible by design — a customer who comes back re-opens the deal on
// their next message (see the revival case in lib/deals/transition.ts).
// ------------------------------------------------------------

const DEFAULT_STALE_DAYS = 5

/** Days of silence before an open deal is closed as lost. */
export function staleDealDays(): number {
  const raw = Number(process.env.DEAL_STALE_DAYS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STALE_DAYS
}

export interface StaleCandidate {
  id: string
  account_id: string
  contact_id: string | null
  title: string
  /** ISO timestamp of the deal's own last write. */
  updated_at: string
}

/**
 * Decide which open deals have gone quiet. Pure — no I/O, no clock.
 *
 * "Last interaction" is the conversation's last message, because that is
 * what the operator means by silence. It falls back to the deal's own
 * `updated_at` so a deal with no conversation (created by hand, or one
 * whose thread was deleted) still ages out instead of living forever.
 */
export function selectStaleDeals(
  deals: StaleCandidate[],
  lastMessageByContact: Map<string, string | null>,
  cutoffIso: string,
): StaleCandidate[] {
  return deals.filter((deal) => {
    const lastMessage = deal.contact_id
      ? (lastMessageByContact.get(deal.contact_id) ?? null)
      : null
    const lastTouch = lastMessage ?? deal.updated_at
    return lastTouch < cutoffIso
  })
}

export interface ExpireResult {
  /** Deals that are (or would be) closed as lost. */
  expired: StaleCandidate[]
  /** Open deals examined. */
  examined: number
  days: number
}

/**
 * Find and close stale deals across every account.
 *
 * Pass `apply: false` to report without writing. Never throws on a
 * partial failure — a bad row is logged and the rest still process, so
 * one broken deal cannot stop the sweep.
 */
export async function expireStaleDeals(
  db: SupabaseClient,
  opts: { days?: number; apply?: boolean } = {},
): Promise<ExpireResult> {
  const days = opts.days ?? staleDealDays()
  const apply = opts.apply !== false
  const cutoffIso = new Date(Date.now() - days * 86_400_000).toISOString()

  const { data: openDeals, error } = await db
    .from('deals')
    .select('id, account_id, contact_id, title, updated_at')
    .eq('status', 'open')
  if (error) throw error

  const deals = (openDeals ?? []) as StaleCandidate[]
  if (deals.length === 0) return { expired: [], examined: 0, days }

  const contactIds = [...new Set(deals.map((d) => d.contact_id).filter(Boolean))] as string[]
  const lastMessageByContact = new Map<string, string | null>()

  // Chunked: `in()` pushes every id into one URL, and the broadcast
  // sender already pages around the same ~1000-value cap.
  for (let i = 0; i < contactIds.length; i += 200) {
    const { data: convs, error: convErr } = await db
      .from('conversations')
      .select('contact_id, last_message_at')
      .in('contact_id', contactIds.slice(i, i + 200))
    if (convErr) throw convErr
    for (const c of convs ?? []) {
      const prev = lastMessageByContact.get(c.contact_id)
      // A contact can have more than one conversation; the most recent
      // message across all of them is what counts as activity.
      if (!prev || (c.last_message_at && c.last_message_at > prev)) {
        lastMessageByContact.set(c.contact_id, c.last_message_at)
      }
    }
  }

  const expired = selectStaleDeals(deals, lastMessageByContact, cutoffIso)
  if (!apply || expired.length === 0) {
    return { expired, examined: deals.length, days }
  }

  const note = `Marcado como perdido automaticamente: ${days} dias sem interação.`
  for (let i = 0; i < expired.length; i += 100) {
    const chunk = expired.slice(i, i + 100)
    // The status write is what matters; migration 045's trigger moves the
    // card into the closed stage as part of the same UPDATE.
    const { error: upErr } = await db
      .from('deals')
      .update({ status: 'lost', notes: note, updated_at: new Date().toISOString() })
      .in('id', chunk.map((d) => d.id))
    if (upErr) {
      console.error('[deals stale] could not expire a chunk:', upErr)
    }
  }

  console.log(
    `[deals stale] closed ${expired.length} of ${deals.length} open deals after ${days} days of silence`,
  )
  return { expired, examined: deals.length, days }
}
