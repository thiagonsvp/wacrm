import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { refreshContactAvatar } from '@/lib/whatsapp/contact-avatar'

export const maxDuration = 30

/** A photo the inbox asked for again within this window is served as is. */
const ON_DEMAND_MIN_AGE_MS = 60 * 60_000

/**
 * Fetch the contact's full-size WhatsApp photo now and keep our own copy.
 * Called by the inbox when a stored photo fails to load (WhatsApp links
 * expire) or is still an old thumbnail. Tries each UAZAPI instance of the
 * account, since the contact may only be visible to one of them.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // RLS scopes the lookup to the caller's account.
  const { data: contact } = await supabase
    .from('contacts')
    .select('id, account_id, phone, avatar_url, channel')
    .eq('id', id)
    .maybeSingle()
  if (!contact) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (contact.channel && contact.channel !== 'whatsapp') {
    return NextResponse.json({ avatar_url: contact.avatar_url })
  }

  const db = supabaseAdmin()
  const { data: configs } = await db
    .from('whatsapp_config')
    .select('uazapi_base_url, uazapi_instance_name, uazapi_token')
    .eq('account_id', contact.account_id)
    .eq('provider', 'uazapi')
  if (!configs?.length) return NextResponse.json({ avatar_url: contact.avatar_url })

  const url = await refreshContactAvatar(db, configs, contact, {
    maxAgeMs: ON_DEMAND_MIN_AGE_MS,
  })
  return NextResponse.json({ avatar_url: url ?? null })
}
