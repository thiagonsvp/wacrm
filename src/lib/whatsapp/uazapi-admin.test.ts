import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UazapiInstance } from './providers/uazapi'

// `@/lib/auth/account` importa `@/lib/supabase/server`, que lê
// next/headers no carregamento do módulo. Sem este mock o arquivo de
// teste nem chega a executar — é o mesmo tratamento que
// src/lib/auth/account.test.ts:65 já faz.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

const listInstances = vi.fn()
const stampAdminFields = vi.fn()

vi.mock('./providers/uazapi', () => ({
  listInstances: (...a: unknown[]) => listInstances(...a),
  stampAdminFields: (...a: unknown[]) => stampAdminFields(...a),
}))

import {
  getUazapiServer,
  loadInstances,
  adoptForAccount,
  requireOwnedInstance,
  requireUnownedInstance,
} from './uazapi-admin'
import { ForbiddenError } from '@/lib/auth/account'

function inst(over: Partial<UazapiInstance> = {}): UazapiInstance {
  return {
    id: 'r1',
    token: 'tok',
    name: 'Metalis',
    status: 'connected',
    adminField01: '',
    ...over,
  }
}

const server = { baseUrl: 'https://newphone.uazapi.com', adminToken: 'admin' }

describe('getUazapiServer', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    delete process.env.UAZAPI_BASE_URL
    delete process.env.UAZAPI_ADMIN_TOKEN
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  it('devolve null quando falta a base URL', () => {
    process.env.UAZAPI_ADMIN_TOKEN = 'a'
    expect(getUazapiServer()).toBeNull()
  })

  it('devolve null quando falta o admin token', () => {
    process.env.UAZAPI_BASE_URL = 'https://x.uazapi.com'
    expect(getUazapiServer()).toBeNull()
  })

  it('devolve null quando as variáveis existem mas estão vazias', () => {
    process.env.UAZAPI_BASE_URL = '   '
    process.env.UAZAPI_ADMIN_TOKEN = ''
    expect(getUazapiServer()).toBeNull()
  })

  it('devolve o servidor quando as duas estão preenchidas', () => {
    process.env.UAZAPI_BASE_URL = 'https://x.uazapi.com'
    process.env.UAZAPI_ADMIN_TOKEN = 'secret'
    expect(getUazapiServer()).toEqual({
      baseUrl: 'https://x.uazapi.com',
      adminToken: 'secret',
    })
  })
})

describe('requireOwnedInstance — a fronteira de 403', () => {
  beforeEach(() => {
    listInstances.mockReset()
    stampAdminFields.mockReset()
  })

  it('devolve a instância da própria empresa, com token', async () => {
    listInstances.mockResolvedValue([inst({ id: 'r2', adminField01: 'acct-a', token: 'inst-tok' })])
    const got = await requireOwnedInstance(server, 'acct-a', 'r2')
    expect(got.token).toBe('inst-tok')
  })

  it('lança ForbiddenError para instância de outra empresa', async () => {
    listInstances.mockResolvedValue([inst({ id: 'r2', adminField01: 'acct-b' })])
    await expect(requireOwnedInstance(server, 'acct-a', 'r2')).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('lança ForbiddenError para instância órfã', async () => {
    listInstances.mockResolvedValue([inst({ id: 'r2', adminField01: '' })])
    await expect(requireOwnedInstance(server, 'acct-a', 'r2')).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('lança ForbiddenError para id inexistente, sem distinguir de "não é sua"', async () => {
    listInstances.mockResolvedValue([])
    await expect(requireOwnedInstance(server, 'acct-a', 'sumiu')).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})

describe('requireUnownedInstance — usada só por /assign', () => {
  beforeEach(() => listInstances.mockReset())

  it('devolve a instância órfã', async () => {
    listInstances.mockResolvedValue([inst({ id: 'r1', adminField01: '' })])
    expect((await requireUnownedInstance(server, 'r1')).id).toBe('r1')
  })

  it('recusa uma instância que já tem dono', async () => {
    listInstances.mockResolvedValue([inst({ id: 'r1', adminField01: 'acct-b' })])
    await expect(requireUnownedInstance(server, 'r1')).rejects.toThrow(/already/i)
  })
})

describe('adoptForAccount — grava o carimbo decidido por planStamp', () => {
  const env = 'https://newphone.uazapi.com'
  beforeEach(() => {
    listInstances.mockReset()
    stampAdminFields.mockReset()
  })

  it('carimba a órfã que a config já aponta e a devolve como possuída', async () => {
    const instances = [inst({ id: 'r9', name: 'Metalis', adminField01: '' })]
    const out = await adoptForAccount(server, instances, 'acct-a', {
      config: { uazapi_base_url: env, uazapi_instance_id: 'r9', uazapi_instance_name: 'Metalis' },
      envBaseUrl: env,
    })
    expect(stampAdminFields).toHaveBeenCalledWith({
      baseUrl: server.baseUrl,
      adminToken: server.adminToken,
      id: 'r9',
      adminField01: 'acct-a',
    })
    expect(out.map((i) => i.id)).toEqual(['r9'])
  })

  it('não grava nada quando não há o que adotar', async () => {
    const instances = [inst({ id: 'r9', adminField01: 'acct-b' })]
    const out = await adoptForAccount(server, instances, 'acct-a', {
      config: { uazapi_base_url: env, uazapi_instance_id: 'r9', uazapi_instance_name: 'Metalis' },
      envBaseUrl: env,
    })
    expect(stampAdminFields).not.toHaveBeenCalled()
    expect(out).toEqual([])
  })

  it('não deixa uma falha do carimbo derrubar a listagem', async () => {
    stampAdminFields.mockRejectedValue(new Error('uazapi fora do ar'))
    const instances = [inst({ id: 'r9', name: 'Metalis', adminField01: '' })]
    const out = await adoptForAccount(server, instances, 'acct-a', {
      config: { uazapi_base_url: env, uazapi_instance_id: 'r9', uazapi_instance_name: 'Metalis' },
      envBaseUrl: env,
    })
    // O carimbo é oportunista; o painel ainda deve abrir.
    expect(out).toEqual([])
  })
})

describe('loadInstances', () => {
  beforeEach(() => listInstances.mockReset())

  it('repassa as credenciais do servidor', async () => {
    listInstances.mockResolvedValue([])
    await loadInstances(server)
    expect(listInstances).toHaveBeenCalledWith({
      baseUrl: server.baseUrl,
      adminToken: server.adminToken,
    })
  })
})
