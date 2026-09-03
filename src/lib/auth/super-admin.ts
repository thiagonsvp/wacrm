import { ForbiddenError, getCurrentAccount } from '@/lib/auth/account'
import { isSuperAdmin } from '@/lib/whatsapp/uazapi-admin'

export async function requireSuperAdmin() {
  const context = await getCurrentAccount()
  if (!(await isSuperAdmin(context.supabase, context.userId))) {
    throw new ForbiddenError('Acesso exclusivo do administrador geral.')
  }
  return context
}

