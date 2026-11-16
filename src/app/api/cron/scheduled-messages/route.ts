import { NextResponse } from 'next/server'
import { rejectUnauthorizedCron } from '@/lib/cron-auth'
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
  const denied = rejectUnauthorizedCron(request)
  if (denied) return denied

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
