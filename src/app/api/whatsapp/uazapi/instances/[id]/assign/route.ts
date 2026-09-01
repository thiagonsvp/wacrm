import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { stampAdminFields } from '@/lib/whatsapp/providers/uazapi'
import {
  getUazapiServer,
  isSuperAdmin,
  loadInstances,
  requireUnownedInstance,
} from '@/lib/whatsapp/uazapi-admin'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { supabase, userId } = await requireRole('admin')
    if (!(await isSuperAdmin(supabase, userId))) {
      return NextResponse.json({ error: 'super_admin_required' }, { status: 403 })
    }
    const server = getUazapiServer()
    if (!server) return NextResponse.json({ error: 'uazapi_not_configured' }, { status: 503 })

    const payload = (await request.json().catch(() => ({}))) as { account_id?: string }
    const targetAccountId = payload.account_id?.trim()
    if (!targetAccountId) return NextResponse.json({ error: 'account_id_required' }, { status: 400 })

    const { data: account, error: accountError } = await supabase.from('accounts')
      .select('id').eq('id', targetAccountId).maybeSingle()
    if (accountError) {
      console.error('[uazapi/assign] account lookup failed:', accountError)
      return NextResponse.json({ error: 'account_check_failed' }, { status: 503 })
    }
    if (!account) return NextResponse.json({ error: 'account_not_found' }, { status: 400 })

    await requireUnownedInstance(server, id)
    await stampAdminFields({
      baseUrl: server.baseUrl, adminToken: server.adminToken, id, adminField01: targetAccountId,
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { supabase, userId } = await requireRole('admin')
    if (!(await isSuperAdmin(supabase, userId))) {
      return NextResponse.json({ error: 'super_admin_required' }, { status: 403 })
    }
    const server = getUazapiServer()
    if (!server) return NextResponse.json({ error: 'uazapi_not_configured' }, { status: 503 })

    if (!(await loadInstances(server)).some((instance) => instance.id === id)) {
      return NextResponse.json({ error: 'instance_not_found' }, { status: 404 })
    }
    await supabase.from('whatsapp_config').update({
      uazapi_instance_id: null,
      uazapi_instance_name: null,
      uazapi_token: null,
      status: 'disconnected',
      updated_at: new Date().toISOString(),
    }).eq('uazapi_instance_id', id)
    await stampAdminFields({ baseUrl: server.baseUrl, adminToken: server.adminToken, id, adminField01: '' })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
