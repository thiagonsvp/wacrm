import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Which WhatsApp number to use.
 *
 * An account can have several numbers (migration 087). Every send must go
 * out through the number the conversation lives on, never "the account's
 * config": with two rows, the old `.eq('account_id').single()` lookups
 * errored and every send failed. This is the one place that answers it.
 *
 * Resolution order:
 *   1. an explicit `configId`;
 *   2. the conversation's `whatsapp_config_id`;
 *   3. the account's primary number (`is_primary`), else its oldest row.
 * `provider` restricts the candidates (Meta-only features: templates,
 * media proxy, reactions).
 */

// Loose on purpose: callers read provider-specific columns.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WhatsAppConfigRow = Record<string, any> & {
  id: string
  account_id: string
  provider?: string | null
  is_primary?: boolean | null
  created_at?: string | null
}

export async function listAccountWhatsAppConfigs(
  db: SupabaseClient,
  accountId: string,
  columns = '*'
): Promise<WhatsAppConfigRow[]> {
  const { data, error } = await db
    .from('whatsapp_config')
    .select(columns)
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as WhatsAppConfigRow[]
}

/**
 * The number the CRM uses when it starts a conversation itself. With
 * `provider`, a number of that provider is preferred; if the account has
 * none, the primary is returned anyway so the caller's own provider check
 * can give its specific error ("this feature needs the Meta API").
 */
export function pickPrimary(
  rows: WhatsAppConfigRow[],
  provider?: string
): WhatsAppConfigRow | null {
  const ofProvider = provider ? rows.filter((r) => (r.provider ?? 'meta') === provider) : rows
  const candidates = ofProvider.length ? ofProvider : rows
  return candidates.find((r) => r.is_primary) ?? candidates[0] ?? null
}

export async function resolveWhatsAppConfig(
  db: SupabaseClient,
  accountId: string,
  opts: { conversationId?: string | null; configId?: string | null; provider?: string } = {}
): Promise<WhatsAppConfigRow | null> {
  const rows = await listAccountWhatsAppConfigs(db, accountId)
  if (rows.length === 0) return null

  let configId = opts.configId ?? null
  if (!configId && opts.conversationId) {
    const { data: conv } = await db
      .from('conversations')
      .select('*')
      .eq('id', opts.conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    configId = (conv?.whatsapp_config_id as string | null | undefined) ?? null
  }

  if (configId) {
    const own = rows.find((r) => r.id === configId)
    if (own && (!opts.provider || (own.provider ?? 'meta') === opts.provider)) return own
  }
  return pickPrimary(rows, opts.provider)
}

/**
 * The primary number's id, for a conversation the CRM opens itself
 * (template from the contact page, broadcast, API). Null when the account
 * has no number.
 */
export async function primaryWhatsAppConfigId(
  db: SupabaseClient,
  accountId: string
): Promise<string | null> {
  const rows = await listAccountWhatsAppConfigs(db, accountId, 'id, provider, is_primary, created_at, account_id')
  return pickPrimary(rows)?.id ?? null
}
