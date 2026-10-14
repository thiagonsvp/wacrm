import { describe, expect, it } from 'vitest'
import {
  flattenSteps,
  resolvePositions,
  TRIGGER_NODE_ID,
  withPositions,
  type CanvasStepLike,
} from './canvas'

const step = (cid: string, extra: Partial<CanvasStepLike> = {}): CanvasStepLike => ({
  cid,
  step_type: 'send_message',
  ...extra,
})
const cond = (cid: string, yes: CanvasStepLike[], no: CanvasStepLike[]): CanvasStepLike => ({
  cid,
  step_type: 'condition',
  branches: { yes, no },
})

const edgeKeys = (steps: CanvasStepLike[]) =>
  flattenSteps(steps).edges.map((e) => `${e.source}${e.sourceHandle ? `.${e.sourceHandle}` : ''}>${e.target}`)

describe('flattenSteps', () => {
  it('chains the trigger and linear steps', () => {
    expect(edgeKeys([step('a'), step('b')])).toEqual([
      `${TRIGGER_NODE_ID}>a`,
      'a>b',
    ])
  })

  it('wires condition branches and merges their ends into the next step', () => {
    expect(
      edgeKeys([cond('c', [step('y1'), step('y2')], []), step('after')])
    ).toEqual([
      `${TRIGGER_NODE_ID}>c`,
      'c.yes>y1',
      'y1>y2',
      'y2>after',
      'c.no>after',
    ])
  })

  it('gives branch children the same paths the tree mutators expect', () => {
    const { nodes } = flattenSteps([step('a'), cond('c', [step('y')], [step('n')])])
    const y = nodes.find((n) => n.id === 'y')!
    expect(y.path).toEqual([
      { kind: 'root', index: 1 },
      { kind: 'branch', parentCid: 'c', branch: 'yes', index: 0 },
    ])
    expect(y.scope).toEqual({ kind: 'branch', parentCid: 'c', branch: 'yes' })
  })
})

describe('resolvePositions', () => {
  it('lays everything out when nothing has a position yet', () => {
    const { nodes, edges } = flattenSteps([step('a'), step('b')])
    const { positions, generated } = resolvePositions(nodes, edges, null)
    expect(generated).toBe(true)
    expect(positions.get('b')!.y).toBeGreaterThan(positions.get('a')!.y)
    expect(positions.get('a')!.y).toBeGreaterThan(positions.get(TRIGGER_NODE_ID)!.y)
  })

  it('keeps saved positions and drops a new node under its predecessor', () => {
    const { nodes, edges } = flattenSteps([
      step('a', { pos: { x: 500, y: 300 } }),
      cond('c', [step('y')], []),
    ].map((s, i) => (i === 1 ? { ...s, pos: { x: 500, y: 450 } } : s)))
    const { positions } = resolvePositions(nodes, edges, { x: 500, y: 100 })
    expect(positions.get('a')).toEqual({ x: 500, y: 300 })
    expect(positions.get('y')).toEqual({ x: 320, y: 600 })
  })
})

describe('withPositions', () => {
  it('writes positions into nested branches', () => {
    const tree = withPositions([cond('c', [step('y')], [])], new Map([['y', { x: 1, y: 2 }]]))
    expect(tree[0].branches!.yes[0].pos).toEqual({ x: 1, y: 2 })
  })
})
