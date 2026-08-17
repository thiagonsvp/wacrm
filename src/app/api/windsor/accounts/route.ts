import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { tokenFromWindsorUrl, windsorAccounts } from '@/lib/windsor/mcp'

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const isGoogle = new URL(request.url).searchParams.get('source') === 'google'
    const column = isGoogle ? 'google_ads_url' : 'meta_ads_url'
    const { data, error } = await supabase.from('windsor_configs').select('meta_ads_url, google_ads_url').eq('account_id', accountId).maybeSingle()
    if (error) throw error
    if (!data?.[column]) return NextResponse.json({ accounts: [] })
    const token = tokenFromWindsorUrl(decrypt(data[column]))
    if (!token) return NextResponse.json({ accounts: [] })
    const accounts = await windsorAccounts(token, isGoogle ? 'google_ads' : 'facebook')
    return NextResponse.json({ accounts })
  } catch (err) { return toErrorResponse(err) }
}
