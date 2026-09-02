import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'

const COLUMNS =
  'meta_ads_account_id,meta_ads_account_name,google_ads_account_id,google_ads_account_name'

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('windsor_configs')
      .select(COLUMNS)
      .eq('account_id', accountId)
      .maybeSingle()
    if (error?.code === '42P01') {
      return NextResponse.json({ configured: false, migration_pending: true })
    }
    if (error) throw error
    return NextResponse.json({
      configured: !!data,
      meta_ads_account_id: data?.meta_ads_account_id ?? '',
      meta_ads_account_name: data?.meta_ads_account_name ?? '',
      google_ads_account_id: data?.google_ads_account_id ?? '',
      google_ads_account_name: data?.google_ads_account_name ?? '',
      configured_sources: [
        ...(data?.meta_ads_account_id ? ['meta'] : []),
        ...(data?.google_ads_account_id ? ['google'] : []),
      ],
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const payload = {
      meta_ads_account_id:
        typeof body?.meta_ads_account_id === 'string' ? body.meta_ads_account_id || null : null,
      meta_ads_account_name:
        typeof body?.meta_ads_account_name === 'string' ? body.meta_ads_account_name || null : null,
      google_ads_account_id:
        typeof body?.google_ads_account_id === 'string' ? body.google_ads_account_id || null : null,
      google_ads_account_name:
        typeof body?.google_ads_account_name === 'string' ? body.google_ads_account_name || null : null,
    }
    const { data: existing, error: readError } = await supabase
      .from('windsor_configs')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle()
    if (readError) throw readError
    const result = existing
      ? await supabase.from('windsor_configs').update(payload).eq('account_id', accountId)
      : await supabase.from('windsor_configs').insert({
          account_id: accountId,
          created_by: userId,
          ...payload,
        })
    if (result.error) throw result.error
    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
