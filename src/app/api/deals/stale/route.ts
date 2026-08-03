import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { expireStaleDeals, staleDealDays } from '@/lib/deals/stale'

/**
 * Close deals that have gone quiet.
 *
 * Meant to be hit on a schedule (Vercel Cron / external pinger), once a
 * day is plenty. Shares `AUTOMATION_CRON_SECRET` with the other cron
 * endpoints rather than introducing a second secret to configure per
 * client — one fewer thing to get wrong when cloning the CRM.
 *
 * `?dry=1` reports what would be closed without writing, which is how to
 * check the threshold before letting it run for real.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  if (request.headers.get('x-cron-secret') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const dry = url.searchParams.get('dry') === '1'
  const daysParam = Number(url.searchParams.get('days'))
  const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : staleDealDays()

  try {
    const result = await expireStaleDeals(supabaseAdmin(), { days, apply: !dry })
    return NextResponse.json({
      dry_run: dry,
      days: result.days,
      examined: result.examined,
      expired: result.expired.length,
      // Enough to eyeball what was closed without dumping the whole row.
      deals: result.expired.slice(0, 50).map((d) => ({ id: d.id, title: d.title })),
    })
  } catch (err) {
    console.error('[deals/stale] sweep failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
