import { describe, expect, it } from 'vitest'

import {
  buildBindInsert,
  buildBindRow,
  decideBindConflict,
} from '@/lib/whatsapp/uazapi-bind'

describe('decideBindConflict', () => {
  const base = {
    newInstanceId: 'r-new',
    newInstanceName: 'Carolina',
    replaceExisting: false,
  }

  it('libera quando a empresa não tem config nenhuma', () => {
    expect(decideBindConflict({ ...base, current: null })).toBeNull()
  })

  it('libera quando já está vinculada à mesma instância', () => {
    const current = {
      provider: 'uazapi', status: 'connected', uazapi_instance_id: 'r-new',
      uazapi_instance_name: 'Carolina', phone_number_id: null,
    }
    expect(decideBindConflict({ ...base, current })).toBeNull()
  })

  it('bloqueia a troca de uma instância uazapi conectada', () => {
    const current = {
      provider: 'uazapi', status: 'connected', uazapi_instance_id: 'r-old',
      uazapi_instance_name: 'Metalis', phone_number_id: null,
    }
    const conflict = decideBindConflict({ ...base, current })
    expect(conflict?.reason).toBe('replace_uazapi')
    expect(conflict?.currentInstanceName).toBe('Metalis')
  })

  it('libera a troca quando o chamador confirmou', () => {
    const current = {
      provider: 'uazapi', status: 'connected', uazapi_instance_id: 'r-old',
      uazapi_instance_name: 'Metalis', phone_number_id: null,
    }
    expect(decideBindConflict({ ...base, current, replaceExisting: true })).toBeNull()
  })

  it('libera a troca de uma instância uazapi desconectada sem confirmação', () => {
    const current = {
      provider: 'uazapi', status: 'disconnected', uazapi_instance_id: 'r-old',
      uazapi_instance_name: 'Metalis', phone_number_id: null,
    }
    expect(decideBindConflict({ ...base, current })).toBeNull()
  })

  it('bloqueia sobrescrever uma config Meta preenchida', () => {
    const current = {
      provider: 'meta', status: 'connected', uazapi_instance_id: null,
      uazapi_instance_name: null, phone_number_id: '123456789',
    }
    expect(decideBindConflict({ ...base, current })?.reason).toBe('replace_meta')
  })

  it('libera quando a linha é Meta mas está vazia', () => {
    const current = {
      provider: 'meta', status: 'disconnected', uazapi_instance_id: null,
      uazapi_instance_name: null, phone_number_id: null,
    }
    expect(decideBindConflict({ ...base, current })).toBeNull()
  })

  it('libera a sobrescrita de Meta quando confirmada', () => {
    const current = {
      provider: 'meta', status: 'connected', uazapi_instance_id: null,
      uazapi_instance_name: null, phone_number_id: '123456789',
    }
    expect(decideBindConflict({ ...base, current, replaceExisting: true })).toBeNull()
  })
})

describe('buildBindRow / buildBindInsert', () => {
  const instance = { id: 'r-new', name: 'Carolina', token: 'raw-token', status: 'connected' }
  const fakeEncrypt = (raw: string) => `enc(${raw})`

  it('nunca grava o token em claro', () => {
    const row = buildBindRow({ baseUrl: 'https://newphone.uazapi.com', instance, encryptToken: fakeEncrypt })
    expect(row.uazapi_token).toBe('enc(raw-token)')
    expect(Object.values(row).some((value) => value === 'raw-token')).toBe(false)
  })

  it('grava id e nome, e zera os campos do provider Meta', () => {
    const row = buildBindRow({ baseUrl: 'https://newphone.uazapi.com', instance, encryptToken: fakeEncrypt })
    expect(row).toMatchObject({
      uazapi_instance_id: 'r-new', uazapi_instance_name: 'Carolina',
      uazapi_base_url: 'https://newphone.uazapi.com', provider: 'uazapi',
      phone_number_id: null, waba_id: null,
    })
  })

  it('espelha o status real da instância', () => {
    expect(buildBindRow({ baseUrl: 'https://x', instance, encryptToken: fakeEncrypt }).status).toBe('connected')
    expect(buildBindRow({ baseUrl: 'https://x', instance: { ...instance, status: 'offline' }, encryptToken: fakeEncrypt }).status).toBe('disconnected')
  })

  it('o INSERT carrega user_id', () => {
    const row = buildBindRow({ baseUrl: 'https://x', instance, encryptToken: fakeEncrypt })
    expect(buildBindInsert(row, 'acct-a', 'user-1')).toMatchObject({
      account_id: 'acct-a', user_id: 'user-1', uazapi_instance_id: 'r-new',
    })
  })
})
