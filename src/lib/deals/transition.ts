import type { PipelineStageMap } from './stage-map'

// ------------------------------------------------------------
// Deterministic pipeline transitions.
//
// The LLM only ever *reports* what it read in the conversation (see
// lib/ai/deal-signal.ts). Deciding what that means for the board — which
// stage, whether to create or update, whether a deal is won or lost — is
// plain code here, so the rules are inspectable, unit-testable, and
// identical on every run. The model never gets to pick a stage id or
// flip a status directly.
//
// Invariants
//   1. A deal never moves backwards. Stage rank comes from the board's
//      real `position`, so "already in Negociação" is never dragged back
//      to Lead Qualificado by a later message that only re-states
//      interest.
//   2. `won` is terminal. Once a sale is recorded, later chatter in the
//      thread ("e a capinha?") cannot un-win or re-open it — that would
//      corrupt revenue reporting.
//   3. `lost` is NOT terminal. Customers come back; a lost card that
//      starts negotiating again re-opens rather than stranding the lead.
//   4. A card is never created just to mark it lost — a contact who
//      never became a deal and says "não quero" leaves no residue on the
//      board.
// ------------------------------------------------------------

export type DealOutcome = 'qualified' | 'negotiating' | 'won' | 'lost' | 'none'
export type DealStatus = 'open' | 'won' | 'lost'

/** What the classifier read out of the conversation. */
export interface DealSignal {
  outcome: DealOutcome
  /** Product the customer is after, e.g. "iPhone 15 Pro Max 256GB". */
  model: string | null
  /** Price quoted BY THE BUSINESS for that product, in the account's currency. */
  price: number | null
}

/** The existing card for this conversation, if any. */
export interface CurrentDeal {
  id: string
  stagePosition: number
  status: DealStatus
  title: string
  value: number | null
}

export interface DealChanges {
  stage_id?: string
  title?: string
  value?: number
  status?: DealStatus
}

export type TransitionPlan =
  | { action: 'none'; reason: string }
  | {
      action: 'create'
      stageId: string
      title: string
      value: number
      status: DealStatus
    }
  | { action: 'update'; dealId: string; changes: DealChanges }

/**
 * Does this title already name a product, or is it a placeholder?
 *
 * Cards created before the model was known are titled with the contact's
 * name ("Danielle"); real ones name the device ("Iphone 14 Plus",
 * "13 Pro Max 256GB"). Only placeholders get overwritten once the model
 * becomes known, so a title a human edited by hand is left alone.
 */
export function titleNamesProduct(title: string): boolean {
  return /iphone/i.test(title) || /\d/.test(title)
}

/**
 * Decide what should happen to the board given the classifier's signal
 * and the deal that exists today. Pure — no I/O, no clock.
 *
 * `fallbackTitle` is used only when a card must be created and the model
 * could not be identified (typically the contact's name).
 */
export function planTransition(args: {
  signal: DealSignal
  current: CurrentDeal | null
  stages: PipelineStageMap
  fallbackTitle: string
}): TransitionPlan {
  const { signal, current, stages, fallbackTitle } = args

  if (signal.outcome === 'none') {
    return { action: 'none', reason: 'no actionable signal in the conversation' }
  }

  // Invariant 2: a recorded sale is final.
  if (current?.status === 'won') {
    return { action: 'none', reason: 'deal already won (terminal)' }
  }

  const targetStage =
    signal.outcome === 'qualified'
      ? stages.qualified
      : signal.outcome === 'negotiating'
        ? stages.negotiating
        : signal.outcome === 'won'
          ? stages.closed
          : null // 'lost' does not imply a stage move

  if (!current) {
    // Invariant 4.
    if (signal.outcome === 'lost') {
      return { action: 'none', reason: 'no deal to mark lost' }
    }
    // Invariant 5: never open a *closed-won* card with nothing in it. A
    // brand-new "won" carrying neither a model nor a price would land in
    // the closed stage titled with the contact's name and valued at zero,
    // which silently drags reported revenue down. Real closes name at
    // least one of the two; a signal this thin is far more likely to be a
    // misread, so leave it for a human.
    if (signal.outcome === 'won' && !signal.model?.trim() && signal.price == null) {
      return {
        action: 'none',
        reason: 'won with neither model nor price — too thin to open a closed deal',
      }
    }
    // Non-null for every remaining outcome, but keep the guard so a new
    // outcome added later fails closed instead of creating a stageless card.
    if (!targetStage) {
      return { action: 'none', reason: `no target stage for "${signal.outcome}"` }
    }
    return {
      action: 'create',
      stageId: targetStage.id,
      title: signal.model?.trim() || fallbackTitle,
      value: signal.price ?? 0,
      status: signal.outcome === 'won' ? 'won' : 'open',
    }
  }

  const changes: DealChanges = {}
  // A lost deal now sits in the closed stage (migration 045). Reopening
  // it therefore HAS to move backwards, or the customer comes back and
  // their card stays parked in Finalizado marked open — visibly closed,
  // actually live. Invariant 1 exists to stop a re-stated interest
  // dragging an active deal backwards; a revival is the one case where
  // going back is the correct move.
  const reviving =
    current.status === 'lost' &&
    (signal.outcome === 'qualified' || signal.outcome === 'negotiating')

  // Invariant 1: forward-only, except when reviving.
  if (targetStage && (reviving || targetStage.position > current.stagePosition)) {
    if (targetStage.id !== undefined && targetStage.position !== current.stagePosition) {
      changes.stage_id = targetStage.id
    }
  }

  if (signal.outcome === 'won') {
    changes.status = 'won'
  } else if (signal.outcome === 'lost') {
    if (current.status !== 'lost') changes.status = 'lost'
  } else if (current.status === 'lost') {
    changes.status = 'open' // Invariant 3: re-open a revived lead.
  }

  if (signal.price != null && signal.price !== current.value) {
    changes.value = signal.price
  }

  const model = signal.model?.trim()
  if (model && !titleNamesProduct(current.title) && model !== current.title) {
    changes.title = model
  }

  if (Object.keys(changes).length === 0) {
    return { action: 'none', reason: 'deal already reflects the conversation' }
  }
  return { action: 'update', dealId: current.id, changes }
}
