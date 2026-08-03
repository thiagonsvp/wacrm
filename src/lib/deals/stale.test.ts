import { afterEach, describe, expect, it } from 'vitest'
import { selectStaleDeals, staleDealDays, type StaleCandidate } from './stale'

const ORIGINAL = process.env.DEAL_STALE_DAYS
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DEAL_STALE_DAYS
  else process.env.DEAL_STALE_DAYS = ORIGINAL
})

const CUTOFF = '2026-08-01T00:00:00.000Z'

function deal(over: Partial<StaleCandidate> = {}): StaleCandidate {
  return {
    id: 'd1',
    account_id: 'acct',
    contact_id: 'c1',
    title: 'iPhone 15',
    updated_at: '2026-08-03T00:00:00.000Z',
    ...over,
  }
}

describe('staleDealDays', () => {
  it('defaults to five days', () => {
    delete process.env.DEAL_STALE_DAYS
    expect(staleDealDays()).toBe(5)
  })

  it('is overridable', () => {
    process.env.DEAL_STALE_DAYS = '14'
    expect(staleDealDays()).toBe(14)
  })

  it('ignores a nonsensical value rather than expiring everything', () => {
    for (const bad of ['0', '-3', 'abc', '']) {
      process.env.DEAL_STALE_DAYS = bad
      expect(staleDealDays(), `value=${bad}`).toBe(5)
    }
  })
})

describe('selectStaleDeals', () => {
  it('expires a deal whose last message predates the cutoff', () => {
    const d = deal()
    const last = new Map([['c1', '2026-07-20T10:00:00.000Z']])
    expect(selectStaleDeals([d], last, CUTOFF)).toEqual([d])
  })

  it('keeps a deal that was messaged after the cutoff', () => {
    const last = new Map([['c1', '2026-08-02T10:00:00.000Z']])
    expect(selectStaleDeals([deal()], last, CUTOFF)).toEqual([])
  })

  it('uses the conversation, not the deal row, as the activity signal', () => {
    // The classifier rewrites `updated_at` whenever it touches a card, so
    // trusting it would keep resetting the clock on a customer who has
    // said nothing.
    const d = deal({ updated_at: '2026-08-03T00:00:00.000Z' })
    const last = new Map([['c1', '2026-07-10T00:00:00.000Z']])
    expect(selectStaleDeals([d], last, CUTOFF)).toEqual([d])
  })

  it('falls back to the deal row when there is no conversation', () => {
    const stale = deal({ id: 'old', updated_at: '2026-07-01T00:00:00.000Z' })
    const fresh = deal({ id: 'new', updated_at: '2026-08-02T00:00:00.000Z' })
    const empty = new Map<string, string | null>()
    expect(selectStaleDeals([stale, fresh], empty, CUTOFF).map((d) => d.id)).toEqual([
      'old',
    ])
  })

  it('falls back when the conversation has no messages at all', () => {
    const d = deal({ updated_at: '2026-07-01T00:00:00.000Z' })
    const last = new Map([['c1', null]])
    expect(selectStaleDeals([d], last, CUTOFF)).toEqual([d])
  })

  it('handles a deal with no contact', () => {
    const d = deal({ contact_id: null, updated_at: '2026-07-01T00:00:00.000Z' })
    expect(selectStaleDeals([d], new Map(), CUTOFF)).toEqual([d])
  })

  it('returns nothing for an empty board', () => {
    expect(selectStaleDeals([], new Map(), CUTOFF)).toEqual([])
  })

  it('separates active from stale in one pass', () => {
    const deals = [
      deal({ id: 'a', contact_id: 'c1' }),
      deal({ id: 'b', contact_id: 'c2' }),
      deal({ id: 'c', contact_id: 'c3' }),
    ]
    const last = new Map([
      ['c1', '2026-07-20T00:00:00.000Z'],
      ['c2', '2026-08-02T00:00:00.000Z'],
      ['c3', '2026-06-01T00:00:00.000Z'],
    ])
    expect(selectStaleDeals(deals, last, CUTOFF).map((d) => d.id)).toEqual(['a', 'c'])
  })
})
