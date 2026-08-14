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
  /**
   * Where a lead the business cannot serve goes — today, someone who
   * wants instalments by boleto or carne. OPTIONAL: a board without such
   * a column is perfectly valid, and the classifier then treats the
   * outcome as "none" rather than inventing a home for the card.
   */
  disqualified?: StageRef
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
  disqualified: ['desqualificado', 'descartado', 'disqualified', 'unqualified'],
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

  // Optional on purpose — its absence must not fail the whole match and
  // switch the account's classification off.
  const disqualified = pick('disqualified') ?? undefined

  return { qualified, negotiating, closed, disqualified }
}

/** Stage ids chosen explicitly in Settings, when the operator set them. */
export interface ConfiguredStageIds {
  qualified?: string | null
  negotiating?: string | null
  closed?: string | null
  disqualified?: string | null
}

/**
 * Build the map from stage ids the operator picked in Settings.
 *
 * Preferred over name matching: it survives a renamed column, and it is
 * the only thing that works for a customer whose board is not in
 * Portuguese. Returns null if any id is missing or no longer exists on
 * the board (a deleted stage), so the caller falls back rather than
 * writing a card into a stage that is gone.
 */
export function mapConfiguredStages(
  configured: ConfiguredStageIds,
  stages: StageRow[],
): PipelineStageMap | null {
  const { qualified, negotiating, closed, disqualified } = configured
  if (!qualified || !negotiating || !closed) return null

  const byId = new Map(stages.map((s) => [s.id, s]))
  const q = byId.get(qualified)
  const n = byId.get(negotiating)
  const c = byId.get(closed)
  if (!q || !n || !c) return null
  // All three must live on one board, or "never move backwards" would be
  // comparing positions from different pipelines.
  if (!q.pipeline_id) return null
  if (q.pipeline_id !== n.pipeline_id || q.pipeline_id !== c.pipeline_id) return null

  // The disqualified column has no field in Settings yet, so an account
  // that pinned the other three by id would otherwise get `undefined`
  // here and the rule would quietly never fire. Fall back to matching it
  // by name on the SAME board — silent no-op is the failure mode this
  // codebase keeps paying for.
  let d = disqualified ? byId.get(disqualified) : undefined
  if (!d) {
    const onBoard = stages.filter((st) => st.pipeline_id === q.pipeline_id)
    const byName = new Map<string, StageRow>()
    for (const st of onBoard) {
      const key = normalize(st.name)
      if (!byName.has(key)) byName.set(key, st)
    }
    for (const candidate of SLOT_NAMES.disqualified) {
      const hit = byName.get(candidate)
      if (hit) {
        d = hit
        break
      }
    }
  }
  const sameBoard = d && d.pipeline_id === q.pipeline_id

  return {
    pipelineId: q.pipeline_id,
    qualified: { id: q.id, position: q.position },
    negotiating: { id: n.id, position: n.position },
    closed: { id: c.id, position: c.position },
    disqualified: sameBoard && d ? { id: d.id, position: d.position } : undefined,
  }
}

/**
 * Resolve the three stages this pipeline drives.
 *
 * Prefers the ids configured in Settings; falls back to matching stage
 * names so deployments that predate that setting keep working untouched.
 * Returns null (with a breadcrumb) when neither resolves — a renamed or
 * half-built board must degrade to "do nothing", never to "put the card
 * somewhere arbitrary".
 */
export async function resolvePipelineStages(
  db: SupabaseClient,
  accountId: string,
  configured?: ConfiguredStageIds,
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
  const allStages = (stages ?? []) as StageRow[]

  if (configured) {
    const explicit = mapConfiguredStages(configured, allStages)
    if (explicit) return explicit
  }

  for (const pipeline of pipelines) {
    const own = allStages.filter((s) => s.pipeline_id === pipeline.id)
    const slots = matchStageSlots(own)
    if (slots) return { pipelineId: pipeline.id, ...slots }
  }

  console.warn(
    `[ai deal pipeline] account ${accountId}: no stages configured in Settings and ` +
      'none match Lead Qualificado / Negociação / Finalizado — skipping classification.',
  )
  return null
}
