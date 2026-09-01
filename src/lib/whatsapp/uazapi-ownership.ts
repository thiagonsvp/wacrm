// ============================================================
// Quem é dono de qual instância UAZAPI.
//
// Tudo aqui é função pura sobre a lista que `/instance/all` devolve.
// A IO (buscar a lista, gravar o carimbo) vive em `uazapi-admin.ts`;
// separar as duas coisas deixa a regra de posse — que é a fronteira de
// segurança do painel — testável sem rede nem banco.
//
// A posse é `adminField01 === account_id`. Esse campo só pode ser
// escrito por quem tem o admintoken, e só o backend o tem, então ele
// não é falsificável a partir do browser.
// ============================================================

import type { UazapiInstance } from './providers/uazapi'

/**
 * O ÚNICO formato que pode ser serializado para o browser.
 *
 * `/instance/all` devolve o token de toda instância do servidor,
 * inclusive as de outras empresas. Montar o payload por lista de
 * inclusão (e não removendo campos) garante que uma chave nova no
 * retorno do servidor não vaze sozinha.
 */
export interface PublicInstance {
  id: string
  name: string
  status: string
  owner?: string
  profileName?: string
  profilePicUrl?: string
  created?: string
}

export function toPublicInstance(i: UazapiInstance): PublicInstance {
  return {
    id: i.id,
    name: i.name,
    status: i.status,
    owner: i.owner,
    profileName: i.profileName,
    profilePicUrl: i.profilePicUrl,
    created: i.created,
  }
}

/** Normaliza uma base URL para comparação: sem barra final, host em minúsculas. */
function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase()
}

export function sameServer(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false
  return normalizeBaseUrl(a) === normalizeBaseUrl(b)
}

export function ownedBy(
  instances: UazapiInstance[],
  accountId: string,
): UazapiInstance[] {
  if (!accountId) return []
  return instances.filter((i) => i.adminField01 === accountId)
}

export function unowned(instances: UazapiInstance[]): UazapiInstance[] {
  return instances.filter((i) => !i.adminField01)
}

/**
 * A checagem de posse. Devolve `null` — nunca a instância — quando ela
 * é de outra empresa ou órfã; quem chama traduz isso em 403.
 */
export function findOwned(
  instances: UazapiInstance[],
  accountId: string,
  id: string,
): UazapiInstance | null {
  if (!accountId || !id) return null
  return instances.find((i) => i.id === id && i.adminField01 === accountId) ?? null
}

export interface StampTarget {
  config: {
    uazapi_base_url?: string | null
    uazapi_instance_id?: string | null
    uazapi_instance_name?: string | null
  } | null
  envBaseUrl: string
}

/**
 * Decide qual instância órfã deve receber o `account_id` desta empresa.
 *
 * Existe porque as instâncias criadas antes do painel não têm
 * `adminField01`, e sem adoção o painel abriria vazio para quem já usa
 * o CRM. Adota no máximo uma: aquela que a própria `whatsapp_config` já
 * aponta.
 *
 * Duas guardas que não podem ser afrouxadas:
 *
 *  - servidor igual. Uma empresa apontada para outro servidor UAZAPI
 *    não pode reivindicar uma instância homônima daqui.
 *  - carimbo vazio. Instância de outra empresa nunca é tocada.
 *
 * Devolve `null` quando não há nada a fazer, inclusive no caso comum de
 * já estar carimbada — o que torna a operação idempotente.
 */
export function planStamp(
  instances: UazapiInstance[],
  accountId: string,
  target: StampTarget,
): UazapiInstance | null {
  const { config, envBaseUrl } = target
  if (!config || !accountId) return null
  if (!sameServer(config.uazapi_base_url, envBaseUrl)) return null

  // O id é a chave. Existindo, o nome não desempata.
  const candidate = config.uazapi_instance_id
    ? instances.find((i) => i.id === config.uazapi_instance_id)
    : config.uazapi_instance_name
      ? instances.find((i) => i.name === config.uazapi_instance_name)
      : undefined

  if (!candidate) return null
  if (candidate.adminField01) return null // já tem dono — inclusive esta empresa
  return candidate
}
