import { describe, expect, it } from 'vitest'
import { parseAcquisitionFromText } from './acquisition-text'

const GCLID = 'Cj0KCQjw5ZKmBhCBARIsAOc7Rx0abc-_123'

describe('parseAcquisitionFromText — Google', () => {
  it('reads the bracket form the site button emits', () => {
    // The shape Metalis' site already uses for its button label.
    const out = parseAcquisitionFromText(
      `[Home-Float][gclid:${GCLID}] Olá! Gostaria de um orçamento.`,
    )
    expect(out).toEqual({ gclid: GCLID, source: 'Google' })
  })

  it('reads the query-string form', () => {
    const out = parseAcquisitionFromText(
      `Olá! Vim pelo site ?gclid=${GCLID}&utm_campaign=institucional`,
    )
    expect(out).toEqual({
      gclid: GCLID,
      campaign: 'institucional',
      source: 'Google',
    })
  })

  it('accepts wbraid and gbraid, which replace gclid on iOS', () => {
    expect(parseAcquisitionFromText('[wbraid:AbC-123]').gclid).toBe('AbC-123')
    expect(parseAcquisitionFromText('[gbraid:AbC-123]').gclid).toBe('AbC-123')
    expect(parseAcquisitionFromText('[wbraid:AbC-123]').source).toBe('Google')
  })

  it('decodes a url-encoded campaign name', () => {
    const out = parseAcquisitionFromText('gclid=x1 utm_campaign=black%20friday')
    expect(out.campaign).toBe('black friday')
  })

  it('treats + as a space in a campaign name', () => {
    expect(parseAcquisitionFromText('gclid=x1&utm_campaign=venda+de+verao').campaign)
      .toBe('venda de verao')
  })

  it('does not swallow the human part of the message', () => {
    const out = parseAcquisitionFromText(`[gclid:${GCLID}] Preciso de 12 buchas`)
    expect(out.gclid).toBe(GCLID)
  })

  it('tolerates spacing and the equals form inside brackets', () => {
    expect(parseAcquisitionFromText('[ gclid = abc123 ]').gclid).toBe('abc123')
  })
})

describe('parseAcquisitionFromText — utm_source', () => {
  it('maps an explicit utm_source', () => {
    expect(parseAcquisitionFromText('oi utm_source=google').source).toBe('Google')
    expect(parseAcquisitionFromText('oi utm_source=facebook').source).toBe('Facebook')
    expect(parseAcquisitionFromText('oi utm_source=instagram').source).toBe('Instagram')
  })

  it('ignores utm_source=qr from a pasted Instagram profile link', () => {
    // This one shows up in real traffic and is not a campaign at all.
    const out = parseAcquisitionFromText(
      'https://www.instagram.com/connect.especializada?utm_source=qr',
    )
    expect(out.source).toBeUndefined()
    expect(out.gclid).toBeUndefined()
  })
})

describe('parseAcquisitionFromText — nothing to read', () => {
  it.each([
    '[Home-Float] Olá! Gostaria de um orçamento.',
    'bom dia',
    'https://www.instagram.com/p/Dbnu-aNMf4Z/',
    '',
  ])('returns an empty object for %j', (text) => {
    expect(parseAcquisitionFromText(text)).toEqual({})
  })

  it('handles null and undefined', () => {
    expect(parseAcquisitionFromText(null)).toEqual({})
    expect(parseAcquisitionFromText(undefined)).toEqual({})
  })

  it('ignores an absurdly long value rather than storing it', () => {
    expect(parseAcquisitionFromText(`[gclid:${'a'.repeat(600)}]`)).toEqual({})
  })
})
