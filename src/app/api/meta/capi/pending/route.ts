import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { loadMetaCapiConfig } from '@/lib/meta/dispatch'
import { sendMetaCapiEvent, MAX_EVENT_AGE_MS } from '@/lib/meta/capi'

/**
 * The Purchase approval queue.
 *
 * A conversion cannot be recalled: once Meta has it, the ad account
 * optimises toward people who resemble whoever it names. On 2026-08-12 the
 * AI marked a deal won because the customer answered "Ok" to a closing
 * pitch, and an earlier one reached Meta for R$4.899 from a customer who
 * had said they would "mandar o link para a esposa". So money now waits
 * for a human, while QualifiedLead keeps flowing.
 *
 * GET returns everything the reviewer needs to judge without leaving the
 * page — the deal, the amount, and the last thing the customer actually
 * said, which is what gives the AI's verdict away.
 */

const WINDOW_MS = MAX_EVENT_AGE_MS

export async function GET() {
  try {
    const { accountId } = await getCurrentAccount()
    const db = supabaseAdmin()

    const { data, error } = await db
      .from('meta_capi_events')
      .select(
        'id, event_name, value, currency, created_at, deal_id, contact_id, ' +
          'deals(title, status), contacts(name, phone)',
      )
      .eq('account_id', accountId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })

    if (error) {
      // Migration 051 not applied yet — an empty queue is the honest
      // answer, and it keeps the page renderable.
      if (error.code === '42703' || error.code === '42P01') {
        return NextResponse.json({ pending: [], migration_pending: true })
      }
      console.error('[meta/capi/pending GET]', error)
      return NextResponse.json({ error: 'Failed to load queue' }, { status: 500 })
    }

    const rows = (data ?? []) as unknown as Array<{
      id: string
      value: number | null
      currency: string | null
      created_at: string
      deal_id: string
      contact_id: string
      deals: { title: string | null; status: string } | null
      contacts: { name: string | null; phone: string | null } | null
    }>

    // The last customer message is the cheapest tell there is: "vou ver
    // com a esposa" reads very differently from "manda o link".
    const pending = await Promise.all(
      rows.map(async (r) => {
        const { data: msg } = await db
          .from('messages')
          .select('content_text, created_at, conversations!inner(contact_id)')
          .eq('conversations.contact_id', r.contact_id)
          .eq('sender_type', 'customer')
          .not('content_text', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const age = Date.now() - Date.parse(r.created_at)
        return {
          id: r.id,
          deal_id: r.deal_id,
          title: r.deals?.title ?? null,
          deal_status: r.deals?.status ?? null,
          value: r.value,
          currency: r.currency,
          contact: r.contacts?.name ?? r.contacts?.phone ?? null,
          phone: r.contacts?.phone ?? null,
          queued_at: r.created_at,
          last_customer_message: (msg?.content_text as string | null) ?? null,
          // Meta refuses anything older than 7 days, so the queue has a
          // deadline the reviewer must be able to see.
          days_left: Math.max(0, Math.floor((WINDOW_MS - age) / 86_400_000)),
          expired: age >= WINDOW_MS,
        }
      }),
    )

    return NextResponse.json({ pending })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST — approve or reject one queued conversion.
 *
 * Approving sends it for real; the ledger row flips to 'sent' only if Meta
 * accepted it, so a failure stays visible and retryable rather than being
 * quietly marked done.
 */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin')

    const body = await request.json().catch(() => null)
    const id = typeof body?.id === 'string' ? body.id : ''
    const decision = body?.decision
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : null

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
    if (decision !== 'approve' && decision !== 'reject') {
      return NextResponse.json({ error: 'decision must be approve or reject' }, { status: 400 })
    }

    const db = supabaseAdmin()
    const { data: row, error } = await db
      .from('meta_capi_events')
      .select('id, event_id, event_name, value, currency, contact_id, deal_id, status, created_at')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (error || !row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (row.status !== 'pending') {
      return NextResponse.json({ error: 'Already decided' }, { status: 409 })
    }

    if (decision === 'reject') {
      await db
        .from('meta_capi_events')
        .update({
          status: 'rejected',
          reviewed_by: userId,
          reviewed_at: new Date().toISOString(),
          review_note: note,
        })
        .eq('id', id)
      return NextResponse.json({ success: true, status: 'rejected' })
    }

    const config = await loadMetaCapiConfig(db, accountId)
    if (!config) {
      return NextResponse.json(
        { error: 'Meta is not configured for this company.' },
        { status: 400 },
      )
    }

    const { data: contact } = await db
      .from('contacts')
      .select('phone, acquisition_ctwa_clid')
      .eq('id', row.contact_id)
      .maybeSingle()

    const result = await sendMetaCapiEvent(
      {
        eventName: 'Purchase',
        eventId: row.event_id as string,
        // The sale is being reported now; using the queued timestamp would
        // start the 7-day clock at the wrong moment for a slow review.
        eventTime: new Date(),
        ctwaClid: (contact?.acquisition_ctwa_clid as string | null) ?? '',
        phone: (contact?.phone as string | null) ?? null,
        value: row.value as number | null,
        currency: row.currency as string | null,
      },
      config,
    )

    await db
      .from('meta_capi_events')
      .update({
        status: result.ok ? 'sent' : 'failed',
        error_message: result.ok ? null : (result.error ?? 'unknown').slice(0, 500),
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        review_note: note,
      })
      .eq('id', id)

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ success: true, status: 'sent' })
  } catch (err) {
    return toErrorResponse(err)
  }
}
