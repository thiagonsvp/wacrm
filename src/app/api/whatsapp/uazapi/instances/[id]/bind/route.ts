import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { setWebhook } from '@/lib/whatsapp/providers/uazapi'
import { getUazapiServer, requireOwnedInstance } from '@/lib/whatsapp/uazapi-admin'
import { buildBindInsert, buildBindRow } from '@/lib/whatsapp/uazapi-bind'

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

    // An account can have several numbers (migration 087). Binding adds
    // this instance next to the others; it never replaces another number.
    //   * already bound here  -> refresh that row (new token / webhook);
    //   * an emptied row left by a deleted instance -> reuse it;
    //   * otherwise -> a new row; the account's first number is primary.
    const { data: rows, error: rowsError } = await supabase
      .from('whatsapp_config')
      .select('id, provider, uazapi_instance_id, uazapi_token, is_primary')
      .eq('account_id', accountId)
    if (rowsError) {
      console.error('[uazapi/bind] current config check failed:', rowsError)
      return NextResponse.json({ error: 'current_check_failed' }, { status: 503 })
    }
    const existing =
      (rows ?? []).find((r: { uazapi_instance_id: string | null }) => r.uazapi_instance_id === instance.id) ??
      (rows ?? []).find(
        (r: { provider: string; uazapi_instance_id: string | null; uazapi_token: string | null }) =>
          r.provider === 'uazapi' && !r.uazapi_instance_id && !r.uazapi_token,
      ) ??
      null

    const row = buildBindRow({ baseUrl: server.baseUrl, instance, encryptToken: encrypt })
    let configId: string
    if (existing) {
      const { data, error } = await supabase.from('whatsapp_config')
        .update(row).eq('id', existing.id).eq('account_id', accountId).select('id').single()
      if (error || !data) {
        console.error('[uazapi/bind] update failed:', error)
        return NextResponse.json({ error: 'save_failed' }, { status: 500 })
      }
      configId = data.id
    } else {
      const hasPrimary = (rows ?? []).some((r: { is_primary?: boolean }) => r.is_primary)
      const { data, error } = await supabase.from('whatsapp_config')
        .insert({ ...buildBindInsert(row, accountId, userId), is_primary: !hasPrimary })
        .select('id').single()
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

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
