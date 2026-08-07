import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendMetaCapiEvent, type MetaCapiConfig, type MetaCapiEvent } from './capi'

/**
 * Regression cover for the 2026-08-06 rejection: a R$7.400 sale fired
 * with value 0 because the AI read the purchase signal before the price
 * was agreed. `buildEventPayload` omits custom_data for a zero value, so
 * the currency vanished with it and Meta answered "Moeda ausente para o
 * evento de compra" (code 100, subcode 2804010).
 */
const CONFIG: MetaCapiConfig = {
  datasetId: '4393482854268444',
  accessToken: 'tok',
  wabaId: null, // UAZAPI — the generic dataset contract
  testEventCode: null,
}

function purchase(over: Partial<MetaCapiEvent> = {}): MetaCapiEvent {
  return {
    eventName: 'Purchase',
    eventId: 'deal-1:Purchase',
    eventTime: new Date('2026-08-06T19:15:47Z'),
    ctwaClid: 'Afip-idO9g5lUmU',
    phone: '5521987888047',
    value: 7400,
    currency: 'BRL',
    ...over,
  }
}

describe('Purchase must carry an amount', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ events_received: 1 }), { status: 200 }),
    )
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-06T20:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('refuses a zero-value Purchase without spending a request', async () => {
    const res = await sendMetaCapiEvent(purchase({ value: 0 }), CONFIG)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/positive value/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a null-value Purchase too', async () => {
    const res = await sendMetaCapiEvent(purchase({ value: null }), CONFIG)
    expect(res.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marks the refusal retryable — the price may arrive later', async () => {
    // The whole point: this is "not priced yet", not "permanently bad".
    // A non-retryable verdict would strand the sale forever.
    const res = await sendMetaCapiEvent(purchase({ value: 0 }), CONFIG)
    expect(res.retryable).toBe(true)
  })

  it('sends a priced Purchase with both value and currency', async () => {
    const res = await sendMetaCapiEvent(purchase(), CONFIG)
    expect(res.ok).toBe(true)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.data[0].custom_data).toEqual({ value: 7400, currency: 'BRL' })
  })

  it('never lets a Purchase reach Meta without custom_data', async () => {
    // The exact shape Meta rejected: a Purchase whose payload has no
    // custom_data key at all.
    for (const value of [0, null, -1, undefined]) {
      fetchMock.mockClear()
      await sendMetaCapiEvent(purchase({ value: value as number | null }), CONFIG)
      for (const call of fetchMock.mock.calls) {
        const sentBody = JSON.parse(call[1].body as string)
        const evt = sentBody.data[0]
        if (evt.event_name === 'Purchase') expect(evt.custom_data).toBeDefined()
      }
    }
  })

  it('still allows a QualifiedLead with no amount', async () => {
    // Only Purchase carries money; gating leads on a value would stop
    // the event this integration fires most.
    const res = await sendMetaCapiEvent(
      purchase({ eventName: 'QualifiedLead', value: null, currency: null }),
      CONFIG,
    )
    expect(res.ok).toBe(true)
  })
})
