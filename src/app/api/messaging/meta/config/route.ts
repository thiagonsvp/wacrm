import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

/** Same discipline as the AI and WhatsApp configs: the token is stored
 *  encrypted and never returned to the client, only a `has_token` flag. */

const MISSING_TABLE = '42P01'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('meta_messaging_configs')
      .select(
        'page_id, instagram_account_id, verify_token, is_active, instagram_enabled, messenger_enabled, page_access_token',
      )
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      if (error.code === MISSING_TABLE) {
        return NextResponse.json({ configured: false, migration_pending: true })
      }
      console.error('[meta/messaging GET]', error)
      return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ configured: false })

    const { page_access_token, ...safe } = data
    return NextResponse.json({
      configured: true,
      has_token: !!page_access_token,
      ...safe,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`meta-messaging:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    const pageId = str(body.page_id)
    const igId = str(body.instagram_account_id)
    const rawToken = str(body.page_access_token)

    if (!pageId && !igId) {
      return bad('Informe o ID da Página ou o ID da conta do Instagram.')
    }
    for (const [label, value] of [['page_id', pageId], ['instagram_account_id', igId]]) {
      if (value && !/^\d+$/.test(value)) {
        return bad(`${label} deve conter apenas dígitos.`)
      }
    }

    const { data: existing } = await supabase
      .from('meta_messaging_configs')
      .select('id, page_access_token, verify_token')
      .eq('account_id', accountId)
      .maybeSingle()

    let tokenPlain: string
    if (rawToken) {
      tokenPlain = rawToken
    } else if (existing?.page_access_token) {
      try {
        tokenPlain = decrypt(existing.page_access_token)
      } catch {
        return bad('O token salvo não pôde ser descriptografado — informe novamente.')
      }
    } else {
      return bad('page_access_token é obrigatório.')
    }

    // Generated rather than user-supplied: it is only ever pasted into
    // Meta's webhook form, and a value nobody chose is a value nobody
    // reuses from another system.
    const verifyToken =
      existing?.verify_token ?? crypto.randomBytes(24).toString('hex')

    const payload: Record<string, unknown> = {
      page_id: pageId || null,
      instagram_account_id: igId || null,
      verify_token: verifyToken,
      is_active: body.is_active === true,
      instagram_enabled: body.instagram_enabled !== false,
      messenger_enabled: body.messenger_enabled !== false,
      page_access_token: encrypt(tokenPlain),
    }

    const res = existing
      ? await supabase
          .from('meta_messaging_configs')
          .update(payload)
          .eq('account_id', accountId)
      : await supabase.from('meta_messaging_configs').insert({
          account_id: accountId,
          created_by: userId,
          ...payload,
        })

    if (res.error) {
      if (res.error.code === MISSING_TABLE) {
        return bad('Rode a migração 049 no SQL editor do Supabase primeiro.')
      }
      // 23505: another company already registered this Page or IG
      // account. Both are unique per deployment because the webhook
      // resolves the company from them.
      if (res.error.code === '23505') {
        return bad('Esta Página ou conta do Instagram já está ligada a outra empresa.')
      }
      console.error('[meta/messaging POST]', res.error)
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }

    return NextResponse.json({ success: true, verify_token: verifyToken })
  } catch (err) {
    return toErrorResponse(err)
  }
}
