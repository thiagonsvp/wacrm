import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { dispatchDueScheduledMessages } from '@/lib/scheduled-messages/dispatch'

export const maxDuration = 60

/**
 * Fallback tick: an open inbox calls this once a minute so the caller's
 * account's due messages go out even if the database tick (pg_cron,
 * migration 084) is not configured. Scoped to the caller's account; the
 * atomic claim keeps it from double-sending alongside the cron.
 */
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile?.account_id) return NextResponse.json({ claimed: 0, sent: 0, failed: 0 })

  const db = supabaseAdmin()
  // Cheap check first: most ticks find nothing due.
  const { count } = await db
    .from('scheduled_messages')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', profile.account_id)
    .eq('status', 'pending')
    .lte('send_at', new Date().toISOString())
  if (!count) return NextResponse.json({ claimed: 0, sent: 0, failed: 0 })

  try {
    return NextResponse.json(
      await dispatchDueScheduledMessages(db, { accountId: profile.account_id })
    )
  } catch (err) {
    console.error('[scheduled-messages/dispatch] failed:', err)
    return NextResponse.json({ error: 'dispatch failed' }, { status: 500 })
  }
}
