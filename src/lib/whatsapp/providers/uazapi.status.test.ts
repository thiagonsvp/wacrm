import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getInstanceStatus } from './uazapi'

/**
 * The token is per-instance, so `/instance/status` is the only
 * authoritative answer to "which instance do these credentials belong
 * to?". The config route relies on that to refuse a save that would bind
 * one company to another company's WhatsApp — see the 2026-08-06
 * incident note in src/app/api/whatsapp/config/route.ts.
 */
describe('getInstanceStatus — instance identity', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  function reply(instance: Record<string, unknown>) {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ instance, status: { connected: true } }), {
        status: 200,
      }),
    )
  }

  it('reports which instance the token actually belongs to', async () => {
    reply({ name: 'smart', owner: '5521995641438', profileName: 'Smart Apple', status: 'connected' })
    const res = await getInstanceStatus({ baseUrl: 'https://x.uazapi.com', token: 'tok' })
    expect(res.instanceName).toBe('smart')
    expect(res.owner).toBe('5521995641438')
    expect(res.profileName).toBe('Smart Apple')
  })

  it('exposes a name that contradicts the caller, rather than echoing it', async () => {
    // This is the whole point: the caller said "smart", the token says
    // "Connect". Saving the caller's word is what corrupted the config.
    reply({ name: 'Connect', owner: '5521980653374' })
    const res = await getInstanceStatus({ baseUrl: 'https://x.uazapi.com', token: 'connect-token' })
    expect(res.instanceName).toBe('Connect')
    expect(res.instanceName).not.toBe('smart')
  })

  it('leaves the name undefined when UAZAPI omits it', async () => {
    // A master/admin token has no instance yet — the caller must treat
    // this as "unknown" and skip the guard, not as a mismatch.
    reply({ status: 'disconnected' })
    const res = await getInstanceStatus({ baseUrl: 'https://x.uazapi.com', token: 'master' })
    expect(res.instanceName).toBeUndefined()
  })

  it('sends the token as a header, never in the URL', async () => {
    reply({ name: 'smart' })
    await getInstanceStatus({ baseUrl: 'https://x.uazapi.com', token: 'secret-tok' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).not.toContain('secret-tok')
    expect((init.headers as Record<string, string>).token).toBe('secret-tok')
  })

  it('throws on a non-ok response instead of reporting a bogus identity', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 }))
    await expect(
      getInstanceStatus({ baseUrl: 'https://x.uazapi.com', token: 'bad' }),
    ).rejects.toThrow()
  })
})
