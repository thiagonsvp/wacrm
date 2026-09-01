import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { createInstance } from '@/lib/whatsapp/providers/uazapi'
import {
  adoptForAccount,
  getUazapiServer,
  isSuperAdmin,
  loadInstances,
} from '@/lib/whatsapp/uazapi-admin'
import { sameServer, toPublicInstance, unowned } from '@/lib/whatsapp/uazapi-ownership'

/**
 * GET /api/whatsapp/uazapi/instances
 *
 * As instâncias UAZAPI desta empresa. A lista completa do servidor —
 * que traz o token de toda instância, de toda empresa — é buscada aqui
 * e filtrada aqui; para o browser só vai `PublicInstance`.
 */
export async function GET() {
  try {
    const { supabase, userId, accountId } = await requireRole('admin')

    const server = getUazapiServer()
    if (!server) {
      return NextResponse.json({ configured: false, instances: [], boundInstanceId: null })
    }

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('provider, uazapi_base_url, uazapi_instance_id, uazapi_instance_name')
      .eq('account_id', accountId)
      .maybeSingle()

    const all = await loadInstances(server)
    const owned = await adoptForAccount(server, all, accountId, {
      config: config ?? null,
      envBaseUrl: server.baseUrl,
    })

    // Uma empresa cuja config aponta para outro servidor veria um painel
    // vazio sem explicação. Diga isso em vez de deixá-la adivinhar.
    const otherServer =
      config?.provider === 'uazapi' &&
      !!config.uazapi_base_url &&
      !sameServer(config.uazapi_base_url, server.baseUrl)

    const body: Record<string, unknown> = {
      configured: true,
      instances: owned.map(toPublicInstance),
      boundInstanceId: config?.uazapi_instance_id ?? null,
      otherServer,
    }

    // Super admin também recebe as órfãs e a lista de empresas, para
    // poder atribuí-las. Sem a lista de empresas o bloco "Sem empresa"
    // exigiria digitar um UUID na mão — que é como um account_id errado
    // entraria no adminField01.
    if (await isSuperAdmin(supabase, userId)) {
      body.unowned = unowned(all).map(toPublicInstance)
      const { data: accounts } = await supabase
        .from('accounts')
        .select('id, name')
        .order('name')
      body.accounts = accounts ?? []
    }

    return NextResponse.json(body)
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/whatsapp/uazapi/instances
 *
 * Cria uma instância e a marca como desta empresa. NÃO vincula: a
 * linha `whatsapp_config` é compartilhada com o provider Meta, e
 * escrevê-la aqui apagaria silenciosamente um canal oficial em uso.
 * Vincular é sempre explícito, via POST /[id]/bind.
 */
export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')

    const server = getUazapiServer()
    if (!server) {
      return NextResponse.json({ error: 'uazapi_not_configured' }, { status: 503 })
    }

    const payload = (await request.json().catch(() => ({}))) as { name?: string }
    const name = payload.name?.trim()
    if (!name) {
      return NextResponse.json({ error: 'name_required' }, { status: 400 })
    }

    const created = await createInstance({
      baseUrl: server.baseUrl,
      adminToken: server.adminToken,
      name,
      adminField01: accountId,
    })

    return NextResponse.json({
      instance: {
        id: created.id,
        name,
        status: 'disconnected',
      },
    })
  } catch (err) {
    if (err instanceof Error && !('status' in err)) {
      console.error('[uazapi/instances] create failed:', err.message)
      return NextResponse.json({ error: 'uazapi_error', message: err.message }, { status: 502 })
    }
    return toErrorResponse(err)
  }
}
