import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const source = new URL(request.url).searchParams.get('source') === 'google' ? 'google_ads_url' : 'meta_ads_url'
    const { data, error } = await supabase.from('windsor_configs').select('meta_ads_url, google_ads_url').eq('account_id', accountId).maybeSingle()
    if (error) throw error
    if (!data?.[source]) return NextResponse.json({ error: 'Configure o link do Windsor para esta fonte em Configurações.' }, { status: 404 })
    const upstream = await fetch(decrypt(data[source]), { cache: 'no-store' })
    const json = await upstream.json()
    return NextResponse.json(json, { status: upstream.ok ? 200 : upstream.status })
  } catch (err) { return toErrorResponse(err) }
}
