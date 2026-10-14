import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { dispatchDueScheduledMessages } from '@/lib/scheduled-messages/dispatch'

export const maxDuration = 60

/**
 * Per-minute tick for scheduled messages, across all accounts.
 *
 * Called by pg_cron + pg_net from the database itself (migration 084),
 * because Vercel Hobby crons only run daily. The database only calls when
 * something is due, so idle minutes cost no function invocation.
 * Authenticated like the other cron routes: `Authorization: Bearer
 * $CRON_SECRET` or `x-cron-secret: $AUTOMATION_CRON_SECRET`.
 */
async function handle(request: Request) {
  const pingerSecret = process.env.AUTOMATION_CRON_SECRET
  const vercelSecret = process.env.CRON_SECRET
  if (!pingerSecret && !vercelSecret) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const authorized =
    (!!pingerSecret && request.headers.get('x-cron-secret') === pingerSecret) ||
    (!!vercelSecret && request.headers.get('authorization') === `Bearer ${vercelSecret}`)
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    return NextResponse.json(await dispatchDueScheduledMessages(supabaseAdmin()))
  } catch (err) {
    console.error('[cron/scheduled-messages] dispatch failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}

export const GET = handle
export const POST = handle
