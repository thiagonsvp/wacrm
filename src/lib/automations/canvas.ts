import { autoLayout } from '@/lib/flows/layout'

/**
 * Pure helpers for the automation builder's React Flow canvas.
 *
 * The automation itself stays a tree (root steps, each condition with
 * yes/no child lists) — that is what the engine runs and the API stores.
 * The canvas is a projection of that tree: one node per step plus the
 * trigger, edges derived from the order, and a free (x, y) per node that
 * is purely presentational.
 */

export const TRIGGER_NODE_ID = '__trigger'

export type ParentScope =
  | { kind: 'root' }
  | { kind: 'branch'; parentCid: string; branch: 'yes' | 'no' }

export type StepPath = (
  | { kind: 'root'; index: number }
  | { kind: 'branch'; parentCid: string; branch: 'yes' | 'no'; index: number }
)[]

export interface CanvasPos {
  x: number
  y: number
}

/** The subset of a builder step the canvas needs. */
export interface CanvasStepLike {
  cid: string
  step_type: string
  pos?: CanvasPos | null
  branches?: { yes: CanvasStepLike[]; no: CanvasStepLike[] }
}

export interface CanvasNodeInfo<S extends CanvasStepLike = CanvasStepLike> {
  id: string
  step: S
  path: StepPath
  /** Where this step lives, and its index there — for "add after". */
  scope: ParentScope
  index: number
}

export type BranchHandle = 'yes' | 'no'

export interface CanvasEdgeInfo {
  id: string
  source: string
  target: string
  sourceHandle: BranchHandle | null
}

export const NODE_SIZE = {
  trigger: { width: 260, height: 84 },
  step: { width: 260, height: 84 },
  condition: { width: 300, height: 96 },
} as const

export function nodeSize(stepType: string | null) {
  if (stepType == null) return NODE_SIZE.trigger
  return stepType === 'condition' ? NODE_SIZE.condition : NODE_SIZE.step
}

interface Tail {
  id: string
  handle: BranchHandle | null
}

/**
 * Flatten the step tree into nodes + edges. Mirrors the engine's order:
 * a condition runs one branch, and whatever follows the condition in the
 * same list runs afterwards — so the open end of each branch connects to
 * that next step (an empty branch connects straight from its handle).
 */
export function flattenSteps<S extends CanvasStepLike>(
  steps: S[]
): { nodes: CanvasNodeInfo<S>[]; edges: CanvasEdgeInfo[] } {
  const nodes: CanvasNodeInfo<S>[] = []
  const edges: CanvasEdgeInfo[] = []

  const link = (from: Tail[], to: string) => {
    for (const t of from) {
      edges.push({
        id: `${t.id}:${t.handle ?? 'next'}->${to}`,
        source: t.id,
        target: to,
        sourceHandle: t.handle,
      })
    }
  }

  function walk(
    list: S[],
    basePath: StepPath,
    scope: ParentScope,
    incoming: Tail[]
  ): Tail[] {
    let tails = incoming
    list.forEach((step, index) => {
      const path: StepPath = [
        ...basePath,
        scope.kind === 'root'
          ? { kind: 'root', index }
          : { kind: 'branch', parentCid: scope.parentCid, branch: scope.branch, index },
      ]
      nodes.push({ id: step.cid, step, path, scope, index })
      link(tails, step.cid)

      if (step.step_type === 'condition') {
        const branch = (b: BranchHandle) =>
          walk(
            (step.branches?.[b] ?? []) as S[],
            path,
            { kind: 'branch', parentCid: step.cid, branch: b },
            [{ id: step.cid, handle: b }]
          )
        tails = [...branch('yes'), ...branch('no')]
      } else {
        tails = [{ id: step.cid, handle: null }]
      }
    })
    return tails
  }

  walk(steps, [], { kind: 'root' }, [{ id: TRIGGER_NODE_ID, handle: null }])
  return { nodes, edges }
}

/** Dagre positions for every node, trigger included. */
export function layoutAll(
  nodes: CanvasNodeInfo[],
  edges: CanvasEdgeInfo[]
): Map<string, CanvasPos> {
  return autoLayout(
    [
      { id: TRIGGER_NODE_ID, ...NODE_SIZE.trigger },
      ...nodes.map((n) => ({ id: n.id, ...nodeSize(n.step.step_type) })),
    ],
    edges.map((e) => ({ source: e.source, target: e.target })),
    { direction: 'TB', rankSep: 70, nodeSep: 50 }
  )
}

const BRANCH_DX: Record<BranchHandle, number> = { yes: -180, no: 180 }
const STACK_DY = 150

/**
 * Final position for every node. Saved positions win. When nothing has
 * a position yet (a new or never-arranged automation) everything is laid
 * out with dagre; otherwise each unplaced node — typically one just
 * added — is put under its first predecessor, nudged left/right for the
 * SIM/NÃO branch, so it appears next to where it was added instead of
 * reshuffling what the user already arranged.
 */
export function resolvePositions(
  nodes: CanvasNodeInfo[],
  edges: CanvasEdgeInfo[],
  triggerPos: CanvasPos | null | undefined
): { positions: Map<string, CanvasPos>; generated: boolean } {
  const anyPlaced = !!triggerPos || nodes.some((n) => n.step.pos)
  if (!anyPlaced) {
    return { positions: layoutAll(nodes, edges), generated: true }
  }

  const positions = new Map<string, CanvasPos>()
  positions.set(TRIGGER_NODE_ID, triggerPos ?? { x: 0, y: 0 })
  let generated = !triggerPos
  // nodes are in walk order, so a predecessor is always resolved first.
  for (const n of nodes) {
    if (n.step.pos) {
      positions.set(n.id, n.step.pos)
      continue
    }
    const inEdge = edges.find((e) => e.target === n.id)
    const from = inEdge ? positions.get(inEdge.source) : undefined
    const base = from ?? { x: 0, y: 0 }
    positions.set(n.id, {
      x: base.x + (inEdge?.sourceHandle ? BRANCH_DX[inEdge.sourceHandle] : 0),
      y: base.y + STACK_DY,
    })
    generated = true
  }
  return { positions, generated }
}

/** Return a copy of the tree with `pos` replaced for the given cids. */
export function withPositions<S extends CanvasStepLike>(
  steps: S[],
  positions: Map<string, CanvasPos>
): S[] {
  return steps.map((s) => {
    const pos = positions.get(s.cid)
    const next = (pos ? { ...s, pos } : s) as S
    if (!s.branches) return next
    return {
      ...next,
      branches: {
        yes: withPositions(s.branches.yes as S[], positions),
        no: withPositions(s.branches.no as S[], positions),
      },
    }
  })
}
