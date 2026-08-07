import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchDealConversions } from './dispatch'
import { MAX_EVENT_AGE_MS } from './capi'

// ------------------------------------------------------------
// Re-attempt conversions that the live dispatcher could not send.
//
// `dispatchDealConversions` only runs when the AI pipeline processes an
// inbound message. A won deal usually ENDS the conversation, so if the
// send failed — or the amount was still unknown at the moment the deal
// was marked won — nothing ever comes back to try again.
//
// That is not hypothetical: on 2026-08-06 a R$7.400 purchase fired at
// 19:15 with value 0 (the AI read the purchase signal before the price
// was agreed), Meta rejected it for a missing currency, and the amount
// only landed at 20:54. The customer never wrote again, so the sale was
// never reported.
// ------------------------------------------------------------

export interface PendingConversion {
  dealId: string
  accountId: string
  contactId: string
  title: string | null
  value: number
  currency: string | null
}

export interface BackfillResult {
  examined: number
  /** Eligible but outside Meta's acceptance window — reported, never sent. */
  tooOld: PendingConversion[]
  dispatched: PendingConversion[]
}

/**
 * Won deals from an ad click that carry an amount but have no Purchase
 * marked `sent`.
 *
 * Deliberately keyed on the ledger rather than on a flag on the deal:
 * a `failed` row must remain retryable, and the partial unique index on
 * (deal_id, event_name) WHERE status='sent' is what makes a success
 * final. Contacts without a `ctwa_clid` are organic and excluded — Meta
 * would accept those events and attribute them to nothing.
 */
export async function selectPendingConversions(
  db: SupabaseClient,
): Promise<PendingConversion[]> {
  const { data, error } = await db
    .from('deals')
    .select(
      'id, account_id, contact_id, title, value, currency, ' +
        'contacts!inner(acquisition_ctwa_clid)',
    )
    .eq('status', 'won')
    .gt('value', 0)
    .not('contacts.acquisition_ctwa_clid', 'is', null)

  if (error) {
    // 42703/42P01 — migration 043 not applied on this deployment.
    if (error.code === '42703' || error.code === '42P01') return []
    throw new Error(`could not read deals: ${error.message}`)
  }

  const rows = (data ?? []) as unknown as Array<{
    id: string
    account_id: string
    contact_id: string
    title: string | null
    value: number
    currency: string | null
  }>
  if (rows.length === 0) return []

  const { data: ledger } = await db
    .from('meta_capi_events')
    .select('deal_id')
    .eq('event_name', 'Purchase')
    .eq('status', 'sent')
    .in(
      'deal_id',
      rows.map((r) => r.id),
    )
  const reported = new Set((ledger ?? []).map((r) => r.deal_id as string))

  return rows
    .filter((r) => !reported.has(r.id))
    .map((r) => ({
      dealId: r.id,
      accountId: r.account_id,
      contactId: r.contact_id,
      title: r.title,
      value: Number(r.value),
      currency: r.currency,
    }))
}

/**
 * Send every pending Purchase.
 *
 * `closedAt` decides eligibility, not the send time: reporting a sale
 * that closed ten days ago as if it happened now would corrupt Meta's
 * attribution windows, so those are surfaced as `tooOld` instead. Callers
 * pass `apply: false` to see the list without sending anything.
 */
export async function backfillConversions(
  db: SupabaseClient,
  opts: { apply?: boolean; closedAtFor?: (dealId: string) => Date | null } = {},
): Promise<BackfillResult> {
  const { apply = true } = opts
  const pending = await selectPendingConversions(db)
  const now = Date.now()

  const tooOld: PendingConversion[] = []
  const dispatched: PendingConversion[] = []

  for (const item of pending) {
    const closedAt = opts.closedAtFor?.(item.dealId) ?? null
    if (closedAt && now - closedAt.getTime() > MAX_EVENT_AGE_MS) {
      tooOld.push(item)
      continue
    }
    if (apply) {
      await dispatchDealConversions(db, {
        accountId: item.accountId,
        dealId: item.dealId,
        contactId: item.contactId,
        qualified: false,
        won: true,
        value: item.value,
        currency: item.currency,
      })
    }
    dispatched.push(item)
  }

  return { examined: pending.length, tooOld, dispatched }
}
