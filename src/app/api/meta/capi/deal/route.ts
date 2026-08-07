import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { dispatchDealConversions } from '@/lib/meta/dispatch'

/**
 * Report one deal's conversions to Meta.
 *
 * Exists because the AI pipeline was the ONLY caller of
 * `dispatchDealConversions`: marking a deal won by hand in the pipeline
 * writes straight to Supabase from the browser, so the server never
 * learned about it and the sale was never reported. Found on 2026-08-07
 * by reopening a sale and re-marking it won — nothing reached Meta.
 *
 * Fire-and-forget from the UI: the caller marks the deal first and the
 * status change must stand even if Meta is unreachable, so every failure
 * here is reported as `dispatched: false` rather than as an error the
 * user has to act on. `meta_capi_events` remains the record of what
 * actually went out, and its partial unique index still makes a
 * successful send final, so a double click cannot double-report.
 */
export async function POST(request: Request) {
  try {
    const { accountId } = await getCurrentAccount()

    const body = await request.json().catch(() => null)
    const dealId = typeof body?.deal_id === 'string' ? body.deal_id : ''
    if (!dealId) {
      return NextResponse.json({ error: 'deal_id is required' }, { status: 400 })
    }

    // Read through the service role but scope to the caller's account, so
    // a deal id from another company cannot be reported into this one.
    const db = supabaseAdmin()
    const { data: deal, error } = await db
      .from('deals')
      .select('id, account_id, contact_id, status, value, currency')
      .eq('id', dealId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[meta/capi/deal] deal read failed:', error)
      return NextResponse.json({ error: 'Failed to load deal' }, { status: 500 })
    }
    if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

    const won = deal.status === 'won'
    // A won deal is qualified by definition; a lost one reports nothing.
    const qualified = won || deal.status === 'open'
    if (!won && !qualified) {
      return NextResponse.json({ dispatched: false, reason: 'nothing to report' })
    }

    await dispatchDealConversions(db, {
      accountId,
      dealId: deal.id,
      contactId: deal.contact_id as string,
      qualified,
      won,
      value: deal.value == null ? null : Number(deal.value),
      currency: (deal.currency as string | null) ?? null,
    })

    return NextResponse.json({ dispatched: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
