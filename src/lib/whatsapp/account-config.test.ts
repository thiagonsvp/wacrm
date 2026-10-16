import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pickPrimary, resolveWhatsAppConfig, type WhatsAppConfigRow } from './account-config'

const igor: WhatsAppConfigRow = { id: 'igor', account_id: 'acc', provider: 'uazapi', is_primary: true, created_at: '2026-01-01' }
const priscila: WhatsAppConfigRow = { id: 'pri', account_id: 'acc', provider: 'uazapi', is_primary: false, created_at: '2026-02-01' }
const meta: WhatsAppConfigRow = { id: 'meta', account_id: 'acc', provider: 'meta', is_primary: false, created_at: '2026-03-01' }

/** Serves the account's numbers and one conversation row. */
function fakeDb(rows: WhatsAppConfigRow[], conversation: Record<string, unknown> | null) {
  const db = {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () =>
          table === 'whatsapp_config' ? Promise.resolve({ data: rows, error: null }) : chain,
        maybeSingle: () => Promise.resolve({ data: conversation, error: null }),
      }
      return chain
    },
  }
  return db as unknown as SupabaseClient
}

describe('resolveWhatsAppConfig', () => {
  it('replies on the number the conversation lives on, not the primary', async () => {
    const db = fakeDb([igor, priscila], { whatsapp_config_id: 'pri' })
    expect((await resolveWhatsAppConfig(db, 'acc', { conversationId: 'c1' }))?.id).toBe('pri')
  })

  it('falls back to the primary for an old conversation with no number', async () => {
    const db = fakeDb([igor, priscila], { whatsapp_config_id: null })
    expect((await resolveWhatsAppConfig(db, 'acc', { conversationId: 'c1' }))?.id).toBe('igor')
  })

  it('ignores a number that belongs to another company', async () => {
    const db = fakeDb([igor, priscila], { whatsapp_config_id: 'someone-elses' })
    expect((await resolveWhatsAppConfig(db, 'acc', { conversationId: 'c1' }))?.id).toBe('igor')
  })

  it('prefers the Meta number for Meta-only features', async () => {
    const db = fakeDb([igor, priscila, meta], null)
    expect((await resolveWhatsAppConfig(db, 'acc', { provider: 'meta' }))?.id).toBe('meta')
  })

  it('returns null when the company has no number', async () => {
    expect(await resolveWhatsAppConfig(fakeDb([], null), 'acc')).toBeNull()
  })
})

describe('pickPrimary', () => {
  it('uses the oldest number when none is marked primary (before migration 087)', () => {
    expect(pickPrimary([{ ...igor, is_primary: undefined }, priscila])?.id).toBe('igor')
  })

  it('still returns a number when none has the requested provider, so the caller can explain', () => {
    expect(pickPrimary([igor, priscila], 'meta')?.id).toBe('igor')
  })
})
