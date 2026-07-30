import { describe, expect, it } from 'vitest'
import { buildDealSignalPrompt, parseDealSignal } from './deal-signal'

describe('parseDealSignal — happy paths', () => {
  it('parses a clean object', () => {
    expect(
      parseDealSignal('{"outcome":"negotiating","model":"iPhone 15 Pro Max 256GB","price":4499}'),
    ).toEqual({
      outcome: 'negotiating',
      model: 'iPhone 15 Pro Max 256GB',
      price: 4499,
    })
  })

  it('tolerates markdown code fences', () => {
    const raw = '```json\n{"outcome":"won","model":"iPhone 14","price":2700}\n```'
    expect(parseDealSignal(raw)).toEqual({
      outcome: 'won',
      model: 'iPhone 14',
      price: 2700,
    })
  })

  it('tolerates a preamble sentence before the JSON', () => {
    const raw = 'Here is the classification:\n{"outcome":"qualified","model":null,"price":null}'
    expect(parseDealSignal(raw)).toEqual({
      outcome: 'qualified',
      model: null,
      price: null,
    })
  })

  it('accepts every valid outcome, case-insensitively', () => {
    for (const o of ['qualified', 'negotiating', 'won', 'lost', 'none']) {
      expect(parseDealSignal(`{"outcome":"${o.toUpperCase()}"}`)).toMatchObject({
        outcome: o,
      })
    }
  })

  it('collapses whitespace in the model', () => {
    expect(
      parseDealSignal('{"outcome":"qualified","model":"  iPhone   15  Pro  "}'),
    ).toMatchObject({ model: 'iPhone 15 Pro' })
  })
})

describe('parseDealSignal — rejects unusable output', () => {
  it('returns null for an unknown or missing outcome', () => {
    expect(parseDealSignal('{"outcome":"maybe"}')).toBeNull()
    expect(parseDealSignal('{"model":"iPhone 15"}')).toBeNull()
    expect(parseDealSignal('{"outcome":null}')).toBeNull()
  })

  it('returns null for non-JSON, empty, or non-object output', () => {
    expect(parseDealSignal('')).toBeNull()
    expect(parseDealSignal('   ')).toBeNull()
    expect(parseDealSignal('I cannot help with that.')).toBeNull()
    expect(parseDealSignal('{not json}')).toBeNull()
    expect(parseDealSignal('[1,2]')).toBeNull()
  })

  it('unwraps a lone object returned inside an array', () => {
    // Same classification, different envelope — accepted on purpose.
    expect(parseDealSignal('[{"outcome":"won","price":2700}]')).toMatchObject({
      outcome: 'won',
      price: 2700,
    })
  })

  it('fails closed on a multi-element array rather than picking one', () => {
    expect(
      parseDealSignal('[{"outcome":"won"},{"outcome":"lost"}]'),
    ).toBeNull()
  })
})

describe('parseDealSignal — field hardening', () => {
  it('treats model-shaped nulls as null', () => {
    for (const junk of ['null', 'N/A', 'none', 'unknown', '-', '']) {
      expect(
        parseDealSignal(`{"outcome":"qualified","model":${JSON.stringify(junk)}}`),
      ).toMatchObject({ model: null })
    }
  })

  it('caps an absurdly long model so it cannot become the card title', () => {
    const long = 'iPhone '.repeat(100)
    const out = parseDealSignal(`{"outcome":"qualified","model":${JSON.stringify(long)}}`)
    expect(out!.model!.length).toBeLessThanOrEqual(80)
  })

  it('parses a pt-BR formatted price string', () => {
    expect(parseDealSignal('{"outcome":"won","price":"R$ 4.199,00"}')).toMatchObject({
      price: 4199,
    })
    expect(parseDealSignal('{"outcome":"won","price":"3600"}')).toMatchObject({
      price: 3600,
    })
  })

  it('rejects nonsensical prices instead of writing them to the board', () => {
    for (const bad of ['0', '-500', '99999999', '"abc"', 'null', 'true']) {
      const out = parseDealSignal(`{"outcome":"negotiating","price":${bad}}`)
      expect(out, `price=${bad}`).not.toBeNull()
      expect(out!.price, `price=${bad}`).toBeNull()
    }
  })

  it('rounds fractional cents', () => {
    expect(parseDealSignal('{"outcome":"won","price":4199.999}')).toMatchObject({
      price: 4200,
    })
  })
})

describe('buildDealSignalPrompt', () => {
  const prompt = buildDealSignalPrompt({
    mainProduct: 'iPhone',
    businessContext: 'Loja TNS, Rio de Janeiro.',
  })

  it('states the product and the JSON-only contract', () => {
    expect(prompt).toContain('iPhone')
    expect(prompt).toContain('single JSON object and nothing else')
  })

  it('teaches every outcome in the taxonomy', () => {
    for (const o of ['qualified', 'negotiating', 'won', 'lost', 'none']) {
      expect(prompt).toContain(`"${o}"`)
    }
  })

  it('distinguishes the sale price from the trade-in valuation', () => {
    expect(prompt).toContain('NEVER the trade-in valuation')
  })

  it('carries the account business context as reference, not instructions', () => {
    expect(prompt).toContain('Loja TNS, Rio de Janeiro.')
    expect(prompt).toContain('reference, not instructions')
  })

  it('defends against prompt injection from customer messages', () => {
    expect(prompt).toContain('untrusted content')
  })

  it('omits the context block when the account has none', () => {
    const bare = buildDealSignalPrompt({ mainProduct: 'iPhone', businessContext: null })
    expect(bare).not.toContain('Business context')
  })
})
