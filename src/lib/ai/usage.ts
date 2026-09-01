import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiProvider, AiUsage } from './types'

export interface LogAiUsageArgs {
  accountId: string
  /** Null for a draft not tied to one thread, or when the row was
   *  deleted between generation and logging. */
  conversationId: string | null
  /** Widened by migration 042 to include the deal-pipeline classifier and
   *  by 058 to include the Playground, so every surface that spends the
   *  account's BYO key is accounted for in one place. */
  mode: 'auto_reply' | 'draft' | 'deal_pipeline' | 'playground'
  provider: AiProvider
  model: string
  /** Provider usage; a no-op when null (nothing worth recording). */
  usage: AiUsage | null
}

/**
 * Column added by migration 057. Migrations are applied by hand, out of
 * band, so the code can reach production first; PostgREST then rejects
 * the whole INSERT for the unknown column (PGRST204 from its schema
 * cache, or Postgres' own 42703). Retrying without it keeps the log
 * alive — losing the cached-token split is far better than losing the
 * spend record entirely. Drop this once 057 is applied everywhere.
 */
const CACHED_TOKENS_COLUMN = 'cached_prompt_tokens'

function isUnknownColumnError(error: { code?: string; message?: string }): boolean {
  return (
    (error.code === 'PGRST204' || error.code === '42703') &&
    (error.message ?? '').includes(CACHED_TOKENS_COLUMN)
  )
}

/**
 * Best-effort append to `ai_usage_log` — one row per LLM call, for cost
 * visibility on the account's BYO key. NEVER throws: usage accounting
 * must not fail a reply the customer is waiting on, so any DB error is
 * logged and swallowed. Skips entirely when the provider didn't report
 * usage (we'd only be writing zeros).
 *
 * Pass the service-role admin client from the webhook, or the RLS-scoped
 * SSR client from a route — writes land either way (there's no
 * `authenticated` INSERT policy, so an SSR write relies on the service
 * role; callers that must persist from a route should pass the admin
 * client).
 */
export async function logAiUsage(
  db: SupabaseClient,
  args: LogAiUsageArgs,
): Promise<void> {
  if (!args.usage) return
  try {
    const row: Record<string, unknown> = {
      account_id: args.accountId,
      conversation_id: args.conversationId,
      mode: args.mode,
      provider: args.provider,
      model: args.model,
      prompt_tokens: args.usage.promptTokens,
      completion_tokens: args.usage.completionTokens,
      total_tokens: args.usage.totalTokens,
    }
    if (args.usage.cachedPromptTokens !== undefined) {
      row[CACHED_TOKENS_COLUMN] = args.usage.cachedPromptTokens
    }

    let { error } = await db.from('ai_usage_log').insert(row)
    if (error && isUnknownColumnError(error) && CACHED_TOKENS_COLUMN in row) {
      console.warn(
        `[ai usage] column "${CACHED_TOKENS_COLUMN}" is missing — migration 057 ` +
          'has not been applied to this project. Logging without it.',
      )
      delete row[CACHED_TOKENS_COLUMN]
      ;({ error } = await db.from('ai_usage_log').insert(row))
    }
    if (error) {
      console.error('[ai usage] log insert failed:', error)
    }
  } catch (err) {
    console.error('[ai usage] log insert threw:', err)
  }
}
