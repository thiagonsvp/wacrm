import { describe, expect, it } from 'vitest';
import { matchStageSlots } from './stage-map';
import {
  planTransition,
  titleNamesProduct,
  type CurrentDeal,
  type DealSignal,
} from './transition';

// Mirrors the live board: Novo Lead(0) / Lead Qualificado(1) / Negociação(2) / Finalizado(3)
const STAGES = {
  pipelineId: 'pipe',
  qualified: { id: 'stage-qual', position: 1 },
  negotiating: { id: 'stage-nego', position: 2 },
  closed: { id: 'stage-fim', position: 3 },
};

function signal(over: Partial<DealSignal> = {}): DealSignal {
  return { outcome: 'none', model: null, price: null, ...over };
}

function deal(over: Partial<CurrentDeal> = {}): CurrentDeal {
  return {
    id: 'deal-1',
    stagePosition: 1,
    status: 'open',
    title: 'iPhone 13',
    value: 0,
    ...over,
  };
}

const plan = (s: DealSignal, current: CurrentDeal | null = null) =>
  planTransition({
    signal: s,
    current,
    stages: STAGES,
    fallbackTitle: 'Fulano',
  });

describe('planTransition — creating a card', () => {
  it('creates in Lead Qualificado with the model as the title', () => {
    const p = plan(
      signal({ outcome: 'qualified', model: 'iPhone 15 Pro Max 256GB' })
    );
    expect(p).toEqual({
      action: 'create',
      stageId: 'stage-qual',
      title: 'iPhone 15 Pro Max 256GB',
      value: 0,
      status: 'open',
    });
  });

  it('falls back to the contact name when the model is unknown', () => {
    const p = plan(signal({ outcome: 'qualified', model: null }));
    expect(p).toMatchObject({ action: 'create', title: 'Fulano' });
  });

  it('trims whitespace-only models down to the fallback', () => {
    const p = plan(signal({ outcome: 'qualified', model: '   ' }));
    expect(p).toMatchObject({ action: 'create', title: 'Fulano' });
  });

  it('creates straight into Negociação with the quoted value', () => {
    const p = plan(
      signal({ outcome: 'negotiating', model: 'iPhone 14', price: 2700 })
    );
    expect(p).toEqual({
      action: 'create',
      stageId: 'stage-nego',
      title: 'iPhone 14',
      value: 2700,
      status: 'open',
    });
  });

  it('creates a won card in Finalizado when the sale is already closed', () => {
    const p = plan(signal({ outcome: 'won', model: 'iPhone 15', price: 4199 }));
    expect(p).toEqual({
      action: 'create',
      stageId: 'stage-fim',
      title: 'iPhone 15',
      value: 4199,
      status: 'won',
    });
  });

  it('never creates a card just to mark it lost', () => {
    expect(plan(signal({ outcome: 'lost' }))).toMatchObject({ action: 'none' });
  });

  it('refuses to open a closed-won card with neither model nor price', () => {
    // Would otherwise land in Finalizado titled "Fulano" at R$0 and drag
    // reported revenue down.
    expect(plan(signal({ outcome: 'won' }))).toMatchObject({
      action: 'none',
      reason:
        'won with neither model nor price — too thin to open a closed deal',
    });
  });

  it('still opens a won card when either the model or the price is known', () => {
    expect(plan(signal({ outcome: 'won', model: 'iPhone 14' }))).toMatchObject({
      action: 'create',
      status: 'won',
    });
    expect(plan(signal({ outcome: 'won', price: 2700 }))).toMatchObject({
      action: 'create',
      status: 'won',
      value: 2700,
    });
  });

  it('still closes an EXISTING deal as won on a thin signal', () => {
    // The card already carries the model and value a human entered, so
    // there is nothing thin about the outcome here.
    expect(
      plan(signal({ outcome: 'won' }), deal({ stagePosition: 2 }))
    ).toMatchObject({
      action: 'update',
      changes: { stage_id: 'stage-fim', status: 'won' },
    });
  });

  it('does nothing when there is no signal', () => {
    expect(plan(signal({ outcome: 'none', model: 'iPhone 15' }))).toMatchObject(
      {
        action: 'none',
      }
    );
  });
});

describe('planTransition — advancing an existing card', () => {
  it('moves Lead Qualificado to Negociação and sets the value', () => {
    const p = plan(signal({ outcome: 'negotiating', price: 3600 }), deal());
    expect(p).toEqual({
      action: 'update',
      dealId: 'deal-1',
      changes: { stage_id: 'stage-nego', value: 3600 },
    });
  });

  it('closes as won into Finalizado', () => {
    const p = plan(
      signal({ outcome: 'won', price: 4499 }),
      deal({ stagePosition: 2, value: 4499 })
    );
    expect(p).toEqual({
      action: 'update',
      dealId: 'deal-1',
      changes: { stage_id: 'stage-fim', status: 'won' },
    });
  });

  it('marks a negotiating deal lost without moving it', () => {
    const p = plan(signal({ outcome: 'lost' }), deal({ stagePosition: 2 }));
    expect(p).toEqual({
      action: 'update',
      dealId: 'deal-1',
      changes: { status: 'lost' },
    });
  });

  it('updates the value when the quote changes', () => {
    const p = plan(
      signal({ outcome: 'negotiating', price: 3400 }),
      deal({ stagePosition: 2, value: 3600 })
    );
    expect(p).toEqual({
      action: 'update',
      dealId: 'deal-1',
      changes: { value: 3400 },
    });
  });
});

describe('planTransition — invariants', () => {
  it('never moves a deal backwards (Negociação stays put on a re-qualify)', () => {
    const p = plan(
      signal({ outcome: 'qualified' }),
      deal({ stagePosition: 2 })
    );
    expect(p).toMatchObject({ action: 'none' });
  });

  it('never moves Finalizado back to Negociação', () => {
    const p = plan(
      signal({ outcome: 'negotiating', price: 100 }),
      deal({ stagePosition: 3, status: 'open', value: 100 })
    );
    expect(p).toMatchObject({ action: 'none' });
  });

  it('treats won as terminal — later chatter cannot un-win it', () => {
    for (const outcome of [
      'qualified',
      'negotiating',
      'lost',
      'won',
    ] as const) {
      const p = plan(
        signal({ outcome, price: 999, model: 'iPhone 99' }),
        deal({ stagePosition: 3, status: 'won' })
      );
      expect(p, `outcome=${outcome}`).toMatchObject({
        action: 'none',
        reason: 'deal already won (terminal)',
      });
    }
  });

  it('re-opens a lost deal that starts negotiating again', () => {
    const p = plan(
      signal({ outcome: 'negotiating', price: 3000 }),
      deal({ stagePosition: 2, status: 'lost', value: 3000 })
    );
    expect(p).toEqual({
      action: 'update',
      dealId: 'deal-1',
      changes: { status: 'open' },
    });
  });

  it('does not re-mark an already-lost deal as lost', () => {
    const p = plan(
      signal({ outcome: 'lost' }),
      deal({ stagePosition: 2, status: 'lost' })
    );
    expect(p).toMatchObject({ action: 'none' });
  });

  it('is a no-op when the card already reflects the conversation', () => {
    const p = plan(
      signal({ outcome: 'negotiating', model: 'iPhone 13', price: 0 }),
      deal({ stagePosition: 2, value: 0 })
    );
    expect(p).toMatchObject({ action: 'none' });
  });
});

describe('planTransition — titles', () => {
  it('replaces a contact-name placeholder once the model is known', () => {
    const p = plan(
      signal({ outcome: 'qualified', model: 'iPhone 15 Pro' }),
      deal({ title: 'Danielle', stagePosition: 1 })
    );
    expect(p).toEqual({
      action: 'update',
      dealId: 'deal-1',
      changes: { title: 'iPhone 15 Pro' },
    });
  });

  it('leaves a title that already names a product alone', () => {
    const p = plan(
      signal({ outcome: 'qualified', model: 'iPhone 15 Pro' }),
      deal({ title: '13 Pro Max 256GB', stagePosition: 1 })
    );
    expect(p).toMatchObject({ action: 'none' });
  });

  it('titleNamesProduct distinguishes real titles from placeholders', () => {
    expect(titleNamesProduct('Iphone 14 Plus')).toBe(true);
    expect(titleNamesProduct('13 Pro Max 256GB')).toBe(true);
    expect(titleNamesProduct('iphone')).toBe(true);
    expect(titleNamesProduct('Danielle')).toBe(false);
    expect(titleNamesProduct('Ka')).toBe(false);
  });
});

describe('matchStageSlots', () => {
  const board = [
    { id: 'a', name: 'Novo Lead', position: 0 },
    { id: 'b', name: 'Lead Qualificado', position: 1 },
    { id: 'c', name: 'Negociação', position: 2 },
    { id: 'd', name: 'Finalizado', position: 3 },
  ];

  it('resolves the live board', () => {
    expect(matchStageSlots(board)).toEqual({
      qualified: { id: 'b', position: 1 },
      negotiating: { id: 'c', position: 2 },
      closed: { id: 'd', position: 3 },
    });
  });

  it('matches regardless of accents and case', () => {
    const slots = matchStageSlots([
      { id: 'b', name: 'lead QUALIFICADO', position: 1 },
      { id: 'c', name: 'NEGOCIACAO', position: 2 },
      { id: 'd', name: 'finalizado', position: 3 },
    ]);
    expect(slots).toEqual({
      qualified: { id: 'b', position: 1 },
      negotiating: { id: 'c', position: 2 },
      closed: { id: 'd', position: 3 },
    });
  });

  it('accepts Proposta Enviada as the commercial negotiation stage', () => {
    const slots = matchStageSlots([
      { id: 'b', name: 'Lead Qualificado', position: 1 },
      { id: 'c', name: 'Proposta Enviada', position: 2 },
      { id: 'd', name: 'Finalizada', position: 3 },
    ]);
    expect(slots).toEqual({
      qualified: { id: 'b', position: 1 },
      negotiating: { id: 'c', position: 2 },
      closed: { id: 'd', position: 3 },
    });
  });

  it('returns null when a stage is missing rather than guessing', () => {
    expect(
      matchStageSlots(board.filter((s) => s.name !== 'Negociação'))
    ).toBeNull();
    expect(matchStageSlots([])).toBeNull();
  });
});

describe('planTransition — reviving a lost deal', () => {
  // Lost deals now sit in the closed stage (migration 045), so a revival
  // must be allowed to move backwards. Otherwise the customer returns and
  // the card stays parked in Finalizado marked open.
  const lostInClosed = () =>
    deal({ stagePosition: 3, status: 'lost', title: 'iPhone 15', value: 4000 });

  it('moves a revived deal out of the closed stage into Negociação', () => {
    const p = plan(
      signal({ outcome: 'negotiating', price: 4000 }),
      lostInClosed()
    );
    expect(p).toEqual({
      action: 'update',
      dealId: 'deal-1',
      changes: { stage_id: 'stage-nego', status: 'open' },
    });
  });

  it('moves a revived deal back to Lead Qualificado when that is the signal', () => {
    const p = plan(signal({ outcome: 'qualified' }), lostInClosed());
    expect(p).toMatchObject({
      action: 'update',
      changes: { stage_id: 'stage-qual', status: 'open' },
    });
  });

  it('still refuses to drag an ACTIVE deal backwards', () => {
    // The invariant the revival exception must not weaken.
    const p = plan(
      signal({ outcome: 'qualified' }),
      deal({ stagePosition: 2 })
    );
    expect(p).toMatchObject({ action: 'none' });
  });

  it('does not move a lost deal that is being closed as won', () => {
    // Already in the closed stage — there is nowhere to move it to.
    const p = plan(signal({ outcome: 'won' }), lostInClosed());
    expect(p).toEqual({
      action: 'update',
      dealId: 'deal-1',
      changes: { status: 'won' },
    });
  });
});
