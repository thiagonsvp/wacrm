import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { canOverrideAssignment } from '@/lib/auth/roles'

/**
 * Cancel a schedule (every item of it still pending). Items already sent
 * or failed are left as they are — that is history, not a plan.
 *
 * Who may cancel: whoever scheduled it, an admin/owner, or the agent the
 * conversation is assigned to now (the lead changed hands; the new owner
 * must be able to stop messages the previous one left queued).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile?.account_id || profile.account_role === 'viewer') {
    return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  }

  const db = supabaseAdmin()
  const { data: items } = await db
    .from('scheduled_messages')
    .select('id, created_by, conversation_id, conversations(assigned_agent_id)')
    .eq('group_id', groupId)
    .eq('account_id', profile.account_id)
    .eq('status', 'pending')
  if (!items?.length) {
    return NextResponse.json(
      { error: 'Esse agendamento já foi enviado ou cancelado.' },
      { status: 409 }
    )
  }

  const conv = items[0].conversations as unknown as { assigned_agent_id: string | null } | null
  const isAdminOrOwner = canOverrideAssignment(profile.account_role)
  const allowed =
    isAdminOrOwner ||
    items[0].created_by === user.id ||
    conv?.assigned_agent_id === user.id
  if (!allowed) {
    return NextResponse.json(
      { error: 'Só quem agendou, o responsável pela conversa ou um admin pode cancelar.' },
      { status: 403 }
    )
  }

  const { data, error } = await db
    .from('scheduled_messages')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .in('id', items.map((i) => i.id))
    .eq('status', 'pending')
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ canceled: data?.length ?? 0 })
}
