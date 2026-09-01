// ============================================================
// Acesso administrativo ao servidor UAZAPI.
//
// O admin token vem do ambiente e nunca sai do backend. É ele que
// torna o filtro por empresa uma fronteira real: sem ele na mão do
// usuário, ninguém contorna o CRM chamando a UAZAPI direto.
//
// As regras de posse são puras e vivem em `uazapi-ownership.ts`; aqui
// ficam só o env, a IO e a tradução de "não é sua" em ForbiddenError.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { ForbiddenError } from '@/lib/auth/account'
import {
  listInstances,
  stampAdminFields,
  type UazapiInstance,
} from './providers/uazapi'
import { findOwned, ownedBy, planStamp, type StampTarget } from './uazapi-ownership'

export interface UazapiServer {
  baseUrl: string
  adminToken: string
}

/**
 * `null` quando o servidor não está configurado. As rotas traduzem isso
 * em `{ configured: false }` com 200 — é um estado da tela, não um erro.
 */
export function getUazapiServer(): UazapiServer | null {
  const baseUrl = process.env.UAZAPI_BASE_URL?.trim()
  const adminToken = process.env.UAZAPI_ADMIN_TOKEN?.trim()
  if (!baseUrl || !adminToken) return null
  return { baseUrl, adminToken }
}

export async function loadInstances(server: UazapiServer): Promise<UazapiInstance[]> {
  return listInstances({ baseUrl: server.baseUrl, adminToken: server.adminToken })
}

/**
 * Carimba a instância legada da empresa, se houver, e devolve as
 * instâncias que ela possui depois disso.
 *
 * O carimbo é oportunista: uma falha aqui não pode impedir o painel de
 * abrir, então ela é registrada e engolida.
 */
export async function adoptForAccount(
  server: UazapiServer,
  instances: UazapiInstance[],
  accountId: string,
  target: StampTarget,
): Promise<UazapiInstance[]> {
  const toStamp = planStamp(instances, accountId, target)
  if (toStamp) {
    try {
      await stampAdminFields({
        baseUrl: server.baseUrl,
        adminToken: server.adminToken,
        id: toStamp.id,
        adminField01: accountId,
      })
      toStamp.adminField01 = accountId
    } catch (err) {
      console.error(
        '[uazapi-admin] falha ao carimbar posse da instância',
        toStamp.id,
        err instanceof Error ? err.message : err,
      )
    }
  }
  return ownedBy(instances, accountId)
}

/**
 * A checagem que toda rota `[id]` faz antes de qualquer efeito.
 *
 * Instância de outra empresa, órfã e inexistente colapsam no mesmo 403:
 * distinguir os casos contaria ao chamador o que existe no servidor.
 */
export async function requireOwnedInstance(
  server: UazapiServer,
  accountId: string,
  id: string,
): Promise<UazapiInstance> {
  const instances = await loadInstances(server)
  const found = findOwned(instances, accountId, id)
  if (!found) {
    throw new ForbiddenError('This instance does not belong to your company')
  }
  return found
}

/**
 * Só `/assign` usa isto: atribuir opera por definição sobre uma
 * instância sem dono, então ela não pode passar por
 * `requireOwnedInstance`, que a recusaria.
 */
export async function requireUnownedInstance(
  server: UazapiServer,
  id: string,
): Promise<UazapiInstance> {
  const instances = await loadInstances(server)
  const found = instances.find((i) => i.id === id)
  if (!found) throw new ForbiddenError('Instance not found')
  if (found.adminField01) {
    throw new ForbiddenError('This instance is already assigned to a company')
  }
  return found
}

export async function isSuperAdmin(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('profiles')
    .select('is_super_admin')
    .eq('user_id', userId)
    .maybeSingle()
  return data?.is_super_admin === true
}
