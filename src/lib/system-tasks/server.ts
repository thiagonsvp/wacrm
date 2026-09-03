import { supabaseAdmin } from '@/lib/ai/admin-client'

export const TASK_COLUMNS = 'id,title,description,acceptance_criteria,status,priority,task_type,module,account_id,due_date,effort,position,created_by,updated_by,completed_at,created_at,updated_at'

export async function loadSystemTaskAccounts() {
  const { data, error } = await supabaseAdmin()
    .from('accounts')
    .select('id,name')
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return data ?? []
}

export async function loadAuthorNames(userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (!ids.length) return new Map<string, string>()
  const { data, error } = await supabaseAdmin()
    .from('profiles')
    .select('user_id,full_name,email')
    .in('user_id', ids)
  if (error) throw error
  return new Map((data ?? []).map((row) => [row.user_id, row.full_name || row.email]))
}
