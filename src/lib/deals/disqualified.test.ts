import { describe, expect, it } from 'vitest'
import { planTransition } from './transition'
import type { PipelineStageMap } from './stage-map'

/**
 * Customers who want the payment split across a boleto or carnê cannot be
 * served — this business takes PIX, cash and card instalments only. They
 * are not a lost sale (nothing was ever negotiable); they belong in their
 * own column so the funnel's conversion rate is not dragged down by leads
 * that were never winnable.
 */
const STAGES: PipelineStageMap = {
  pipelineId: 'p1',
  qualified: { id: 'stage-qualified', position: 1 },
  negotiating: { id: 'stage-negotiating', position: 2 },
  closed: { id: 'stage-closed', position: 3 },
  disqualified: { id: 'stage-disqualified', position: 0 },
}

const signal = (over = {}) => ({
  outcome: 'disqualified' as const,
  model: 'iPhone 14 Pro Max',
  price: 3999,
  ...over,
})

describe('disqualified leads', () => {
  it('opens the card straight into the disqualified column', () => {
    const plan = planTransition({
      signal: signal(),
      current: null,
      stages: STAGES,
      fallbackTitle: '5521999999999',
    })
    expect(plan).toMatchObject({
      action: 'create',
      stageId: 'stage-disqualified',
      title: 'iPhone 14 Pro Max',
    })
  })

  it('keeps status open, never lost', () => {
    // 'lost' would send the card to the closed stage (migration 045) and
    // count it among deals that were negotiated and fell through. This
    // one was never winnable.
    const plan = planTransition({
      signal: signal(),
      current: null,
      stages: STAGES,
      fallbackTitle: 'x',
    })
    expect(plan).toMatchObject({ status: 'open' })
  })

  it('moves an existing card backwards into the column', () => {
    // The only sanctioned backwards move on the board: the boleto request
    // usually surfaces mid-negotiation, long after the card left column 1.
    const plan = planTransition({
      signal: signal(),
      current: {
        id: 'deal-1',
        stagePosition: 2,
        status: 'open',
        title: 'iPhone 14 Pro Max',
        value: 3999,
      },
      stages: STAGES,
      fallbackTitle: 'x',
    })
    expect(plan).toMatchObject({
      action: 'update',
      dealId: 'deal-1',
      changes: { stage_id: 'stage-disqualified' },
    })
  })

  it('does nothing when the card is already there', () => {
    const plan = planTransition({
      signal: signal(),
      current: {
        id: 'deal-1',
        stagePosition: 0,
        status: 'open',
        title: 'x',
        value: 0,
      },
      stages: STAGES,
      fallbackTitle: 'x',
    })
    expect(plan.action).toBe('none')
  })

  it('does nothing on a board with no such column', () => {
    // Not every customer of this CRM has a "Desqualificado" stage.
    // Inventing a home for the card would be worse than leaving it.
    const { disqualified: _omitted, ...withoutColumn } = STAGES
    const plan = planTransition({
      signal: signal(),
      current: null,
      stages: withoutColumn,
      fallbackTitle: 'x',
    })
    expect(plan.action).toBe('none')
  })

  it('never overrides a recorded sale', () => {
    // A customer who already paid and later asks about carnê for a second
    // device must not drag the closed sale out of the won column.
    const plan = planTransition({
      signal: signal(),
      current: {
        id: 'deal-1',
        stagePosition: 3,
        status: 'won',
        title: 'x',
        value: 3999,
      },
      stages: STAGES,
      fallbackTitle: 'x',
    })
    expect(plan.action).toBe('none')
  })
})
