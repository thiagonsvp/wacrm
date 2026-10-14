import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const MAX_NAME = 100

/**
 * Rename a contact from the inbox. Only `name` changes — the contact row,
 * its conversations, messages, deals and tags all stay as they are, keyed
 * by id. The rename is stamped (`name_locked_at`, migration 085) so the
 * next WhatsApp message does not write the old name back. An empty name
 * hands the name back to WhatsApp: the phone shows until the customer
 * next writes, and the stamp is cleared.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile?.account_id || profile.account_role === 'viewer') {
    return NextResponse.json({ error: 'Sem permissão para editar contatos.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const raw = typeof body?.name === 'string' ? body.name : null
  if (raw === null) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  const name = raw.replace(/\s+/g, ' ').trim()
  if (name.length > MAX_NAME) {
    return NextResponse.json({ error: `O nome pode ter até ${MAX_NAME} caracteres.` }, { status: 400 })
  }

  const { data: contact } = await supabase
    .from('contacts')
    .select('id, phone')
    .eq('id', id)
    .eq('account_id', profile.account_id)
    .maybeSingle()
  if (!contact) return NextResponse.json({ error: 'Contato não encontrado.' }, { status: 404 })

  const patch = name
    ? { name, name_locked_at: new Date().toISOString() }
    : { name: contact.phone, name_locked_at: null }
  const { data, error } = await supabase
    .from('contacts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('account_id', profile.account_id)
    .select('id, name, name_locked_at')
    .single()
  if (error) {
    console.error('[contacts/name] update failed:', error)
    const missingColumn = /name_locked_at/.test(error.message)
    return NextResponse.json(
      {
        error: missingColumn
          ? 'Falta aplicar a migração 085 no Supabase.'
          : 'Não foi possível salvar o nome.',
      },
      { status: 500 }
    )
  }
  return NextResponse.json(data)
}
