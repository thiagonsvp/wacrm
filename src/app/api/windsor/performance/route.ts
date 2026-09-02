import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { loadGlobalWindsorToken } from '@/lib/windsor/global-config'
import { windsorMcpCall } from '@/lib/windsor/mcp'

// `ad_id` is the load-bearing field: it is the ONLY one both systems
// agree on. Meta hands the same value to WhatsApp as
// `referral.source_id`, which lands in `contacts.acquisition_source_id`,
// so it is what lets a lead — and the sale it became — be attributed to
// a campaign and a creative. Everything else here is reporting detail.
//
// The two connectors do not expose the same catalogue: `adset_name` and
// `reach` are Meta-only (`get_fields` on google_ads returns neither), so
// each gets the list it actually answers rather than one union that
// quietly relies on Windsor tolerating unknown names.
const META_FIELDS = ['date', 'campaign', 'campaign_id', 'adset_name', 'ad_id', 'ad_name', 'spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'cpm', 'image_url']
const GOOGLE_FIELDS = ['date', 'campaign', 'campaign_id', 'ad_id', 'ad_name', 'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'image_url']

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const params = new URL(request.url).searchParams
    const isGoogle = params.get('source') === 'google'
    const accountColumn = isGoogle ? 'google_ads_account_id' : 'meta_ads_account_id'
    const connector = isGoogle ? 'google_ads' : 'facebook'
    const { data, error } = await supabase.from('windsor_configs').select('meta_ads_account_id, google_ads_account_id').eq('account_id', accountId).maybeSingle()
    if (error) throw error
    const token = await loadGlobalWindsorToken()
    if (!token) return NextResponse.json({ error: 'A chave global do Windsor.ai não está configurada.' }, { status: 400 })
    const selected = data?.[accountColumn]
    if (!selected) return NextResponse.json({ error: `Nenhuma conta ${isGoogle ? 'Google Ads' : 'Meta Ads'} selecionada para esta empresa.` }, { status: 404 })
    const rows = await windsorMcpCall<Record<string, unknown>[]>(token, 'get_data', { connector, accounts: [selected], fields: isGoogle ? GOOGLE_FIELDS : META_FIELDS, date_from: params.get('from') || undefined, date_to: params.get('to') || undefined })
    return NextResponse.json(rows)
  } catch (err) { console.error('[windsor/performance]', err); return toErrorResponse(err) }
}
