import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { setWebhook } from '@/lib/whatsapp/providers/uazapi'
import { getUazapiServer, requireOwnedInstance } from '@/lib/whatsapp/uazapi-admin'
import { buildBindInsert, buildBindRow, decideBindConflict } from '@/lib/whatsapp/uazapi-bind'

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, userId, accountId } = await requireRole('admin')
    const server = getUazapiServer()
    if (!server) {
      return NextResponse.json({ error: 'uazapi_not_configured' }, { status: 503 })
    }

    const instance = await requireOwnedInstance(server, accountId, id)
    const payload = (await request.json().catch(() => ({}))) as { replace_existing?: boolean }

    const { data: claimed, error: claimedError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id, accounts(name)')
      .eq('uazapi_instance_id', id)
      .neq('account_id', accountId)
      .maybeSingle()
    if (claimedError) {
      console.error('[uazapi/bind] claim check failed:', claimedError)
      return NextResponse.json({ error: 'claim_check_failed' }, { status: 503 })
    }
    if (claimed) {
      const owner = (claimed as { accounts?: { name?: string } }).accounts?.name
      return NextResponse.json({ error: 'instance_claimed', owner: owner ?? null }, { status: 409 })
    }

    const { data: current, error: currentError } = await supabase
      .from('whatsapp_config')
      .select('id, provider, status, uazapi_instance_id, uazapi_instance_name, uazapi_token, phone_number_id')
      .eq('account_id', accountId)
      .maybeSingle()
    if (currentError) {
      console.error('[uazapi/bind] current config check failed:', currentError)
      return NextResponse.json({ error: 'current_check_failed' }, { status: 503 })
    }

    const conflict = decideBindConflict({
      current: current ? {
        provider: current.provider,
        status: current.status,
        uazapi_instance_id: current.uazapi_instance_id,
        uazapi_instance_name: current.uazapi_instance_name,
        phone_number_id: current.phone_number_id,
      } : null,
      newInstanceId: instance.id,
      newInstanceName: instance.name,
      replaceExisting: payload.replace_existing === true,
    })
    if (conflict) {
      return NextResponse.json({
        error: conflict.reason,
        requires_confirmation: true,
        current_instance: conflict.currentInstanceName ?? null,
        new_instance: instance.name,
      }, { status: 409 })
    }

    let previousToken: string | null = null
    if (current?.uazapi_token && current.uazapi_instance_id && current.uazapi_instance_id !== instance.id) {
      try { previousToken = decrypt(current.uazapi_token) } catch { previousToken = null }
    }

    const row = buildBindRow({ baseUrl: server.baseUrl, instance, encryptToken: encrypt })
    let configId: string
    if (current) {
      const { data, error } = await supabase.from('whatsapp_config')
        .update(row).eq('account_id', accountId).select('id').single()
      if (error || !data) {
        console.error('[uazapi/bind] update failed:', error)
        return NextResponse.json({ error: 'save_failed' }, { status: 500 })
      }
      configId = data.id
    } else {
      const { data, error } = await supabase.from('whatsapp_config')
        .insert(buildBindInsert(row, accountId, userId)).select('id').single()
      if (error || !data) {
        console.error('[uazapi/bind] insert failed:', error)
        return NextResponse.json({ error: 'save_failed' }, { status: 500 })
      }
      configId = data.id
    }

    const webhookUrl = `${new URL(request.url).origin}/api/whatsapp/webhook/uazapi/${configId}`
    try {
      await setWebhook({ baseUrl: server.baseUrl, token: instance.token, webhookUrl })
    } catch (err) {
      console.error('[uazapi/bind] setWebhook failed:', err)
      return NextResponse.json({ error: 'webhook_failed' }, { status: 502 })
    }

    if (previousToken) {
      try {
        await setWebhook({ baseUrl: server.baseUrl, token: previousToken, webhookUrl, enabled: false })
      } catch (err) {
        console.error('[uazapi/bind] disabling previous webhook failed:', err)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
