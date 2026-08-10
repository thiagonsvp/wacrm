import { describe, expect, it } from 'vitest'
import { buildEventPayload, type MetaCapiConfig, type MetaCapiEvent } from './capi'

/**
 * Click-to-WhatsApp conversions are only attributable under the
 * `business_messaging` contract, and Meta refuses that contract without
 * an identifier for the business:
 *
 *   subcode 2804116 — "não tem um parâmetro page_id ou
 *   whatsapp_business_account_id"
 *
 * UAZAPI accounts have no WABA id, so before this the CRM fell back to
 * `action_source: 'other'` — events Meta accepts and attributes to
 * nothing. Verified live on 2026-08-10: 25 qualified leads and 1 purchase
 * received, zero conversions on the campaign.
 */
const BASE: MetaCapiConfig = {
  datasetId: '4393482854268444',
  accessToken: 'tok',
  wabaId: null,
  pageId: null,
  testEventCode: null,
}

function event(over: Partial<MetaCapiEvent> = {}): MetaCapiEvent {
  return {
    eventName: 'QualifiedLead',
    eventId: 'deal-1:QualifiedLead',
    eventTime: new Date('2026-08-10T12:00:00Z'),
    ctwaClid: 'Afh3VOZ2-hH_0V7UgZaa0lTG',
    phone: '5521981378310',
    value: null,
    currency: null,
    ...over,
  }
}

describe('page_id unlocks attribution without a WABA id', () => {
  it('uses the attributable contract when only a page id is known', () => {
    const p = buildEventPayload(event(), { ...BASE, pageId: '129285426937638' })
    expect(p.action_source).toBe('business_messaging')
    expect(p.messaging_channel).toBe('whatsapp')
  })

  it('sends page_id and the UNHASHED click id', () => {
    const p = buildEventPayload(event(), { ...BASE, pageId: '129285426937638' })
    const ud = p.user_data as Record<string, unknown>
    expect(ud.page_id).toBe('129285426937638')
    expect(ud.ctwa_clid).toBe('Afh3VOZ2-hH_0V7UgZaa0lTG')
  })

  it('prefers the WABA id and does not send both', () => {
    // On the official API the WABA id is the more specific identifier;
    // sending both invites the page/dataset mismatch (subcode 2804065).
    const p = buildEventPayload(event(), {
      ...BASE,
      wabaId: '9876543210',
      pageId: '129285426937638',
    })
    const ud = p.user_data as Record<string, unknown>
    expect(ud.whatsapp_business_account_id).toBe('9876543210')
    expect('page_id' in ud).toBe(false)
  })

  it('still falls back to the generic contract when neither is set', () => {
    // Accepted by Meta, attributed to nothing — the state that produced
    // the empty campaign report. Kept so an unconfigured account does not
    // start erroring, but it must never look like the attributable path.
    const p = buildEventPayload(event(), BASE)
    expect(p.action_source).toBe('other')
    expect(p.messaging_channel).toBeUndefined()
    expect((p.user_data as Record<string, unknown>).ctwa_clid).toBeUndefined()
  })

  it('carries value and currency on a Purchase with a page id', () => {
    const p = buildEventPayload(
      event({ eventName: 'Purchase', value: 7400, currency: 'BRL' }),
      { ...BASE, pageId: '129285426937638' },
    )
    expect(p.custom_data).toEqual({ currency: 'BRL', value: 7400 })
    expect((p.user_data as Record<string, unknown>).page_id).toBe('129285426937638')
  })
})
