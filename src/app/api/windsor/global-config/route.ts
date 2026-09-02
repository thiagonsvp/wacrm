import { NextResponse } from 'next/server'
import { getCurrentAccount, ForbiddenError, toErrorResponse } from '@/lib/auth/account'
import { isSuperAdmin } from '@/lib/whatsapp/uazapi-admin'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'

async function requireSuperAdmin() {
  const context = await getCurrentAccount()
  if (!(await isSuperAdmin(context.supabase, context.userId))) {
    throw new ForbiddenError('Somente o administrador geral pode alterar esta configuração.')
  }
  return context
}

export async function GET() {
  try {
    const { supabase } = await requireSuperAdmin()
    const { data, error } = await supabase
      .from('windsor_global_config')
      .select('api_key,dashboard_url')
      .eq('singleton', true)
      .maybeSingle()
    if (error) throw error
    return NextResponse.json({
      api_key_configured: !!data?.api_key,
      dashboard_url: data?.dashboard_url ? decrypt(data.dashboard_url) : '',
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, userId } = await requireSuperAdmin()
    const body = await request.json().catch(() => null)
    const apiKey = typeof body?.api_key === 'string' ? body.api_key.trim() : ''
    const dashboardUrl =
      typeof body?.dashboard_url === 'string' ? body.dashboard_url.trim() : ''

    if (!dashboardUrl) {
      return NextResponse.json({ error: 'Informe a URL do dashboard.' }, { status: 400 })
    }
    try {
      const parsed = new URL(dashboardUrl)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
    } catch {
      return NextResponse.json({ error: 'Informe uma URL válida.' }, { status: 400 })
    }

    const { data: existing, error: readError } = await supabase
      .from('windsor_global_config')
      .select('api_key')
      .eq('singleton', true)
      .maybeSingle()
    if (readError) throw readError
    if (!apiKey && !existing?.api_key) {
      return NextResponse.json({ error: 'Informe a chave da API Windsor.' }, { status: 400 })
    }

    const payload = {
      singleton: true,
      api_key: apiKey ? encrypt(apiKey) : existing?.api_key,
      dashboard_url: encrypt(dashboardUrl),
      created_by: userId,
    }
    const { error } = await supabase
      .from('windsor_global_config')
      .upsert(payload, { onConflict: 'singleton' })
    if (error) throw error
    return NextResponse.json({ success: true, api_key_configured: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
