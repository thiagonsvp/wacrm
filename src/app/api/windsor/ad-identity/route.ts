// ============================================================
// GET /api/windsor/ad-identity?source=meta&ids=<csv>
//
// Second-chance lookup for ad ids the windowed media query didn't
// return. The main /api/windsor/performance call is (correctly)
// pinned to the account selected in Configurações and to the chosen
// date range — but a lead's ad can legitimately live outside both:
//
//   - another ad account under the same Windsor key (Smart's ads run
//     in "Victor Hugo Ramos", not in the pinned "Smart 2026");
//   - an ad paused before the window opened, so the date filter
//     hides it while its leads keep arriving and converting.
//
// This route asks Windsor for those specific ids only — across ALL
// accounts the key can see, over the last year — and returns nothing
// but identity: campaign, ad and adset names, source account, and
// the creative thumbnail. No spend, no clicks. Metrics from outside
// the pinned account/window must never leak into the report's
// totals; the caller uses this purely to file orphan leads under
// their real campaign name.
// ============================================================

import { NextResponse } from 'next/server'
import { requireModule, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { tokenFromWindsorUrl, windsorMcpCall } from '@/lib/windsor/mcp'

const META_FIELDS = ['ad_id', 'ad_name', 'campaign', 'campaign_id', 'adset_name', 'account_name', 'image_url']
// google_ads exposes no adset_name/account_name (see get_fields).
const GOOGLE_FIELDS = ['ad_id', 'ad_name', 'campaign', 'campaign_id', 'image_url']

/**
 * Windsor's `in` filter takes a JSON-array-encoded string of exact
 * values. Ids are digit-only (Meta and Google both), so anything else
 * is dropped rather than forwarded into a filter expression.
 */
const AD_ID = /^\d{5,25}$/

/** Keep the filter payload bounded; 200 ids is far past any real page. */
const MAX_IDS = 200

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireModule('performance')
    const params = new URL(request.url).searchParams
    const isGoogle = params.get('source') === 'google'
    const configColumn = isGoogle ? 'google_ads_url' : 'meta_ads_url'
    const connector = isGoogle ? 'google_ads' : 'facebook'

    const ids = (params.get('ids') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => AD_ID.test(id))
      .slice(0, MAX_IDS)
    if (!ids.length) return NextResponse.json([])

    const { data, error } = await supabase
      .from('windsor_configs')
      .select('meta_ads_url, google_ads_url')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) throw error
    if (!data?.[configColumn]) {
      return NextResponse.json({ error: 'Configure a fonte do Windsor.ai em Configurações.' }, { status: 404 })
    }
    const token = tokenFromWindsorUrl(decrypt(data[configColumn]))
    if (!token) {
      return NextResponse.json({ error: 'O link salvo não contém uma chave do Windsor.ai.' }, { status: 400 })
    }

    // Deliberately NO `accounts` argument — the whole point is to look
    // beyond the pinned account. The id filter keeps the response tiny
    // and keeps other tenants' data out of it even on a multi-client
    // Windsor key: only ads the CRM already attributed leads to can
    // come back.
    const rows = await windsorMcpCall<Record<string, unknown>[]>(token, 'get_data', {
      connector,
      fields: isGoogle ? GOOGLE_FIELDS : META_FIELDS,
      date_preset: 'last_yearT',
      filters: [['ad_id', 'in', JSON.stringify(ids)]],
    })
    return NextResponse.json(Array.isArray(rows) ? rows : [])
  } catch (err) {
    console.error('[windsor/ad-identity]', err)
    return toErrorResponse(err)
  }
}
