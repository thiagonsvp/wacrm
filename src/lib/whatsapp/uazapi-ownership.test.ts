import { describe, expect, it } from 'vitest'
import type { UazapiInstance } from './providers/uazapi'
import {
  toPublicInstance,
  ownedBy,
  unowned,
  findOwned,
  planStamp,
  sameServer,
} from './uazapi-ownership'

function inst(over: Partial<UazapiInstance> = {}): UazapiInstance {
  return {
    id: 'r1',
    token: 'super-secret-token',
    name: 'Metalis',
    status: 'connected',
    owner: '5521988398031',
    profileName: 'Metalis',
    adminField01: '',
    adminField02: '',
    created: '2026-08-25T15:03:50.213Z',
    ...over,
  }
}

describe('toPublicInstance — o token nunca vai para o browser', () => {
  it('não inclui token nem campos administrativos no payload público', () => {
    const pub = toPublicInstance(
      inst({ adminField01: 'acct-a', adminField02: 'nota interna' }),
    )
    expect(pub).not.toHaveProperty('token')
    expect(pub).not.toHaveProperty('adminField01')
    expect(pub).not.toHaveProperty('adminField02')
    expect(pub).not.toHaveProperty('openai_apikey')
  })

  it('não vaza o token nem quando a instância traz chaves extras do servidor', () => {
    const withExtras = {
      ...inst(),
      openai_apikey: 'sk-secret',
      chatbot_enabled: true,
    } as unknown as UazapiInstance
    const serialized = JSON.stringify(toPublicInstance(withExtras))
    expect(serialized).not.toContain('super-secret-token')
    expect(serialized).not.toContain('sk-secret')
  })

  it('preserva os campos que a UI precisa', () => {
    const pub = toPublicInstance(inst())
    expect(pub).toEqual({
      id: 'r1',
      name: 'Metalis',
      status: 'connected',
      owner: '5521988398031',
      profileName: 'Metalis',
      profilePicUrl: undefined,
      created: '2026-08-25T15:03:50.213Z',
    })
  })
})

describe('ownedBy / unowned / findOwned', () => {
  const all = [
    inst({ id: 'r1', name: 'smart', adminField01: '' }),
    inst({ id: 'r2', name: 'Metalis', adminField01: 'acct-a' }),
    inst({ id: 'r3', name: 'Connect', adminField01: 'acct-b' }),
  ]

  it('devolve só as da empresa', () => {
    expect(ownedBy(all, 'acct-a').map((i) => i.id)).toEqual(['r2'])
  })

  it('não trata carimbo vazio como pertencente a ninguém em particular', () => {
    expect(ownedBy(all, '').map((i) => i.id)).toEqual([])
  })

  it('lista as órfãs, tratando ausente e string vazia como órfã', () => {
    const withMissing = [...all, inst({ id: 'r4', adminField01: undefined })]
    expect(unowned(withMissing).map((i) => i.id)).toEqual(['r1', 'r4'])
  })

  it('acha a instância da empresa pelo id', () => {
    expect(findOwned(all, 'acct-a', 'r2')?.name).toBe('Metalis')
  })

  it('recusa a instância de outra empresa — esta é a fronteira de segurança', () => {
    expect(findOwned(all, 'acct-a', 'r3')).toBeNull()
  })

  it('recusa uma instância órfã: possuir exige carimbo', () => {
    expect(findOwned(all, 'acct-a', 'r1')).toBeNull()
  })

  it('devolve null para id inexistente', () => {
    expect(findOwned(all, 'acct-a', 'nope')).toBeNull()
  })
})

describe('sameServer', () => {
  it('ignora barra final e caixa do host', () => {
    expect(sameServer('https://newphone.uazapi.com/', 'https://newphone.uazapi.com')).toBe(true)
    expect(sameServer('https://NewPhone.uazapi.com', 'https://newphone.uazapi.com')).toBe(true)
  })

  it('distingue servidores diferentes', () => {
    expect(sameServer('https://old.uazapi.com', 'https://newphone.uazapi.com')).toBe(false)
  })

  it('é falso quando algum lado falta', () => {
    expect(sameServer(null, 'https://x.uazapi.com')).toBe(false)
    expect(sameServer('https://x.uazapi.com', undefined)).toBe(false)
  })
})

describe('planStamp — adoção da instância legada', () => {
  const env = 'https://newphone.uazapi.com'
  const orphan = inst({ id: 'r9', name: 'Metalis', adminField01: '' })

  it('adota pelo id quando a linha já tem uazapi_instance_id', () => {
    const target = {
      config: { uazapi_base_url: env, uazapi_instance_id: 'r9', uazapi_instance_name: 'nome-antigo' },
      envBaseUrl: env,
    }
    expect(planStamp([orphan], 'acct-a', target)?.id).toBe('r9')
  })

  it('adota pelo nome quando a linha é legada e não tem id', () => {
    const target = {
      config: { uazapi_base_url: env, uazapi_instance_id: null, uazapi_instance_name: 'Metalis' },
      envBaseUrl: env,
    }
    expect(planStamp([orphan], 'acct-a', target)?.id).toBe('r9')
  })

  it('NÃO adota quando a empresa aponta para outro servidor, mesmo com nome igual', () => {
    // Sem esta guarda, uma empresa em old.uazapi.com reivindicaria uma
    // instância homônima do servidor do env — de outra empresa.
    const target = {
      config: { uazapi_base_url: 'https://old.uazapi.com', uazapi_instance_id: null, uazapi_instance_name: 'Metalis' },
      envBaseUrl: env,
    }
    expect(planStamp([orphan], 'acct-a', target)).toBeNull()
  })

  it('nunca sobrescreve o carimbo de outra empresa', () => {
    const taken = inst({ id: 'r9', name: 'Metalis', adminField01: 'acct-b' })
    const target = {
      config: { uazapi_base_url: env, uazapi_instance_id: 'r9', uazapi_instance_name: 'Metalis' },
      envBaseUrl: env,
    }
    expect(planStamp([taken], 'acct-a', target)).toBeNull()
  })

  it('é idempotente: nada a fazer quando já está carimbada para a própria empresa', () => {
    const mine = inst({ id: 'r9', adminField01: 'acct-a' })
    const target = {
      config: { uazapi_base_url: env, uazapi_instance_id: 'r9', uazapi_instance_name: 'Metalis' },
      envBaseUrl: env,
    }
    expect(planStamp([mine], 'acct-a', target)).toBeNull()
  })

  it('não faz nada quando a empresa não tem config UAZAPI', () => {
    expect(planStamp([orphan], 'acct-a', { config: null, envBaseUrl: env })).toBeNull()
  })

  it('não adota por nome quando a linha tem id que não casa com ninguém', () => {
    // Id é a chave: existindo id, o nome não serve de desempate.
    const target = {
      config: { uazapi_base_url: env, uazapi_instance_id: 'r-outro', uazapi_instance_name: 'Metalis' },
      envBaseUrl: env,
    }
    expect(planStamp([orphan], 'acct-a', target)).toBeNull()
  })
})
