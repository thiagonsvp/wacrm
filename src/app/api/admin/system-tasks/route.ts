import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { requireSuperAdmin } from '@/lib/auth/super-admin'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { TASK_EFFORTS, TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES } from '@/lib/system-tasks/types'
import { loadSystemTaskAccounts, TASK_COLUMNS } from '@/lib/system-tasks/server'

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export async function GET() {
  try {
    const { supabase } = await requireSuperAdmin()
    const [{ data, error }, accounts] = await Promise.all([
      supabase.from('system_tasks').select(TASK_COLUMNS).order('position').order('updated_at', { ascending: false }),
      loadSystemTaskAccounts(),
    ])
    if (error) throw error
    const accountNames = new Map(accounts.map((account) => [account.id, account.name]))
    return NextResponse.json({
      tasks: (data ?? []).map((task) => ({
        ...task,
        account_name: task.account_id ? accountNames.get(task.account_id) ?? null : null,
      })),
      accounts,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, userId } = await requireSuperAdmin()
    const limit = checkRateLimit(`system-tasks:create:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const body = await request.json().catch(() => null)
    const title = text(body?.title, 120)
    if (!title) return NextResponse.json({ error: 'Informe o título da tarefa.' }, { status: 400 })

    const status = TASK_STATUSES.includes(body?.status) ? body.status : 'backlog'
    const priority = TASK_PRIORITIES.includes(body?.priority) ? body.priority : 'medium'
    const taskType = TASK_TYPES.includes(body?.task_type) ? body.task_type : 'improvement'
    const effort = TASK_EFFORTS.includes(body?.effort) ? body.effort : null
    const accountId = typeof body?.account_id === 'string' && body.account_id ? body.account_id : null
    const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(body?.due_date ?? '') ? body.due_date : null

    const { data: last } = await supabase
      .from('system_tasks')
      .select('position')
      .eq('status', status)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data, error } = await supabase.from('system_tasks').insert({
      title,
      description: text(body?.description, 8000) || null,
      acceptance_criteria: text(body?.acceptance_criteria, 8000) || null,
      status,
      priority,
      task_type: taskType,
      module: text(body?.module, 80) || null,
      account_id: accountId,
      due_date: dueDate,
      effort,
      position: (last?.position ?? -1) + 1,
      created_by: userId,
      updated_by: userId,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
    }).select(TASK_COLUMNS).single()
    if (error) throw error
    return NextResponse.json({ task: data }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
