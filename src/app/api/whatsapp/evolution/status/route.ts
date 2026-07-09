import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getConnectionState } from '@/lib/whatsapp/providers/evolution-api'

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

/**
 * GET /api/whatsapp/evolution/status
 *
 * Polled by the settings UI (~every 3s) after "Conectar" while the QR
 * code is displayed, until the instance reports `open`.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ connected: false, reason: 'no_account' }, { status: 200 })
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .eq('provider', 'evolution')
      .maybeSingle()

    if (configError || !config) {
      return NextResponse.json({ connected: false, reason: 'no_config' }, { status: 200 })
    }
    if (!config.evolution_base_url || !config.evolution_instance_name || !config.evolution_api_key) {
      return NextResponse.json({ connected: false, reason: 'incomplete_config' }, { status: 200 })
    }

    let apiKey: string
    try {
      apiKey = decrypt(config.evolution_api_key)
    } catch {
      return NextResponse.json({ connected: false, reason: 'token_corrupted' }, { status: 200 })
    }

    try {
      const state = await getConnectionState({
        baseUrl: config.evolution_base_url,
        apiKey,
        instanceName: config.evolution_instance_name,
      })
      const connected = state === 'open'
      if (connected && config.status !== 'connected') {
        await supabaseAdmin()
          .from('whatsapp_config')
          .update({ status: 'connected', connected_at: new Date().toISOString() })
          .eq('id', config.id)
      }
      return NextResponse.json({ connected, state })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Evolution API error'
      return NextResponse.json({ connected: false, reason: 'evolution_api_error', message }, { status: 200 })
    }
  } catch (error) {
    console.error('Error in evolution/status GET:', error)
    return NextResponse.json({ connected: false, reason: 'unknown' }, { status: 500 })
  }
}
