import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiConfig } from './types'
import type { PipelineStageMap } from '@/lib/deals/stage-map'

const h = vi.hoisted(() => ({
  generateReply: vi.fn(),
  buildConversationContext: vi.fn(),
  logAiUsage: vi.fn(),
}))

vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./usage', () => ({ logAiUsage: h.logAiUsage }))
vi.mock('@/lib/meta/dispatch', () => ({ dispatchDealConversions: vi.fn() }))

import {
  dealPipelineCooldownMs,
  hasUnreadSignal,
  runDealPipelineForConversation,
} from './deal-pipeline'

describe('dealPipelineCooldownMs', () => {
  const ORIGINAL = process.env.AI_DEAL_PIPELINE_COOLDOWN_MS
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.AI_DEAL_PIPELINE_COOLDOWN_MS
    else process.env.AI_DEAL_PIPELINE_COOLDOWN_MS = ORIGINAL
  })

  it('defaults to 10 minutes', () => {
    delete process.env.AI_DEAL_PIPELINE_COOLDOWN_MS
    expect(dealPipelineCooldownMs()).toBe(600_000)
  })

  it('is overridable per deployment', () => {
    process.env.AI_DEAL_PIPELINE_COOLDOWN_MS = '30000'
    expect(dealPipelineCooldownMs()).toBe(30_000)
  })

  it('can be disabled with 0', () => {
    process.env.AI_DEAL_PIPELINE_COOLDOWN_MS = '0'
    expect(dealPipelineCooldownMs()).toBe(0)
  })

  it('falls back to the default for a nonsense value', () => {
    process.env.AI_DEAL_PIPELINE_COOLDOWN_MS = 'soon'
    expect(dealPipelineCooldownMs()).toBe(600_000)
  })
})

/**
 * Minimal PostgREST stand-in: every builder method returns the chain,
 * awaiting it yields the table's configured rows, `maybeSingle` yields
 * the first row. Good enough for the select-only paths under test.
 */
function fakeDb(tables: Record<string, unknown[]>): SupabaseClient {
  const from = (table: string) => {
    const rows = tables[table] ?? []
    const chain: Record<string, unknown> = {}
    const self = () => chain
    for (const m of ['select', 'eq', 'gt', 'or', 'in', 'order', 'limit', 'delete']) {
      chain[m] = self
    }
    chain.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null })
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve)
    return chain
  }
  return { from } as unknown as SupabaseClient
}

describe('hasUnreadSignal', () => {
  it('is false when every customer message since the last run is an ack', async () => {
    const db = fakeDb({
      conversations: [{ ai_deal_analyzed_at: '2026-08-18T10:00:00Z' }],
      messages: [{ content_text: 'ok' }, { content_text: 'obrigado' }, { content_text: '👍' }],
    })
    expect(await hasUnreadSignal(db, 'conv-1')).toBe(false)
  })

  it('is true when a substantive message is still waiting to be read', async () => {
    // e.g. one the cooldown skipped, followed by the "ok" that triggered us.
    const db = fakeDb({
      conversations: [{ ai_deal_analyzed_at: '2026-08-18T10:00:00Z' }],
      messages: [{ content_text: 'ok' }, { content_text: 'quanto fica em 10x?' }],
    })
    expect(await hasUnreadSignal(db, 'conv-1')).toBe(true)
  })

  it('is false for a brand-new thread that only contains the greeting', async () => {
    const db = fakeDb({
      conversations: [{ ai_deal_analyzed_at: null }],
      messages: [{ content_text: 'bom dia' }],
    })
    expect(await hasUnreadSignal(db, 'conv-1')).toBe(false)
  })

  it('is true for a never-classified thread with real history', async () => {
    const db = fakeDb({
      conversations: [{ ai_deal_analyzed_at: null }],
      messages: [{ content_text: 'boa tarde' }, { content_text: 'tem o 15 pro?' }],
    })
    expect(await hasUnreadSignal(db, 'conv-1')).toBe(true)
  })

  it('fails open when the conversation cannot be read', async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
          }),
        }),
      }),
    } as unknown as SupabaseClient
    expect(await hasUnreadSignal(db, 'conv-1')).toBe(true)
  })
})

const CONFIG: AiConfig = {
  provider: 'openai',
  model: 'gpt-test',
  apiKey: 'sk-test',
  systemPrompt: null,
  isActive: true,
  autoReplyEnabled: false,
  autoReplyMaxPerConversation: 3,
  handoffAgentId: null,
  embeddingsApiKey: null,
  dealPipelineEnabled: true,
  dealProductScope: null,
  dealStageQualifiedId: null,
  dealStageNegotiatingId: null,
  dealStageClosedId: null,
}

const STAGES = {
  pipelineId: 'p1',
  qualified: { id: 's1', position: 0 },
  negotiating: { id: 's2', position: 1 },
  closed: { id: 's3', position: 2 },
  disqualified: null,
} as unknown as PipelineStageMap

const RUN_ARGS = {
  config: CONFIG,
  stages: STAGES,
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
  apply: false,
}

beforeEach(() => {
  delete process.env.DEAL_PIPELINE_EXCLUDED_TAGS
  h.generateReply.mockReset()
  h.buildConversationContext.mockReset()
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'manda o pix' }])
  h.generateReply.mockResolvedValue({
    text: '{"outcome":"won","model":"iPhone 15","price":4200}',
    handoff: false,
    usage: null,
  })
})

describe('runDealPipelineForConversation — won is terminal', () => {
  it('does not call the provider when the conversation already has a won deal', async () => {
    const db = fakeDb({
      contact_tags: [],
      deals: [
        {
          id: 'd1',
          title: 'iPhone 15',
          value: 4200,
          status: 'won',
          stage_id: 's3',
          conversation_id: 'conv-1',
          pipeline_stages: { position: 2 },
        },
      ],
    })
    const res = await runDealPipelineForConversation(db, RUN_ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(res.signal).toBeNull()
    expect(res.plan).toEqual({ action: 'none', reason: 'deal already won (terminal)' })
  })

  it('still classifies a lost deal — customers come back', async () => {
    const db = fakeDb({
      contact_tags: [],
      deals: [
        {
          id: 'd1',
          title: 'iPhone 15',
          value: 4200,
          status: 'lost',
          stage_id: 's3',
          conversation_id: 'conv-1',
          pipeline_stages: { position: 2 },
        },
      ],
    })
    const res = await runDealPipelineForConversation(db, RUN_ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(res.signal?.outcome).toBe('won')
  })

  it('classifies a thread with no card at all', async () => {
    const db = fakeDb({ contact_tags: [], deals: [] })
    const res = await runDealPipelineForConversation(db, RUN_ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(res.plan?.action).toBe('create')
  })
})
