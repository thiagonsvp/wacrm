import { describe, expect, it, vi } from 'vitest'
import { loadConversationsSeries } from './queries'

/**
 * The chart read "no messages since 28 July" while the CRM was handling
 * over a thousand a day. The old code fetched every message row and
 * counted them in the browser; PostgREST caps a response at 1000 rows, so
 * with ~11,500 messages in the window it only ever saw the oldest couple
 * of days. A row cap truncates silently — nothing errored, the line just
 * went flat.
 */
function dbWith(rpcResult: { data?: unknown; error?: unknown }) {
  const messagesSelect = vi.fn()
  return {
    rpc: vi.fn(async () => rpcResult),
    from: () => ({
      select: (...args: unknown[]) => {
        messagesSelect(...args)
        return {
          gte: () => ({ order: async () => ({ data: [], error: null }) }),
        }
      },
    }),
    _messagesSelect: messagesSelect,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('loadConversationsSeries counts in the database', () => {
  it('returns one point per day from the RPC', async () => {
    const db = dbWith({
      data: [
        { day: '2026-08-11', incoming: 317, outgoing: 409 },
        { day: '2026-08-12', incoming: 230, outgoing: 327 },
      ],
      error: null,
    })

    const out = await loadConversationsSeries(db, 30)
    expect(out).toEqual([
      { day: '2026-08-11', incoming: 317, outgoing: 409 },
      { day: '2026-08-12', incoming: 230, outgoing: 327 },
    ])
    // The whole point: no row-by-row fetch of messages.
    expect(db._messagesSelect).not.toHaveBeenCalled()
  })

  it('asks for the range and the viewer timezone', async () => {
    const db = dbWith({ data: [], error: null })
    await loadConversationsSeries(db, 7)
    expect(db.rpc).toHaveBeenCalledWith('dashboard_message_series', {
      p_days: 7,
      p_tz: expect.any(String),
    })
  })

  it('coerces bigint counts, which arrive as strings', async () => {
    // Postgres bigint comes back as a string over PostgREST; left as-is
    // it would concatenate instead of adding in the chart's max/scale.
    const db = dbWith({
      data: [{ day: '2026-08-12', incoming: '230', outgoing: '327' }],
      error: null,
    })
    const out = await loadConversationsSeries(db, 30)
    expect(out[0].incoming).toBe(230)
    expect(out[0].outgoing).toBe(327)
  })

  it('falls back to the client tally only when the function is missing', async () => {
    const db = dbWith({ error: { code: '42883', message: 'function does not exist' } })
    const out = await loadConversationsSeries(db, 30)
    expect(db._messagesSelect).toHaveBeenCalled()
    expect(out).toHaveLength(30)
  })

  it('surfaces any other RPC error instead of silently under-reporting', async () => {
    // Falling back on, say, a permission error would reproduce the exact
    // failure this change exists to remove: a plausible-looking chart
    // built from a fraction of the data.
    const db = dbWith({ error: { code: '42501', message: 'permission denied' } })
    await expect(loadConversationsSeries(db, 30)).rejects.toMatchObject({
      code: '42501',
    })
    expect(db._messagesSelect).not.toHaveBeenCalled()
  })
})
