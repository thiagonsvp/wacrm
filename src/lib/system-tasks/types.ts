export const TASK_STATUSES = ['backlog', 'planned', 'in_progress', 'validation', 'completed', 'cancelled'] as const
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export const TASK_TYPES = ['improvement', 'bug', 'feature', 'maintenance'] as const
export const TASK_EFFORTS = ['xs', 's', 'm', 'l', 'xl'] as const

export type SystemTaskStatus = (typeof TASK_STATUSES)[number]
export type SystemTaskPriority = (typeof TASK_PRIORITIES)[number]
export type SystemTaskType = (typeof TASK_TYPES)[number]
export type SystemTaskEffort = (typeof TASK_EFFORTS)[number]

export interface SystemTask {
  id: string
  title: string
  description: string | null
  acceptance_criteria: string | null
  status: SystemTaskStatus
  priority: SystemTaskPriority
  task_type: SystemTaskType
  module: string | null
  account_id: string | null
  account_name: string | null
  due_date: string | null
  effort: SystemTaskEffort | null
  position: number
  created_by: string
  updated_by: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface SystemTaskComment {
  id: string
  task_id: string
  body: string
  created_by: string
  author_name: string | null
  created_at: string
}

export interface SystemTaskHistory {
  id: string
  task_id: string
  action: 'created' | 'updated' | 'status_changed' | 'commented'
  field: string | null
  old_value: string | null
  new_value: string | null
  created_by: string
  author_name: string | null
  created_at: string
}

export interface SystemTaskAccount { id: string; name: string }
