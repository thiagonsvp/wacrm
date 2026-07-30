import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { AiConfig } from './types'

interface AiConfigRow {
  provider: 'openai' | 'anthropic'
  model: string
  api_key: string
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  handoff_agent_id: string | null
  embeddings_api_key: string | null
  deal_pipeline_enabled: boolean | null
}

const CONFIG_COLUMNS =
  'provider, model, api_key, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, embeddings_api_key, deal_pipeline_enabled'

/**
 * Columns introduced by migration 042 (`042_ai_deal_pipeline.sql`).
 *
 * Migrations in this project are applied by hand, out of band, so the
 * code can reach production before the SQL does. Selecting a column that
 * doesn't exist yet is a hard PostgREST error, which would take down the
 * AI settings page and the assistant — including the very page an
 * operator needs in order to finish setting AI up. Degrading to "the
 * feature is off" is the only safe failure direction here.
 *
 * Delete this list and `selectAiConfigRow`'s retry once 042 is applied
 * everywhere.
 */
const POST_042_COLUMNS = ['deal_pipeline_enabled']

/**
 * Read the account's `ai_configs` row, retrying once without the post-042
 * columns when Postgres reports one as undefined (SQLSTATE 42703).
 *
 * Any other error is returned untouched — only the "migration not applied
 * yet" case is papered over, and it is papered over loudly.
 */
export interface AiConfigRowResult {
  data: Record<string, unknown> | null
  error: { code?: string; message?: string } | null
}

export async function selectAiConfigRow(
  db: SupabaseClient,
  accountId: string,
  columns: string,
): Promise<AiConfigRowResult> {
  // `columns` is a runtime string, so PostgREST's generic inference can't
  // derive a row type from it — normalise to a plain record and let the
  // callers assert the shape they asked for.
  const read = async (cols: string): Promise<AiConfigRowResult> => {
    const res = await db
      .from('ai_configs')
      .select(cols)
      .eq('account_id', accountId)
      .maybeSingle()
    return {
      data: (res.data ?? null) as Record<string, unknown> | null,
      error: res.error,
    }
  }

  const first = await read(columns)
  if (!isUndefinedColumnError(first.error)) return first

  console.warn(
    '[ai config] supabase/migrations/042_ai_deal_pipeline.sql has not been applied ' +
      'to this project — the AI deal pipeline stays off until it is.',
  )
  const reduced = columns
    .split(',')
    .map((c) => c.trim())
    .filter((c) => !POST_042_COLUMNS.includes(c))
    .join(', ')
  return read(reduced)
}

/** True when Postgres rejected the statement for an undefined column. */
export function isUndefinedColumnError(error: { code?: string } | null): boolean {
  return error?.code === '42703'
}

/**
 * Drop the post-042 columns from a write payload, so a save can be
 * retried on a project that hasn't applied the migration. The toggle then
 * simply isn't persisted — which matches the read side degrading to off.
 */
export function withoutPost042Columns(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...payload }
  for (const column of POST_042_COLUMNS) delete out[column]
  return out
}

/**
 * Load and decrypt the account's AI config for *use* (draft or
 * auto-reply). Returns `null` when there's no row or the master switch
 * (`is_active`) is off — both mean "AI is not available", which callers
 * treat identically. Throws only if the stored key can't be decrypted
 * (mismatched `ENCRYPTION_KEY`), so that distinct failure surfaces
 * rather than looking like "not configured".
 *
 * Works with any client: pass the RLS-scoped SSR client from a
 * dashboard route, or the service-role admin client from the webhook.
 */
export async function loadAiConfig(
  db: SupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean } = {},
): Promise<AiConfig | null> {
  const { requireActive = true } = opts
  const { data, error } = await selectAiConfigRow(db, accountId, CONFIG_COLUMNS)

  if (error) throw error
  if (!data) return null

  // `deal_pipeline_enabled` is absent when the retry above dropped it;
  // the mapping below coalesces it to false.
  const row = data as unknown as AiConfigRow
  // The Playground passes requireActive:false so an admin can test the
  // agent before flipping the master switch on.
  if (requireActive && !row.is_active) return null
  // Defensive: the column is NOT NULL, but a partial write / manual DB
  // edit could leave it empty. Treat a missing key as "not configured"
  // rather than letting decrypt() throw on null.
  if (!row.api_key) return null

  // The embeddings key is optional and independent of the chat key —
  // a corrupt/undecryptable one should downgrade to lexical KB, not
  // take down draft/auto-reply, so decrypt failures are swallowed here.
  let embeddingsApiKey: string | null = null
  if (row.embeddings_api_key) {
    try {
      embeddingsApiKey = decrypt(row.embeddings_api_key)
    } catch {
      // Not silent — a rotated/mismatched ENCRYPTION_KEY here means
      // semantic search quietly stops working, so leave a breadcrumb.
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`,
      )
      embeddingsApiKey = null
    }
  }

  return {
    provider: row.provider,
    model: row.model,
    apiKey: decrypt(row.api_key),
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    embeddingsApiKey,
    // Coalesced rather than trusted: the column is NOT NULL DEFAULT false
    // once migration 042 is applied, but treating a null as "off" keeps a
    // project that hasn't run it yet from silently enabling board writes.
    dealPipelineEnabled: row.deal_pipeline_enabled === true,
  }
}

/**
 * Load + decrypt just the embeddings key, independent of `is_active`.
 * Used by the knowledge-base ingest routes so the KB gets embedded (and
 * semantic search works) whenever an embeddings key is present, even if
 * the assistant's master switch is currently off.
 *
 * Returns `{ key, corrupt }`: `key` is null when there's no key OR it
 * can't be decrypted; `corrupt` distinguishes those cases so callers can
 * warn ("a key is set but unusable") rather than silently indexing
 * lexical-only and reporting success.
 */
export async function loadEmbeddingsKey(
  db: SupabaseClient,
  accountId: string,
): Promise<{ key: string | null; corrupt: boolean }> {
  const { data, error } = await db
    .from('ai_configs')
    .select('embeddings_api_key')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data?.embeddings_api_key) return { key: null, corrupt: false }
  try {
    return { key: decrypt(data.embeddings_api_key), corrupt: false }
  } catch {
    console.error(
      `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
    )
    return { key: null, corrupt: true }
  }
}
