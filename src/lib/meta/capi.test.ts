import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildEventPayload,
  hashIdentifier,
  isWithinEventWindow,
  normalizePhoneForHash,
  sendMetaCapiEvent,
  MAX_EVENT_AGE_MS,
  type MetaCapiConfig,
  type MetaCapiEvent,
} from './capi'

const CONFIG: MetaCapiConfig = {
  datasetId: '1234567890',
  accessToken: 'tok-secret',
  wabaId: '9876543210',
  testEventCode: null,
}

function event(over: Partial<MetaCapiEvent> = {}): MetaCapiEvent {
  return {
    eventName: 'Purchase',
    eventId: 'deal-1:Purchase',
    eventTime: new Date('2026-07-30T12:00:00Z'),
    ctwaClid: 'Afip-idO9g5lUmU',
    phone: '5521987888047',
    value: 4499,
    currency: 'BRL',
    ...over,
  }
}

describe('buildEventPayload', () => {
  it('uses the business_messaging / whatsapp contract', () => {
    const p = buildEventPayload(event(), CONFIG)
    expect(p.action_source).toBe('business_messaging')
    expect(p.messaging_channel).toBe('whatsapp')
    expect(p.event_name).toBe('Purchase')
  })

  it('sends event_time as unix seconds, not milliseconds', () => {
    const p = buildEventPayload(
      event({ eventTime: new Date('2026-07-30T12:00:00Z') }),
      CONFIG,
    )
    expect(p.event_time).toBe(Math.floor(Date.parse('2026-07-30T12:00:00Z') / 1000))
  })

  it('passes ctwa_clid through UNHASHED', () => {
    // Hashing Meta's own click token would break attribution entirely
    // while still returning a success response.
    const p = buildEventPayload(event(), CONFIG)
    const ud = p.user_data as Record<string, unknown>
    expect(ud.ctwa_clid).toBe('Afip-idO9g5lUmU')
  })

  it('hashes the phone with SHA-256 and never sends it in the clear', () => {
    const p = buildEventPayload(event(), CONFIG)
    const ud = p.user_data as Record<string, unknown>
    expect(ud.ph).toBe(hashIdentifier('5521987888047'))
    expect(ud.ph).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(p)).not.toContain('5521987888047')
  })

  it('includes the WhatsApp business account id Meta requires', () => {
    const p = buildEventPayload(event(), CONFIG)
    const ud = p.user_data as Record<string, unknown>
    expect(ud.whatsapp_business_account_id).toBe('9876543210')
  })

  it('omits the waba id rather than sending null when unknown', () => {
    const p = buildEventPayload(event(), { ...CONFIG, wabaId: null })
    const ud = p.user_data as Record<string, unknown>
    expect('whatsapp_business_account_id' in ud).toBe(false)
  })

  it('uses the generic contract for UAZAPI without WhatsApp-only fields', () => {
    const p = buildEventPayload(event(), { ...CONFIG, wabaId: null })
    expect(p.action_source).toBe('other')
    expect(p.messaging_channel).toBeUndefined()
    expect((p.user_data as Record<string, unknown>).ctwa_clid).toBeUndefined()
  })

  it('attaches value and currency when there is a real amount', () => {
    const p = buildEventPayload(event({ value: 4499, currency: 'brl' }), CONFIG)
    expect(p.custom_data).toEqual({ currency: 'BRL', value: 4499 })
  })

  it('omits custom_data for a zero or missing value', () => {
    // value: 0 would teach Meta these conversions are worthless.
    expect(buildEventPayload(event({ value: 0 }), CONFIG).custom_data).toBeUndefined()
    expect(buildEventPayload(event({ value: null }), CONFIG).custom_data).toBeUndefined()
  })

  it('omits the phone when the contact has none', () => {
    const p = buildEventPayload(event({ phone: null }), CONFIG)
    expect('ph' in (p.user_data as Record<string, unknown>)).toBe(false)
  })
})

describe('hashing helpers', () => {
  it('normalises phones to digits only', () => {
    expect(normalizePhoneForHash('+55 (21) 98788-8047')).toBe('5521987888047')
  })

  it('trims and lowercases before hashing, per Meta', () => {
    expect(hashIdentifier('  ABC  ')).toBe(hashIdentifier('abc'))
  })
})

describe('isWithinEventWindow', () => {
  const now = new Date('2026-07-30T12:00:00Z')

  it('accepts a fresh event', () => {
    expect(isWithinEventWindow(new Date('2026-07-30T11:00:00Z'), now)).toBe(true)
  })

  it('rejects an event older than 7 days', () => {
    const old = new Date(now.getTime() - MAX_EVENT_AGE_MS - 1000)
    expect(isWithinEventWindow(old, now)).toBe(false)
  })

  it('rejects just inside 7 days, keeping a safety margin', () => {
    // Meta rejects the WHOLE request for one stale event, so the
    // boundary is deliberately conservative.
    const edge = new Date(now.getTime() - MAX_EVENT_AGE_MS + 60_000)
    expect(isWithinEventWindow(edge, now)).toBe(false)
  })

  it('rejects a future timestamp as a clock problem', () => {
    expect(isWithinEventWindow(new Date('2026-07-31T12:00:00Z'), now)).toBe(false)
  })
})

describe('sendMetaCapiEvent', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-30T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('posts to the dataset events endpoint with a bearer token', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ events_received: 1 }), { status: 200 }),
    )
    const res = await sendMetaCapiEvent(event(), CONFIG)
    expect(res.ok).toBe(true)
    expect(res.received).toBe(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/1234567890/events')
    expect(url).toContain('graph.facebook.com')
    // The token must not ride in the query string, where it would be
    // captured by access logs.
    expect(url).not.toContain('tok-secret')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok-secret',
    )
  })

  it('sends exactly one event per request', async () => {
    // Meta rejects an entire batch when any single event is bad, so one
    // malformed deal must not be able to drop the others.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ events_received: 1 }), { status: 200 }),
    )
    await sendMetaCapiEvent(event(), CONFIG)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.data).toHaveLength(1)
  })

  it('includes test_event_code when configured', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ events_received: 1 }), { status: 200 }),
    )
    await sendMetaCapiEvent(event(), { ...CONFIG, testEventCode: 'TEST123' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.test_event_code).toBe('TEST123')
  })

  it('refuses official WhatsApp events without a ctwa_clid', async () => {
    const res = await sendMetaCapiEvent(event({ ctwaClid: '' }), CONFIG)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('ctwa_clid')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends a generic event for UAZAPI without a ctwa_clid', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ events_received: 1 }), { status: 200 }),
    )
    const res = await sendMetaCapiEvent(event({ ctwaClid: '' }), {
      ...CONFIG,
      wabaId: null,
    })
    expect(res.ok).toBe(true)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.data[0].action_source).toBe('other')
    expect(body.data[0].user_data.ctwa_clid).toBeUndefined()
  })

  it('refuses a stale event without spending a request', async () => {
    const stale = new Date(Date.now() - MAX_EVENT_AGE_MS - 1000)
    const res = await sendMetaCapiEvent(event({ eventTime: stale }), CONFIG)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('7-day')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a Meta error message and marks 4xx non-retryable', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid dataset' } }), {
        status: 400,
      }),
    )
    const res = await sendMetaCapiEvent(event(), CONFIG)
    expect(res.ok).toBe(false)
    expect(res.error).toBe('Invalid dataset')
    expect(res.retryable).toBe(false)
  })

  it('marks 5xx and 429 retryable', async () => {
    for (const status of [429, 500, 503]) {
      fetchMock.mockResolvedValue(new Response('{}', { status }))
      const res = await sendMetaCapiEvent(event(), CONFIG)
      expect(res.ok, `status=${status}`).toBe(false)
      expect(res.retryable, `status=${status}`).toBe(true)
    }
  })

  it('never throws on a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    const res = await sendMetaCapiEvent(event(), CONFIG)
    expect(res.ok).toBe(false)
    expect(res.retryable).toBe(true)
    expect(res.error).toContain('ECONNRESET')
  })

  it('tolerates a non-JSON error body', async () => {
    fetchMock.mockResolvedValue(new Response('<html>502</html>', { status: 502 }))
    const res = await sendMetaCapiEvent(event(), CONFIG)
    expect(res.ok).toBe(false)
    expect(res.retryable).toBe(true)
  })
})
