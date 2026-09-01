import { describe, it, expect, vi } from 'vitest'
import { logAiUsage } from './usage'
import type { SupabaseClient } from '@supabase/supabase-js'

function fakeDb() {
  const insert = vi.fn().mockResolvedValue({ error: null })
  const db = { from: vi.fn(() => ({ insert })) }
  return { db: db as unknown as SupabaseClient, insert, from: db.from }
}

describe('logAiUsage', () => {
  it('inserts a row mapping normalized usage to the log columns', async () => {
    const { db, insert, from } = fakeDb()
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      mode: 'auto_reply',
      provider: 'anthropic',
      model: 'claude-x',
      usage: { promptTokens: 30, completionTokens: 6, totalTokens: 36 },
    })
    expect(from).toHaveBeenCalledWith('ai_usage_log')
    expect(insert).toHaveBeenCalledWith({
      account_id: 'acct-1',
      conversation_id: 'conv-1',
      mode: 'auto_reply',
      provider: 'anthropic',
      model: 'claude-x',
      prompt_tokens: 30,
      completion_tokens: 6,
      total_tokens: 36,
    })
  })

  it('records the cached share of the prompt when the provider reports it', async () => {
    const { db, insert } = fakeDb()
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      mode: 'deal_pipeline',
      provider: 'openai',
      model: 'gpt-x',
      usage: {
        promptTokens: 2000,
        completionTokens: 20,
        totalTokens: 2020,
        cachedPromptTokens: 1536,
      },
    })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ cached_prompt_tokens: 1536 }),
    )
  })

  it('retries without the cached column when the migration is not applied', async () => {
    // PostgREST rejects the whole INSERT for a column it does not know.
    // The spend row must still land — only the cached split is lost.
    const insert = vi
      .fn()
      .mockResolvedValueOnce({
        error: {
          code: 'PGRST204',
          message:
            "Could not find the 'cached_prompt_tokens' column of 'ai_usage_log' in the schema cache",
        },
      })
      .mockResolvedValueOnce({ error: null })
    const db = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      mode: 'deal_pipeline',
      provider: 'openai',
      model: 'gpt-x',
      usage: {
        promptTokens: 2000,
        completionTokens: 20,
        totalTokens: 2020,
        cachedPromptTokens: 1536,
      },
    })
    expect(insert).toHaveBeenCalledTimes(2)
    expect(insert.mock.calls[1][0]).not.toHaveProperty('cached_prompt_tokens')
    expect(insert.mock.calls[1][0]).toMatchObject({ prompt_tokens: 2000 })
  })

  it('is a no-op when the provider reported no usage', async () => {
    const { db, from } = fakeDb()
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: null,
      mode: 'draft',
      provider: 'openai',
      model: 'gpt-x',
      usage: null,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('never throws when the insert errors', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'boom' } })
    const db = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient
    await expect(
      logAiUsage(db, {
        accountId: 'acct-1',
        conversationId: 'conv-1',
        mode: 'draft',
        provider: 'openai',
        model: 'gpt-x',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }),
    ).resolves.toBeUndefined()
  })
})
