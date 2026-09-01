import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { retrieveConversationMemory } from './memory'

function fakeDb(result: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(result),
  } as unknown as SupabaseClient
}

describe('retrieveConversationMemory', () => {
  it('formats account-scoped human examples', async () => {
    const db = fakeDb({
      data: [{ question: 'Tem entrega?', answer: 'Sim, em toda a cidade.' }],
      error: null,
    })
    await expect(retrieveConversationMemory(db, 'acct-1', 'entrega', 2)).resolves.toEqual([
      'Cliente: Tem entrega?\nAtendente: Sim, em toda a cidade.',
    ])
    expect(db.rpc).toHaveBeenCalledWith('match_ai_conversation_memory_fts', {
      p_account_id: 'acct-1',
      p_query: 'entrega',
      p_match_count: 2,
    })
  })

  it('degrades to no examples when the migration is unavailable', async () => {
    const db = fakeDb({ data: null, error: { code: 'PGRST202' } })
    await expect(retrieveConversationMemory(db, 'acct-1', 'entrega')).resolves.toEqual([])
  })
})
