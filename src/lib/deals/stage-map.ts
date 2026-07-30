import type { SupabaseClient } from '@supabase/supabase-js'

// ------------------------------------------------------------
// Resolve the three pipeline stages the AI classifier drives.
//
// The stages are matched by NAME rather than by a stored id/position so
// the feature works on a pipeline the user already built by hand (and
// keeps working if they reorder the board). Matching is accent- and
// case-insensitive because these names are typed by hand in Portuguese
// — "Negociação" and "Negociacao" must both resolve.
//
// Ranking uses each stage's real `position` from the database, not a
// hardcoded order, so "never move a deal backwards" respects how the
// board is actually arranged.
// ------------------------------------------------------------

export interface StageRef {
  id: string
  position: number
}

export interface PipelineStageMap {
  pipelineId: string
  /** Where a qualified lead's card is created. */
  qualified: StageRef
  /** Where a card goes once a price has been quoted. */
  negotiating: StageRef
  /** Terminal stage for a closed-won deal. */
  closed: StageRef
}

export interface StageRow {
  id: string
  name: string
  position: number
  pipeline_id?: string
}

/** Fold accents and case so hand-typed Portuguese stage names match. */
function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Accepted spellings per slot, normalized. First match wins, so the
// canonical name is listed first.
const SLOT_NAMES = {
  qualified: ['lead qualificado', 'qualificado', 'lead qualified', 'qualified'],
  negotiating: ['negociacao', 'em negociacao', 'negotiation', 'negotiating'],
  closed: ['finalizado', 'fechado', 'concluido', 'ganho', 'closed', 'won'],
} as const

/**
 * Pure core: pick the three slots out of one pipeline's stage list.
 * Returns null when any slot is missing — the caller then no-ops rather
 * than guessing which column a card belongs in.
 */
export function matchStageSlots(
  stages: StageRow[],
): Omit<PipelineStageMap, 'pipelineId'> | null {
  const byName = new Map<string, StageRow>()
  for (const s of stages) {
    const key = normalize(s.name)
    if (!byName.has(key)) byName.set(key, s)
  }

  const pick = (slot: keyof typeof SLOT_NAMES): StageRef | null => {
    for (const candidate of SLOT_NAMES[slot]) {
      const hit = byName.get(candidate)
      if (hit) return { id: hit.id, position: hit.position }
    }
    return null
  }

  const qualified = pick('qualified')
  const negotiating = pick('negotiating')
  const closed = pick('closed')
  if (!qualified || !negotiating || !closed) return null

  return { qualified, negotiating, closed }
}

/**
 * Load the account's pipelines and return the first one whose stages
 * cover all three slots. Returns null (with a breadcrumb) when no
 * pipeline qualifies — a renamed or half-built board must degrade to
 * "do nothing", never to "put the card somewhere arbitrary".
 */
export async function resolvePipelineStages(
  db: SupabaseClient,
  accountId: string,
): Promise<PipelineStageMap | null> {
  const { data: pipelines, error: pipeErr } = await db
    .from('pipelines')
    .select('id')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })

  if (pipeErr) throw pipeErr
  if (!pipelines || pipelines.length === 0) return null

  const { data: stages, error: stageErr } = await db
    .from('pipeline_stages')
    .select('id, name, position, pipeline_id')
    .in(
      'pipeline_id',
      pipelines.map((p) => p.id),
    )
    .order('position', { ascending: true })

  if (stageErr) throw stageErr

  for (const pipeline of pipelines) {
    const own = ((stages ?? []) as StageRow[]).filter(
      (s) => s.pipeline_id === pipeline.id,
    )
    const slots = matchStageSlots(own)
    if (slots) return { pipelineId: pipeline.id, ...slots }
  }

  console.warn(
    `[ai deal pipeline] account ${accountId}: no pipeline has stages matching ` +
      'Lead Qualificado / Negociação / Finalizado — skipping classification.',
  )
  return null
}
