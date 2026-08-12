import { describe, expect, it, vi } from 'vitest'
import { dispatchDealConversions } from './dispatch'

/**
 * Purchases wait for a human; qualified leads do not.
 *
 * A conversion cannot be recalled, and the AI has been wrong about "won" —
 * on 2026-08-12 a bare "Ok" after a closing pitch produced a R$7.400 sale
 * that never happened, and an earlier one reached Meta for R$4.899 from a
 * customer who said they would "mandar o link para a esposa".
 */
function fakeDb(opts: {
  requireApproval?: boolean
  existing?: Array<{ event_name: string; status: string }>
}) {
  const inserted: Array<Record<string, unknown>> = []

  const db = {
    from(table: string) {
      if (table === 'meta_capi_configs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  dataset_id: '123',
                  access_token: 'enc',
                  waba_id: null,
                  page_id: '999',
                  require_purchase_approval: opts.requireApproval ?? true,
                  test_event_code: null,
                  is_active: true,
                  send_qualified_lead: true,
                  send_purchase: true,
                },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'contacts') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { phone: '5521999999999', acquisition_ctwa_clid: 'clid-abc' },
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'meta_capi_events') {
        return {
          select: () => ({
            eq: () => ({ in: async () => ({ data: opts.existing ?? [] }) }),
          }),
          insert: async (row: Record<string, unknown>) => {
            inserted.push(row)
            return { error: null }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { db, inserted }
}

// The token is fake, so decrypt would throw and abort the load; stub it.
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'plain-token' }))

const sendSpy = vi.hoisted(() => vi.fn(async () => ({ ok: true, received: 1 })))
vi.mock('./capi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./capi')>()),
  sendMetaCapiEvent: sendSpy,
}))

const ARGS = {
  accountId: 'acc-1',
  dealId: 'deal-1',
  contactId: 'contact-1',
  qualified: false,
  won: true,
  value: 7400,
  currency: 'BRL',
}

describe('Purchase approval queue', () => {
  it('queues the purchase instead of sending it', async () => {
    sendSpy.mockClear()
    const { db, inserted } = fakeDb({ requireApproval: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await dispatchDealConversions(db as any, ARGS)

    expect(sendSpy).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(1)
    expect(inserted[0].status).toBe('pending')
    // The amount must survive the wait — it is what the reviewer judges.
    expect(inserted[0].value).toBe(7400)
    expect(inserted[0].currency).toBe('BRL')
  })

  it('sends immediately when the account opted out of review', async () => {
    sendSpy.mockClear()
    const { db, inserted } = fakeDb({ requireApproval: false })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await dispatchDealConversions(db as any, ARGS)

    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(inserted[0].status).toBe('sent')
  })

  it('never holds a QualifiedLead', async () => {
    // Holding these would bury the queue: ~11 arrive a day, they carry no
    // amount, and a long queue gets rubber-stamped.
    sendSpy.mockClear()
    const { db, inserted } = fakeDb({ requireApproval: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await dispatchDealConversions(db as any, {
      ...ARGS,
      qualified: true,
      won: false,
      value: null,
      currency: null,
    })

    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(inserted[0].status).toBe('sent')
  })

  it('does not queue the same purchase twice', async () => {
    sendSpy.mockClear()
    const { db, inserted } = fakeDb({
      requireApproval: true,
      existing: [{ event_name: 'Purchase', status: 'pending' }],
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await dispatchDealConversions(db as any, ARGS)

    expect(inserted).toHaveLength(0)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('respects a human rejection and never re-queues', async () => {
    // Without this, the next inbound message would resurrect a purchase
    // someone deliberately said no to.
    sendSpy.mockClear()
    const { db, inserted } = fakeDb({
      requireApproval: true,
      existing: [{ event_name: 'Purchase', status: 'rejected' }],
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await dispatchDealConversions(db as any, ARGS)

    expect(inserted).toHaveLength(0)
    expect(sendSpy).not.toHaveBeenCalled()
  })
})
