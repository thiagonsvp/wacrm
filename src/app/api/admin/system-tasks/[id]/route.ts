import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { requireSuperAdmin } from '@/lib/auth/super-admin'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { TASK_EFFORTS, TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES } from '@/lib/system-tasks/types'
import { loadAuthorNames, TASK_COLUMNS } from '@/lib/system-tasks/server'

const EDITABLE = ['title','description','acceptance_criteria','status','priority','task_type','module','account_id','due_date','effort','position'] as const

function normalized(field: typeof EDITABLE[number], value: unknown) {
  if (field === 'title') return typeof value === 'string' ? value.trim().slice(0, 120) : ''
  if (field === 'description' || field === 'acceptance_criteria') return typeof value === 'string' ? value.trim().slice(0, 8000) || null : null
  if (field === 'module') return typeof value === 'string' ? value.trim().slice(0, 80) || null : null
  if (field === 'account_id') return typeof value === 'string' && value ? value : null
  if (field === 'due_date') return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
  if (field === 'position') return Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0
  if (field === 'status') return TASK_STATUSES.includes(value as never) ? value : undefined
  if (field === 'priority') return TASK_PRIORITIES.includes(value as never) ? value : undefined
  if (field === 'task_type') return TASK_TYPES.includes(value as never) ? value : undefined
  if (field === 'effort') return TASK_EFFORTS.includes(value as never) ? value : null
  return undefined
}

export async function GET(_request: Request, context: RouteContext<'/api/admin/system-tasks/[id]'>) {
  try {
    const { supabase } = await requireSuperAdmin()
    const { id } = await context.params
    const [taskResult, commentsResult, historyResult] = await Promise.all([
      supabase.from('system_tasks').select(TASK_COLUMNS).eq('id', id).maybeSingle(),
      supabase.from('system_task_comments').select('id,task_id,body,created_by,created_at').eq('task_id', id).order('created_at'),
      supabase.from('system_task_history').select('id,task_id,action,field,old_value,new_value,created_by,created_at').eq('task_id', id).order('created_at', { ascending: false }).limit(100),
    ])
    if (taskResult.error) throw taskResult.error
    if (!taskResult.data) return NextResponse.json({ error: 'Tarefa não encontrada.' }, { status: 404 })
    if (commentsResult.error) throw commentsResult.error
    if (historyResult.error) throw historyResult.error
    const authors = await loadAuthorNames([
      ...(commentsResult.data ?? []).map((row) => row.created_by),
      ...(historyResult.data ?? []).map((row) => row.created_by),
    ])
    return NextResponse.json({
      task: taskResult.data,
      comments: (commentsResult.data ?? []).map((row) => ({ ...row, author_name: authors.get(row.created_by) ?? null })),
      history: (historyResult.data ?? []).map((row) => ({ ...row, author_name: authors.get(row.created_by) ?? null })),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request, context: RouteContext<'/api/admin/system-tasks/[id]'>) {
  try {
    const { supabase, userId } = await requireSuperAdmin()
    const limit = checkRateLimit(`system-tasks:update:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
    const { data: existing, error: readError } = await supabase.from('system_tasks').select(TASK_COLUMNS).eq('id', id).maybeSingle()
    if (readError) throw readError
    if (!existing) return NextResponse.json({ error: 'Tarefa não encontrada.' }, { status: 404 })

    const updates: Record<string, unknown> = { updated_by: userId }
    let changed = false
    for (const field of EDITABLE) {
      if (!(field in body)) continue
      const value = normalized(field, body[field])
      if (value === undefined) return NextResponse.json({ error: `Valor inválido para ${field}.` }, { status: 400 })
      if (field === 'title' && !value) return NextResponse.json({ error: 'Informe o título da tarefa.' }, { status: 400 })
      const previous = existing[field]
      if (String(previous ?? '') === String(value ?? '')) continue
      updates[field] = value
      changed = true
      if (field === 'status') updates.completed_at = value === 'completed' ? new Date().toISOString() : null
    }
    if (!changed) return NextResponse.json({ task: existing })
    const { data, error } = await supabase.from('system_tasks').update(updates).eq('id', id).select(TASK_COLUMNS).single()
    if (error) throw error
    return NextResponse.json({ task: data })
  } catch (error) {
    return toErrorResponse(error)
  }
}
