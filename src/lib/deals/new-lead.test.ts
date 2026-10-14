import { describe, expect, it } from 'vitest'
import { planTransition } from './transition'
import type { PipelineStageMap } from './stage-map'

/**
 * A contact with no real signal yet ("oi", or no reply at all) used to be
 * left off the board entirely. Some operators want every lead visible on
 * the funnel from the first contact, so a board with a "Novo Lead" column
 * gets one instead of silently skipping the card.
 */
const STAGES: PipelineStageMap = {
  pipelineId: 'p1',
  qualified: { id: 'stage-qualified', position: 1 },
  negotiating: { id: 'stage-negotiating', position: 2 },
  closed: { id: 'stage-closed', position: 3 },
  newLead: { id: 'stage-new', position: 0 },
}

const noneSignal = { outcome: 'none' as const, model: null, price: null }

describe('new leads', () => {
  it('opens a card in Novo Lead when nothing else is known', () => {
    const plan = planTransition({
      signal: noneSignal,
      current: null,
      stages: STAGES,
      fallbackTitle: '5521999999999',
    })
    expect(plan).toEqual({
      action: 'create',
      stageId: 'stage-new',
      title: '5521999999999',
      value: 0,
      status: 'open',
    })
  })

  it('does nothing on a board with no such column', () => {
    // Not every customer of this CRM has a "Novo Lead" stage — the
    // pre-existing behaviour must be unchanged for them.
    const { newLead: _omitted, ...withoutColumn } = STAGES
    const plan = planTransition({
      signal: noneSignal,
      current: null,
      stages: withoutColumn,
      fallbackTitle: 'x',
    })
    expect(plan).toMatchObject({ action: 'none' })
  })

  it('never re-files an existing card just because a later message reads as thin', () => {
    const plan = planTransition({
      signal: noneSignal,
      current: {
        id: 'deal-1',
        stagePosition: 1,
        status: 'open',
        title: 'iPhone 13',
        value: 0,
      },
      stages: STAGES,
      fallbackTitle: 'x',
    })
    expect(plan).toMatchObject({ action: 'none' })
  })

  it('never overrides a recorded sale', () => {
    const plan = planTransition({
      signal: noneSignal,
      current: {
        id: 'deal-1',
        stagePosition: 3,
        status: 'won',
        title: 'iPhone 13',
        value: 4000,
      },
      stages: STAGES,
      fallbackTitle: 'x',
    })
    expect(plan).toMatchObject({ action: 'none' })
  })
})
