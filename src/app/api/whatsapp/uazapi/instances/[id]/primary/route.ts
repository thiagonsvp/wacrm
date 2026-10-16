import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * Make this bound instance the account's primary number (migration 087):
 * the one the CRM uses when it starts a conversation itself (template from
 * a contact, API). Replies always use the conversation's own number.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { supabase, accountId } = await requireRole('admin')

    const { data: target } = await supabase
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', accountId)
      .eq('uazapi_instance_id', id)
      .maybeSingle()
    if (!target) return NextResponse.json({ error: 'not_bound' }, { status: 404 })

    // One primary per account is a unique index: clear first, then set.
    const { error: clearError } = await supabase
      .from('whatsapp_config')
      .update({ is_primary: false })
      .eq('account_id', accountId)
      .neq('id', target.id)
    if (clearError) return NextResponse.json({ error: 'save_failed' }, { status: 500 })
    const { error } = await supabase
      .from('whatsapp_config')
      .update({ is_primary: true })
      .eq('id', target.id)
    if (error) return NextResponse.json({ error: 'save_failed' }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
