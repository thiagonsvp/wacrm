import { NextResponse } from 'next/server'
import { getCurrentAccount, ForbiddenError, toErrorResponse } from '@/lib/auth/account'
import { isSuperAdmin } from '@/lib/whatsapp/uazapi-admin'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { validateAiCredentials } from '@/lib/ai/validate'
import { AiError } from '@/lib/ai/types'

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
    const [ai, dashboard] = await Promise.all([
      supabase.from('ai_global_config').select('model,api_key').eq('singleton', true).maybeSingle(),
      supabase.from('windsor_global_config').select('dashboard_url').eq('singleton', true).maybeSingle(),
    ])
    if (ai.error) throw ai.error
    if (dashboard.error) throw dashboard.error
    return NextResponse.json({
      openai_key_configured: !!ai.data?.api_key,
      openai_model: ai.data?.model ?? 'gpt-4.1-mini',
      dashboard_url_configured: !!dashboard.data?.dashboard_url,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, userId } = await requireSuperAdmin()
    const body = await request.json().catch(() => null)
    const openAiKey = typeof body?.openai_api_key === 'string' ? body.openai_api_key.trim() : ''
    const model = typeof body?.openai_model === 'string' ? body.openai_model.trim() : ''
    const dashboardUrl = typeof body?.dashboard_url === 'string' ? body.dashboard_url.trim() : ''
    if (!model) return NextResponse.json({ error: 'Informe o modelo OpenAI.' }, { status: 400 })

    const [existingAi, existingDashboard] = await Promise.all([
      supabase.from('ai_global_config').select('api_key').eq('singleton', true).maybeSingle(),
      supabase.from('windsor_global_config').select('dashboard_url').eq('singleton', true).maybeSingle(),
    ])
    if (existingAi.error) throw existingAi.error
    if (existingDashboard.error) throw existingDashboard.error
    if (!openAiKey && !existingAi.data?.api_key) {
      return NextResponse.json({ error: 'Informe a chave da API OpenAI.' }, { status: 400 })
    }
    if (!dashboardUrl && !existingDashboard.data?.dashboard_url) {
      return NextResponse.json({ error: 'Informe a URL do dashboard Windsor.' }, { status: 400 })
    }
    if (dashboardUrl) {
      try {
        const parsed = new URL(dashboardUrl)
        if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.searchParams.get('api_key')) {
          throw new Error()
        }
      } catch {
        return NextResponse.json(
          { error: 'Informe a URL completa do Windsor, incluindo api_key.' },
          { status: 400 },
        )
      }
    }

    let keyPlain = openAiKey
    if (!keyPlain && existingAi.data?.api_key) keyPlain = decrypt(existingAi.data.api_key)
    if (openAiKey || model) {
      try {
        await validateAiCredentials({ provider: 'openai', model, apiKey: keyPlain })
      } catch (error) {
        if (error instanceof AiError) {
          return NextResponse.json({ error: error.message, code: error.code }, { status: 400 })
        }
        throw error
      }
    }

    const aiSave = await supabase.from('ai_global_config').upsert(
      {
        singleton: true,
        provider: 'openai',
        model,
        api_key: openAiKey ? encrypt(openAiKey) : existingAi.data?.api_key,
        created_by: userId,
      },
      { onConflict: 'singleton' },
    )
    if (aiSave.error) throw aiSave.error

    if (dashboardUrl) {
      const dashboardSave = await supabase.from('windsor_global_config').upsert(
        { singleton: true, dashboard_url: encrypt(dashboardUrl), created_by: userId },
        { onConflict: 'singleton' },
      )
      if (dashboardSave.error) throw dashboardSave.error
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
