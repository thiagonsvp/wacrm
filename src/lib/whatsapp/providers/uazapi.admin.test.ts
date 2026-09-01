import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createInstance,
  listInstances,
  stampAdminFields,
  renameInstance,
  setWebhook,
} from './uazapi'

/**
 * Endpoints administrativos da uazapiGO v2.1.1, verificados contra um
 * servidor real em 2026-08-31. O detalhe que estes testes existem para
 * travar: o admin token vai no header `admintoken`. Mandá-lo no header
 * `token` — como o código fazia — responde 401.
 */
describe('uazapi — endpoints administrativos', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  function ok(body: unknown) {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 }),
    )
  }

  describe('createInstance', () => {
    it('autentica com o header admintoken, nunca com token', async () => {
      ok({ instance: { id: 'r1', name: 'nova' }, token: 'inst-tok' })
      await createInstance({
        baseUrl: 'https://x.uazapi.com',
        adminToken: 'admin-secret',
        name: 'nova',
      })
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://x.uazapi.com/instance/create')
      const headers = init.headers as Record<string, string>
      expect(headers.admintoken).toBe('admin-secret')
      expect(headers.token).toBeUndefined()
    })

    it('lê o token do topo da resposta', async () => {
      ok({ instance: { id: 'r1' }, token: 'top-level-token' })
      const res = await createInstance({
        baseUrl: 'https://x.uazapi.com',
        adminToken: 'a',
        name: 'nova',
      })
      expect(res.token).toBe('top-level-token')
      expect(res.id).toBe('r1')
    })

    it('cai para instance.token quando o topo não traz o token', async () => {
      ok({ instance: { id: 'r2', token: 'nested-token' } })
      const res = await createInstance({
        baseUrl: 'https://x.uazapi.com',
        adminToken: 'a',
        name: 'nova',
      })
      expect(res.token).toBe('nested-token')
      expect(res.id).toBe('r2')
    })

    it('envia adminField01 no corpo quando informado', async () => {
      ok({ instance: { id: 'r1' }, token: 't' })
      await createInstance({
        baseUrl: 'https://x.uazapi.com',
        adminToken: 'a',
        name: 'nova',
        adminField01: 'acct-123',
      })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body).toEqual({ name: 'nova', adminField01: 'acct-123' })
    })

    it('lança quando a resposta não traz token, em vez de devolver undefined', async () => {
      ok({ instance: { id: 'r1' } })
      await expect(
        createInstance({ baseUrl: 'https://x.uazapi.com', adminToken: 'a', name: 'n' }),
      ).rejects.toThrow(/token/i)
    })

    it('lança com a mensagem do servidor num erro HTTP', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: 'invalid admintoken' }), { status: 401 }),
      )
      await expect(
        createInstance({ baseUrl: 'https://x.uazapi.com', adminToken: 'bad', name: 'n' }),
      ).rejects.toThrow('invalid admintoken')
    })
  })

  describe('listInstances', () => {
    it('devolve o array do servidor', async () => {
      ok([
        { id: 'r1', name: 'smart', token: 't1', status: 'disconnected', adminField01: '' },
        { id: 'r2', name: 'Metalis', token: 't2', status: 'connected', adminField01: 'acct-a' },
      ])
      const res = await listInstances({ baseUrl: 'https://x.uazapi.com', adminToken: 'a' })
      expect(res).toHaveLength(2)
      expect(res[1].adminField01).toBe('acct-a')
    })

    it('usa o header admintoken e nunca põe o token na URL', async () => {
      ok([])
      await listInstances({ baseUrl: 'https://x.uazapi.com', adminToken: 'admin-secret' })
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://x.uazapi.com/instance/all')
      expect(url).not.toContain('admin-secret')
      expect((init.headers as Record<string, string>).admintoken).toBe('admin-secret')
    })

    it('devolve lista vazia quando o servidor responde algo que não é array', async () => {
      ok({ response: 'ok' })
      const res = await listInstances({ baseUrl: 'https://x.uazapi.com', adminToken: 'a' })
      expect(res).toEqual([])
    })
  })

  describe('stampAdminFields', () => {
    it('manda id e adminField01 com o admintoken', async () => {
      ok({ id: 'r1' })
      await stampAdminFields({
        baseUrl: 'https://x.uazapi.com',
        adminToken: 'admin-secret',
        id: 'r1',
        adminField01: 'acct-a',
      })
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://x.uazapi.com/instance/updateAdminFields')
      expect((init.headers as Record<string, string>).admintoken).toBe('admin-secret')
      expect(JSON.parse(init.body as string)).toEqual({ id: 'r1', adminField01: 'acct-a' })
    })
  })

  describe('renameInstance', () => {
    it('usa o token da instância, não o admintoken', async () => {
      ok({ id: 'r1', name: 'novo' })
      await renameInstance({
        baseUrl: 'https://x.uazapi.com',
        token: 'inst-tok',
        name: 'novo',
      })
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://x.uazapi.com/instance/updateInstanceName')
      const headers = init.headers as Record<string, string>
      expect(headers.token).toBe('inst-tok')
      expect(headers.admintoken).toBeUndefined()
      expect(JSON.parse(init.body as string)).toEqual({ name: 'novo' })
    })
  })

  describe('setWebhook', () => {
    it('habilita por padrão', async () => {
      ok({})
      await setWebhook({
        baseUrl: 'https://x.uazapi.com',
        token: 't',
        webhookUrl: 'https://crm.test/hook',
      })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.enabled).toBe(true)
      expect(body.url).toBe('https://crm.test/hook')
    })

    it('desabilita quando enabled: false — é como o bind desliga a instância anterior', async () => {
      ok({})
      await setWebhook({
        baseUrl: 'https://x.uazapi.com',
        token: 'old-tok',
        webhookUrl: 'https://crm.test/hook',
        enabled: false,
      })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.enabled).toBe(false)
    })
  })
})
