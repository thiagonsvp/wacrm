import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { tokenFromWindsorUrl, windsorAccounts, windsorMcpCall } from '@/lib/windsor/mcp'

const FIELDS = ['date', 'campaign', 'campaign_id', 'ad_name', 'spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'cpm', 'image_url']

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const params = new URL(request.url).searchParams
    const isGoogle = params.get('source') === 'google'
    const configColumn = isGoogle ? 'google_ads_url' : 'meta_ads_url'
    const accountColumn = isGoogle ? 'google_ads_account_id' : 'meta_ads_account_id'
    const connector = isGoogle ? 'google_ads' : 'facebook'
    const { data, error } = await supabase.from('windsor_configs').select('meta_ads_url, google_ads_url, meta_ads_account_id, google_ads_account_id').eq('account_id', accountId).maybeSingle()
    if (error) throw error
    if (!data?.[configColumn]) return NextResponse.json({ error: 'Configure a fonte do Windsor.ai em Configurações.' }, { status: 404 })
    const token = tokenFromWindsorUrl(decrypt(data[configColumn]))
    if (!token) return NextResponse.json({ error: 'O link salvo não contém uma chave do Windsor.ai.' }, { status: 400 })
    const selected = data[accountColumn]
    const accounts = selected ? [selected] : (await windsorAccounts(token, connector)).map((item) => item.id)
    if (!accounts.length) return NextResponse.json({ error: `Nenhuma conta ${isGoogle ? 'Google Ads' : 'Meta Ads'} conectada no Windsor.ai.` }, { status: 400 })
    const rows = await windsorMcpCall<Record<string, unknown>[]>(token, 'get_data', { connector, accounts, fields: FIELDS, date_from: params.get('from') || undefined, date_to: params.get('to') || undefined })
    return NextResponse.json(rows)
  } catch (err) { console.error('[windsor/performance]', err); return toErrorResponse(err) }
}
