import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { createInstance, connectInstance, setWebhook } from '@/lib/whatsapp/providers/uazapi'

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

/**
 * POST /api/whatsapp/uazapi/connect
 *
 * Initializes the UAZAPI instance if it hasn't been created yet
 * (POST /instance/init, which mints a per-instance token we persist),
 * then calls /instance/connect and returns the QR code so the
 * frontend can render it for the user to scan.
 */
export async function POST(request: Request) {
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
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .eq('provider', 'uazapi')
      .maybeSingle()

    if (configError || !config) {
      return NextResponse.json(
        { error: 'Configuração UAZAPI não salva ainda. Preencha a URL do servidor, o token e o nome da instância primeiro.' },
        { status: 400 },
      )
    }
    if (!config.uazapi_base_url || !config.uazapi_instance_name || !config.uazapi_token) {
      return NextResponse.json({ error: 'Configuração UAZAPI incompleta.' }, { status: 400 })
    }

    let token: string
    try {
      token = decrypt(config.uazapi_token)
    } catch (err) {
      console.error('[uazapi/connect] failed to decrypt uazapi_token:', err)
      return NextResponse.json({ error: 'Token UAZAPI armazenado não pôde ser decriptado.' }, { status: 500 })
    }

    const baseUrl = config.uazapi_base_url as string
    const instanceName = config.uazapi_instance_name as string
    const webhookUrl = `${new URL(request.url).origin}/api/whatsapp/webhook/uazapi/${config.id}`

    async function ensureWebhook(instanceToken: string) {
      try {
        await setWebhook({ baseUrl, token: instanceToken, webhookUrl })
      } catch (err) {
        console.error('[uazapi/connect] setWebhook failed:', err instanceof Error ? err.message : err)
      }
    }

    // Whether `token` is already a per-instance token (a prior init
    // succeeded) or still the admin token the user pasted in, try
    // connecting with it directly first — a per-instance token can't
    // call /instance/init again, and re-initializing an existing
    // instance is unnecessary.
    try {
      const qr = await connectInstance({ baseUrl, token })
      await ensureWebhook(token)
      if (!qr.qrcode && !qr.paircode) {
        return NextResponse.json({ connected: true })
      }
      return NextResponse.json({ connected: false, base64: qr.qrcode, paircode: qr.paircode })
    } catch {
      // Instance likely doesn't exist yet under this token — treat the
      // stored value as an admin/master token and initialize.
      try {
        const created = await createInstance({ baseUrl, adminToken: token, name: instanceName })
        const encryptedInstanceToken = encrypt(created.token)
        await supabase
          .from('whatsapp_config')
          .update({ uazapi_token: encryptedInstanceToken })
          .eq('id', config.id)
        await ensureWebhook(created.token)
        const qr = await connectInstance({ baseUrl, token: created.token })
        return NextResponse.json({ connected: false, base64: qr.qrcode, paircode: qr.paircode })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown UAZAPI error'
        console.error('[uazapi/connect] initInstance failed:', message)
        return NextResponse.json({ error: `UAZAPI error: ${message}` }, { status: 502 })
      }
    }
  } catch (error) {
    console.error('Error in uazapi/connect POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
