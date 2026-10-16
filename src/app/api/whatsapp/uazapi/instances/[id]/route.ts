import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { deleteInstance } from '@/lib/whatsapp/providers/uazapi'
import { getUazapiServer, requireOwnedInstance } from '@/lib/whatsapp/uazapi-admin'

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { supabase, accountId } = await requireRole('admin')
    const server = getUazapiServer()
    if (!server) return NextResponse.json({ error: 'uazapi_not_configured' }, { status: 503 })

    const instance = await requireOwnedInstance(server, accountId, id)
    try { await deleteInstance({ baseUrl: server.baseUrl, token: instance.token }) }
    catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown UAZAPI error'
      return NextResponse.json({ error: 'uazapi_error', message }, { status: 502 })
    }

    // With other numbers on the account (087) the row goes away, and if it
    // was the primary another number takes over. The account's last
    // number is only emptied, as before, so settings keep their row.
    const { data: rows } = await supabase
      .from('whatsapp_config')
      .select('id, uazapi_instance_id, is_primary, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
    const mine = (rows ?? []).find((r: { uazapi_instance_id: string | null }) => r.uazapi_instance_id === id)
    const others = (rows ?? []).filter((r: { id: string }) => r.id !== mine?.id)
    if (mine && others.length > 0) {
      await supabase.from('whatsapp_config').delete().eq('id', mine.id).eq('account_id', accountId)
      if (mine.is_primary) {
        await supabase.from('whatsapp_config').update({ is_primary: true }).eq('id', others[0].id)
      }
    } else {
      await supabase.from('whatsapp_config').update({
        uazapi_instance_id: null,
        uazapi_instance_name: null,
        uazapi_token: null,
        status: 'disconnected',
        updated_at: new Date().toISOString(),
      }).eq('account_id', accountId).eq('uazapi_instance_id', id)
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
