import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt } from '@/lib/whatsapp/encryption'
import { isUndefinedColumnError, selectAiConfigRow, withoutOptionalColumns } from '@/lib/ai/config'
import { loadGlobalAiCredentials } from '@/lib/ai/global-config'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/** Read only this company's agent behaviour; credentials are global. */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const [{ data, error }, globalCredentials] = await Promise.all([
      selectAiConfigRow(
        supabase,
        accountId,
        'system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, deal_pipeline_enabled, deal_product_scope, deal_pipeline_instructions',
      ),
      loadGlobalAiCredentials(),
    ])

    if (error) {
      console.error('[ai/config GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load AI configuration' }, { status: 500 })
    }
    return NextResponse.json({
      configured: !!data,
      has_global_key: !!globalCredentials,
      global_model: globalCredentials?.model ?? null,
      ...(data ?? {}),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** Save only account-scoped prompt, automation and routing settings. */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')
    if (!(await loadGlobalAiCredentials())) {
      return bad('Configure a chave e o modelo OpenAI nas configurações do administrador.')
    }

    const systemPrompt =
      typeof body.system_prompt === 'string' && body.system_prompt.trim()
        ? body.system_prompt.trim()
        : null
    const isActive = body.is_active === true
    const autoReplyEnabled = body.auto_reply_enabled === true
    const dealPipelineEnabled = body.deal_pipeline_enabled === true
    const dealProductScope =
      typeof body.deal_product_scope === 'string' && body.deal_product_scope.trim()
        ? body.deal_product_scope.trim().slice(0, 300)
        : null
    const dealPipelineInstructions =
      typeof body.deal_pipeline_instructions === 'string' && body.deal_pipeline_instructions.trim()
        ? body.deal_pipeline_instructions.trim().slice(0, 4000)
        : null

    let maxPer = Number(body.auto_reply_max_per_conversation)
    if (!Number.isFinite(maxPer)) maxPer = 3
    maxPer = Math.min(20, Math.max(1, Math.floor(maxPer)))

    const rawHandoff =
      typeof body.handoff_agent_id === 'string' ? body.handoff_agent_id.trim() : ''
    const handoffProvided = 'handoff_agent_id' in body
    let handoffAgentId: string | null = null
    if (rawHandoff) {
      const { data: member } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
        .eq('user_id', rawHandoff)
        .maybeSingle()
      if (!member) return bad('handoff_agent_id must be a member of this account')
      handoffAgentId = rawHandoff
    }

    const { data: existing } = await supabase
      .from('ai_configs')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle()

    const shared: Record<string, unknown> = {
      system_prompt: systemPrompt,
      is_active: isActive,
      auto_reply_enabled: autoReplyEnabled,
      auto_reply_max_per_conversation: maxPer,
      deal_pipeline_enabled: dealPipelineEnabled,
      deal_product_scope: dealProductScope,
      deal_pipeline_instructions: dealPipelineInstructions,
    }
    if (handoffProvided) shared.handoff_agent_id = handoffAgentId

    const write = async (payload: Record<string, unknown>) => {
      const run = (value: Record<string, unknown>) =>
        existing
          ? supabase.from('ai_configs').update(value).eq('account_id', accountId)
          : supabase.from('ai_configs').insert(value)
      const first = await run(payload)
      if (!first.error || !isUndefinedColumnError(first.error)) return first
      return run(withoutOptionalColumns(payload))
    }

    // Legacy NOT NULL columns remain populated for backwards-compatible
    // deployments, but runtime credentials always come from ai_global_config.
    const payload = existing
      ? shared
      : {
          account_id: accountId,
          created_by: userId,
          provider: 'openai',
          model: 'global',
          api_key: encrypt('global-managed'),
          ...shared,
        }

    const { error: writeErr } = await write(payload)
    if (writeErr) {
      console.error('[ai/config POST] save error:', writeErr)
      return NextResponse.json({ error: 'Failed to save AI configuration' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** Remove only this company's behaviour. Global credentials are retained. */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase.from('ai_configs').delete().eq('account_id', accountId)
    if (error) {
      console.error('[ai/config DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete AI configuration' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
