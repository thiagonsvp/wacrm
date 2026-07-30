import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}))

import {
  isUndefinedColumnError,
  loadAiConfig,
  selectAiConfigRow,
  undefinedColumnName,
  withoutOptionalColumns,
} from './config'

function dbReturning(row: Record<string, unknown> | null): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  }
  return chain as unknown as SupabaseClient
}

const ROW = {
  provider: 'openai',
  model: 'gpt-x',
  api_key: 'enc-key',
  system_prompt: null,
  is_active: false,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  embeddings_api_key: null,
}

describe('loadAiConfig requireActive', () => {
  it('returns null for an inactive config by default', async () => {
    expect(await loadAiConfig(dbReturning(ROW), 'acct')).toBeNull()
  })

  it('returns the config when requireActive is false (Playground path)', async () => {
    const config = await loadAiConfig(dbReturning(ROW), 'acct', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai')
    expect(config!.apiKey).toBe('plain:enc-key')
  })

  it('returns null when there is no row', async () => {
    expect(
      await loadAiConfig(dbReturning(null), 'acct', { requireActive: false }),
    ).toBeNull()
  })
})

function undefinedColumn(name: string) {
  return { code: '42703', message: `column ai_configs.${name} does not exist` }
}

/**
 * Minimal PostgREST stub. `present` is the set of columns this fake
 * database actually has; selecting anything else fails the way Postgres
 * does, one column at a time.
 */
function fakeDb(present: Set<string>, row: Record<string, unknown>) {
  const attempts: string[][] = []
  const db = {
    from: () => ({
      select: (cols: string) => {
        const requested = cols.split(',').map((c) => c.trim())
        attempts.push(requested)
        const missing = requested.find((c) => !present.has(c))
        return {
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve(
                missing
                  ? { data: null, error: undefinedColumn(missing) }
                  : {
                      data: Object.fromEntries(
                        requested.map((c) => [c, row[c] ?? null]),
                      ),
                      error: null,
                    },
              ),
          }),
        }
      },
    }),
  } as unknown as SupabaseClient
  return { db, attempts }
}

const ALL =
  'provider, model, deal_pipeline_enabled, deal_product_scope, deal_stage_qualified_id'

describe('undefinedColumnName', () => {
  it('extracts a qualified column name', () => {
    expect(undefinedColumnName(undefinedColumn('deal_product_scope'))).toBe(
      'deal_product_scope',
    )
  })

  it('extracts an unqualified column name', () => {
    expect(undefinedColumnName({ message: 'column "foo_bar" does not exist' })).toBe(
      'foo_bar',
    )
  })

  it('returns null for an unrelated error', () => {
    expect(undefinedColumnName({ message: 'permission denied' })).toBeNull()
    expect(undefinedColumnName(null)).toBeNull()
  })
})

describe('selectAiConfigRow — partially applied migrations', () => {
  it('returns everything when all columns exist', async () => {
    const { db, attempts } = fakeDb(
      new Set(ALL.split(',').map((c) => c.trim())),
      { provider: 'openai', deal_pipeline_enabled: true },
    )
    const res = await selectAiConfigRow(db, 'acct', ALL)
    expect(res.error).toBeNull()
    expect(res.data?.deal_pipeline_enabled).toBe(true)
    expect(attempts).toHaveLength(1)
  })

  it('keeps the 042 column when only 043 is missing', async () => {
    // The bug this guards, seen live: a blanket retry dropped every
    // optional column at once, so `deal_pipeline_enabled` (042, applied)
    // came back undefined, read as false, and the pipeline silently
    // never ran on any inbound message.
    const { db } = fakeDb(new Set(['provider', 'model', 'deal_pipeline_enabled']), {
      provider: 'openai',
      deal_pipeline_enabled: true,
    })
    const res = await selectAiConfigRow(db, 'acct', ALL)
    expect(res.error).toBeNull()
    expect(res.data?.deal_pipeline_enabled).toBe(true)
    expect(res.data).not.toHaveProperty('deal_product_scope')
  })

  it('drops one column per round until the query succeeds', async () => {
    const { db, attempts } = fakeDb(new Set(['provider', 'model']), {
      provider: 'openai',
    })
    const res = await selectAiConfigRow(db, 'acct', ALL)
    expect(res.error).toBeNull()
    expect(attempts.at(-1)).toEqual(['provider', 'model'])
  })

  it('surfaces a missing NON-optional column instead of narrowing', async () => {
    // A typo in a required column is a bug; quietly dropping it would
    // hide it behind a half-populated config.
    const { db, attempts } = fakeDb(new Set(['model']), {})
    const res = await selectAiConfigRow(db, 'acct', 'provider, model')
    expect(res.error?.code).toBe('42703')
    expect(attempts).toHaveLength(1)
  })

  it('passes a non-column error straight through', async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: null,
                error: { code: '42501', message: 'permission denied' },
              }),
          }),
        }),
      }),
    } as unknown as SupabaseClient
    const res = await selectAiConfigRow(db, 'acct', ALL)
    expect(res.error?.code).toBe('42501')
  })
})

describe('withoutOptionalColumns', () => {
  it('strips optional columns from a write payload', () => {
    expect(
      withoutOptionalColumns({
        provider: 'openai',
        deal_pipeline_enabled: true,
        deal_product_scope: 'iPhone',
      }),
    ).toEqual({ provider: 'openai' })
  })
})

describe('isUndefinedColumnError', () => {
  it('recognises 42703 only', () => {
    expect(isUndefinedColumnError({ code: '42703' })).toBe(true)
    expect(isUndefinedColumnError({ code: '42P01' })).toBe(false)
    expect(isUndefinedColumnError(null)).toBe(false)
  })
})
