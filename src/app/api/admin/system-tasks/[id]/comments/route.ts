import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { requireSuperAdmin } from '@/lib/auth/super-admin'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function POST(request: Request, context: RouteContext<'/api/admin/system-tasks/[id]/comments'>) {
  try {
    const { supabase, userId } = await requireSuperAdmin()
    const limit = checkRateLimit(`system-tasks:comment:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    const comment = typeof body?.body === 'string' ? body.body.trim().slice(0, 4000) : ''
    if (!comment) return NextResponse.json({ error: 'Escreva um comentário.' }, { status: 400 })
    const { data, error } = await supabase.from('system_task_comments').insert({
      task_id: id,
      body: comment,
      created_by: userId,
    }).select('id,task_id,body,created_by,created_at').single()
    if (error) throw error
    return NextResponse.json({ comment: data }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
