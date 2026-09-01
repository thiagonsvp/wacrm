import type { SupabaseClient } from '@supabase/supabase-js'

interface MemoryRow {
  question: string
  answer: string
}

const MAX_EXCERPT_CHARS = 600

function compact(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > MAX_EXCERPT_CHARS
    ? `${normalized.slice(0, MAX_EXCERPT_CHARS - 1)}…`
    : normalized
}

/**
 * Retrieve a very small, account-scoped set of human reply examples.
 * This uses lexical Postgres search only, so it adds no model call and
 * keeps prompt cost bounded. Missing migration/data degrades to [].
 */
export async function retrieveConversationMemory(
  db: SupabaseClient,
  accountId: string,
  queryText: string,
  k = 2
): Promise<string[]> {
  const query = queryText.trim()
  if (!query || k <= 0) return []

  try {
    const { data, error } = await db.rpc('match_ai_conversation_memory_fts', {
      p_account_id: accountId,
      p_query: query,
      p_match_count: Math.min(k, 3),
    })
    if (error || !Array.isArray(data)) return []

    return (data as MemoryRow[])
      .filter((row) => row.question?.trim() && row.answer?.trim())
      .slice(0, Math.min(k, 3))
      .map((row) => `Cliente: ${compact(row.question)}\nAtendente: ${compact(row.answer)}`)
  } catch (err) {
    console.error('[ai memory] retrieval failed:', err)
    return []
  }
}
