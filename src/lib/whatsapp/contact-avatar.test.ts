import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }))
vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: vi.fn(),
  isUniqueViolation: () => false,
}))

import { isFreshStoredAvatar, isWhatsAppPhotoUrl } from './contact-avatar'

describe('isWhatsAppPhotoUrl', () => {
  it('accepts the WhatsApp photo CDN over https', () => {
    expect(isWhatsAppPhotoUrl('https://pps.whatsapp.net/v/t61/x.jpg?oe=1')).toBe(true)
  })
  it('refuses anything the server could be steered to', () => {
    for (const url of [
      'http://pps.whatsapp.net/x.jpg',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/x',
      'https://evilwhatsapp.net/x',
      'https://pps.whatsapp.net.evil.com/x',
      'file:///etc/passwd',
      'not a url',
    ]) {
      expect(isWhatsAppPhotoUrl(url)).toBe(false)
    }
  })
})
import { findOrCreateContact } from './inbound'
import { findExistingContact } from '@/lib/contacts/dedupe'

const STORED = 'https://x.supabase.co/storage/v1/object/public/inbound-media/avatars/acc/c1.jpg'
const NOW = Date.parse('2026-10-14T12:00:00Z')

describe('isFreshStoredAvatar', () => {
  it('accepts our own copy refreshed within the window', () => {
    expect(isFreshStoredAvatar(`${STORED}?v=${NOW - 86_400_000}`, 7 * 86_400_000, NOW)).toBe(true)
  })
  it('re-fetches an old copy', () => {
    expect(isFreshStoredAvatar(`${STORED}?v=${NOW - 8 * 86_400_000}`, 7 * 86_400_000, NOW)).toBe(false)
  })
  it('always replaces an expiring WhatsApp link', () => {
    expect(
      isFreshStoredAvatar('https://pps.whatsapp.net/v/t61/x.jpg?stp=dst-jpg_s96x96_tt6&oe=68F8', undefined, NOW)
    ).toBe(false)
    expect(isFreshStoredAvatar(null)).toBe(false)
  })
})

describe('findOrCreateContact keeps a name edited in the CRM', () => {
  function fakeDb() {
    const updates: Record<string, unknown>[] = []
    const db = {
      from: () => ({
        update: (patch: Record<string, unknown>) => {
          updates.push(patch)
          return { eq: async () => ({ error: null }) }
        },
      }),
    }
    return { db: db as unknown as SupabaseClient, updates }
  }

  it('does not write the WhatsApp name over a locked one', async () => {
    vi.mocked(findExistingContact).mockResolvedValueOnce({
      id: 'c1',
      name: 'Marcone (iPhone 15)',
      name_locked_at: '2026-10-14T10:00:00Z',
    } as never)
    const { db, updates } = fakeDb()
    await findOrCreateContact(db, 'acc', 'u', '5521978365134', 'Marcone Guerra')
    expect(updates.every((u) => !('name' in u))).toBe(true)
  })

  it('still follows WhatsApp for contacts nobody renamed', async () => {
    vi.mocked(findExistingContact).mockResolvedValueOnce({ id: 'c1', name: 'old' } as never)
    const { db, updates } = fakeDb()
    await findOrCreateContact(db, 'acc', 'u', '5521978365134', 'Marcone Guerra')
    expect(updates[0]?.name).toBe('Marcone Guerra')
  })
})
