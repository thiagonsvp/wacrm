import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase.from('windsor_configs').select('meta_ads_url, google_ads_url').eq('account_id', accountId).maybeSingle()
    if (error?.code === '42P01') return NextResponse.json({ configured: false, migration_pending: true })
    if (error) throw error
    return NextResponse.json({ configured: !!data, meta_ads_url: data?.meta_ads_url ? decrypt(data.meta_ads_url) : '', google_ads_url: data?.google_ads_url ? decrypt(data.google_ads_url) : '' })
  } catch (err) { return toErrorResponse(err) }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const body = await request.json()
    const meta = typeof body.meta_ads_url === 'string' ? body.meta_ads_url.trim() : ''
    const google = typeof body.google_ads_url === 'string' ? body.google_ads_url.trim() : ''
    for (const url of [meta, google].filter(Boolean)) { try { if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error() } catch { return NextResponse.json({ error: 'Os links precisam ser URLs válidas.' }, { status: 400 }) } }
    const payload = { meta_ads_url: meta ? encrypt(meta) : null, google_ads_url: google ? encrypt(google) : null }
    const { data: existing } = await supabase.from('windsor_configs').select('id').eq('account_id', accountId).maybeSingle()
    const result = existing ? await supabase.from('windsor_configs').update(payload).eq('account_id', accountId) : await supabase.from('windsor_configs').insert({ account_id: accountId, created_by: userId, ...payload })
    if (result.error) throw result.error
    return NextResponse.json({ success: true })
  } catch (err) { return toErrorResponse(err) }
}
