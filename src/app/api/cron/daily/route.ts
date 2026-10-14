import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { sweepUnreadConversations } from '@/lib/ai/deal-pipeline'
import {
  INBOUND_MEDIA_RETENTION_DAYS,
  purgeExpiredInboundMedia,
} from '@/lib/storage/inbound-media'

export const maxDuration = 300

/**
 * The once-a-day job. Vercel Hobby allows only daily crons (and only
 * two), so daily maintenance shares one entry point:
 *
 *   1. deal pipeline catch-up — re-read conversations whose newest
 *      messages arrived inside the classifier cooldown and were never
 *      read (lib/ai/deal-pipeline.ts `sweepUnreadConversations`);
 *   2. inbound attachment retention (60 days).
 *
 * Each step runs even if the previous one failed. Authenticated by
 * Vercel Cron's `Authorization: Bearer $CRON_SECRET`, or by an external
 * pinger sending `x-cron-secret: $AUTOMATION_CRON_SECRET`.
 */
export async function GET(request: Request) {
  const pingerSecret = process.env.AUTOMATION_CRON_SECRET
  const vercelSecret = process.env.CRON_SECRET
  if (!pingerSecret && !vercelSecret) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const authorized =
    (!!pingerSecret && request.headers.get('x-cron-secret') === pingerSecret) ||
    (!!vercelSecret && request.headers.get('authorization') === `Bearer ${vercelSecret}`)
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = supabaseAdmin()
  const out: Record<string, unknown> = {}

  try {
    out.dealSweep = await sweepUnreadConversations(db, { budgetMs: 200_000 })
  } catch (err) {
    console.error('[cron/daily] deal sweep failed:', err)
    out.dealSweep = { error: err instanceof Error ? err.message : String(err) }
  }

  try {
    out.mediaRetention = await purgeExpiredInboundMedia(db, {
      days: INBOUND_MEDIA_RETENTION_DAYS,
    })
  } catch (err) {
    console.error('[cron/daily] media retention failed:', err)
    out.mediaRetention = { error: err instanceof Error ? err.message : String(err) }
  }

  return NextResponse.json(out)
}
