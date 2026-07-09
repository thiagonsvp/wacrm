import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'
import { createInstance, getQrCode, setWebhook } from '@/lib/whatsapp/providers/evolution-api'

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
 * POST /api/whatsapp/evolution/connect
 *
 * Creates the Evolution instance if it doesn't exist yet, then
 * returns the current QR code so the frontend can render it for the
 * user to scan with WhatsApp.
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
      .eq('provider', 'evolution')
      .maybeSingle()

    if (configError || !config) {
      return NextResponse.json(
        { error: 'Evolution configuration not saved yet. Fill in server URL, API key and instance name first.' },
        { status: 400 },
      )
    }
    if (!config.evolution_base_url || !config.evolution_instance_name || !config.evolution_api_key) {
      return NextResponse.json({ error: 'Evolution configuration is incomplete.' }, { status: 400 })
    }

    let apiKey: string
    try {
      apiKey = decrypt(config.evolution_api_key)
    } catch (err) {
      console.error('[evolution/connect] failed to decrypt evolution_api_key:', err)
      return NextResponse.json({ error: 'Stored Evolution API key cannot be decrypted.' }, { status: 500 })
    }

    const baseUrl = config.evolution_base_url as string
    const instanceName = config.evolution_instance_name as string

    const webhookUrl = `${new URL(request.url).origin}/api/whatsapp/webhook/evolution`

    // Always (re)point the instance's webhook at the CRM before
    // returning the QR/state — an instance created outside this flow
    // (or by an earlier version of it) may already have a webhook
    // wired to something else (e.g. an n8n workflow), and inbound
    // messages would silently never reach the CRM otherwise. Non-fatal
    // if it fails: the user still gets a QR/connection result, and the
    // next connect attempt retries.
    async function ensureWebhook() {
      try {
        await setWebhook({ baseUrl, apiKey, instanceName, webhookUrl })
      } catch (err) {
        console.error(
          '[evolution/connect] setWebhook failed:',
          err instanceof Error ? err.message : err,
        )
      }
    }

    try {
      const qr = await getQrCode({ baseUrl, apiKey, instanceName })
      await ensureWebhook()
      if (qr.alreadyConnected) {
        return NextResponse.json({ connected: true })
      }
      return NextResponse.json({ connected: false, base64: qr.base64, code: qr.code })
    } catch {
      // Instance likely doesn't exist yet — create it, then fetch the QR.
      try {
        const created = await createInstance({ baseUrl, apiKey, instanceName, webhookUrl })
        await ensureWebhook()
        if (created.qrcode?.base64 || created.qrcode?.code) {
          return NextResponse.json({
            connected: false,
            base64: created.qrcode.base64,
            code: created.qrcode.code,
          })
        }
        const qr = await getQrCode({ baseUrl, apiKey, instanceName })
        return NextResponse.json({ connected: !!qr.alreadyConnected, base64: qr.base64, code: qr.code })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown Evolution API error'
        console.error('[evolution/connect] createInstance failed:', message)
        return NextResponse.json({ error: `Evolution API error: ${message}` }, { status: 502 })
      }
    }
  } catch (error) {
    console.error('Error in evolution/connect POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
