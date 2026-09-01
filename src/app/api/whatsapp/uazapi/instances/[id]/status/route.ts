import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getInstanceStatus } from '@/lib/whatsapp/providers/uazapi'
import { getUazapiServer, requireOwnedInstance } from '@/lib/whatsapp/uazapi-admin'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, accountId } = await requireRole('admin')
    const server = getUazapiServer()
    if (!server) return NextResponse.json({ connected: false, reason: 'uazapi_not_configured' })

    const { data: config } = await supabase.from('whatsapp_config')
      .select('id, status, uazapi_instance_id, uazapi_token')
      .eq('account_id', accountId).maybeSingle()
    const isBound = config?.uazapi_instance_id === id && !!config?.uazapi_token

    let token: string
    if (isBound) {
      try { token = decrypt(config!.uazapi_token) }
      catch { return NextResponse.json({ connected: false, reason: 'token_corrupted' }) }
    } else {
      token = (await requireOwnedInstance(server, accountId, id)).token
    }

    try {
      const result = await getInstanceStatus({ baseUrl: server.baseUrl, token })
      if (isBound && result.connected && config!.status !== 'connected') {
        await supabaseAdmin().from('whatsapp_config')
          .update({ status: 'connected', connected_at: new Date().toISOString() })
          .eq('id', config!.id)
      }
      return NextResponse.json({ connected: result.connected, state: result.status })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown UAZAPI error'
      return NextResponse.json({ connected: false, reason: 'uazapi_error', message })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
