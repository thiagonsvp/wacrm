import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { disconnectInstance } from '@/lib/whatsapp/providers/uazapi'
import { getUazapiServer, requireOwnedInstance } from '@/lib/whatsapp/uazapi-admin'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { supabase, accountId } = await requireRole('admin')
    const server = getUazapiServer()
    if (!server) return NextResponse.json({ error: 'uazapi_not_configured' }, { status: 503 })

    const instance = await requireOwnedInstance(server, accountId, id)
    try { await disconnectInstance({ baseUrl: server.baseUrl, token: instance.token }) }
    catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown UAZAPI error'
      return NextResponse.json({ error: 'uazapi_error', message }, { status: 502 })
    }

    await supabase.from('whatsapp_config')
      .update({ status: 'disconnected', updated_at: new Date().toISOString() })
      .eq('account_id', accountId).eq('uazapi_instance_id', id)
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
