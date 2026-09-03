import { redirect } from 'next/navigation'
import { requireSuperAdmin } from '@/lib/auth/super-admin'
import { SystemTasksPage } from '@/components/system-tasks/system-tasks-page'

export default async function TasksPage() {
  let allowed = true
  try {
    await requireSuperAdmin()
  } catch {
    allowed = false
  }
  if (!allowed) redirect('/dashboard')
  return <SystemTasksPage />
}

