import { NextResponse } from 'next/server'
import { rejectUnauthorizedCron } from '@/lib/cron-auth'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { backfillConversions } from '@/lib/meta/backfill'

/**
 * Re-send purchases the live dispatcher could not report.
 *
 * The dispatcher only runs while a conversation is active, so a sale
 * whose amount was recorded after the customer stopped writing is never
 * retried on its own. This sweep closes that gap.
 *
 * Shares `AUTOMATION_CRON_SECRET` with the other cron endpoints — one
 * fewer thing to configure per client when cloning the CRM. Once a day
 * is plenty; Meta only accepts events up to 7 days old.
 *
 * `?dry=1` lists what would be sent without sending it.
 */
export async function GET(request: Request) {
  const denied = rejectUnauthorizedCron(request, { vercel: false })
  if (denied) return denied

  const dry = new URL(request.url).searchParams.get('dry') === '1'

  try {
    const result = await backfillConversions(supabaseAdmin(), { apply: !dry })
    return NextResponse.json({
      dry_run: dry,
      examined: result.examined,
      dispatched: result.dispatched.length,
      too_old: result.tooOld.length,
      deals: result.dispatched.slice(0, 50).map((d) => ({
        id: d.dealId,
        title: d.title,
        value: d.value,
      })),
    })
  } catch (err) {
    console.error('[meta/capi/backfill] sweep failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
