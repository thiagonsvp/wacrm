import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { INBOUND_MEDIA_BUCKET } from '@/lib/storage/inbound-media'

/**
 * Contact profile photos, kept as our own copy.
 *
 * WhatsApp profile-picture URLs (pps.whatsapp.net) carry an expiry (`oe=`)
 * and stop loading after a couple of weeks, and the URL in the webhook
 * payload is a 96×96 thumbnail — what the inbox showed, blurry when
 * enlarged and broken once expired. UAZAPI's `/chat/details` returns the
 * full-size image; we download it once and serve it from Storage.
 *
 * Stored under `avatars/` in the public inbound-media bucket. The 60-day
 * media retention only walks `account-*` day folders, so these stay.
 */

export interface UazapiCredentials {
  uazapi_base_url: string | null
  uazapi_instance_name?: string | null
  uazapi_token: string | null
}

/** A stored copy is re-fetched after this long, to pick up photo changes. */
export const AVATAR_REFRESH_DAYS = 7
const MAX_AVATAR_BYTES = 5 * 1024 * 1024
const STORED_MARKER = `/${INBOUND_MEDIA_BUCKET}/avatars/`

/** True when `url` is our own copy, refreshed within `maxAgeMs`. */
export function isFreshStoredAvatar(
  url: string | null | undefined,
  maxAgeMs = AVATAR_REFRESH_DAYS * 86_400_000,
  now = Date.now()
): boolean {
  if (!url || !url.includes(STORED_MARKER)) return false
  const v = Number(new URL(url).searchParams.get('v'))
  return Number.isFinite(v) && v > 0 && now - v < maxAgeMs
}

/** Full-size profile photo URL from UAZAPI, or null (no photo / instance down). */
export async function fetchUazapiProfileImage(
  config: UazapiCredentials,
  phone: string
): Promise<string | null> {
  if (!config.uazapi_base_url || !config.uazapi_token) return null
  try {
    const res = await fetch(`${config.uazapi_base_url.replace(/\/+$/, '')}/chat/details`, {
      method: 'POST',
      headers: { token: decrypt(config.uazapi_token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: phone, preview: false }),
      // Cosmetic: a slow UAZAPI must never hold a webhook run open.
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { image?: string; imagePreview?: string }
    return data.image || data.imagePreview || null
  } catch {
    return null
  }
}

/** Download `sourceUrl` into Storage; returns the public URL (cache-busted). */
export async function storeContactAvatar(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  sourceUrl: string
): Promise<string | null> {
  try {
    const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const type = res.headers.get('content-type') || 'image/jpeg'
    if (!type.startsWith('image/')) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_BYTES) return null
    const path = `avatars/${accountId}/${contactId}.jpg`
    const { error } = await db.storage
      .from(INBOUND_MEDIA_BUCKET)
      .upload(path, bytes, { contentType: type, upsert: true, cacheControl: '86400' })
    if (error) {
      console.warn('[contact-avatar] upload failed:', error.message)
      return null
    }
    const { data } = db.storage.from(INBOUND_MEDIA_BUCKET).getPublicUrl(path)
    // Same path on every refresh, so the version param is what makes
    // browsers and the CDN pick up a new photo (and dates the copy).
    return `${data.publicUrl}?v=${Date.now()}`
  } catch (err) {
    console.warn('[contact-avatar] download failed:', err)
    return null
  }
}

/**
 * Make sure the contact has a current, full-size photo. Does nothing when
 * our copy is still fresh (unless `force`), so it is cheap to call on
 * every message. Returns the URL now on the contact, or null when nothing
 * could be fetched (the existing URL is left untouched).
 */
export async function refreshContactAvatar(
  db: SupabaseClient,
  configs: UazapiCredentials | UazapiCredentials[],
  contact: { id: string; account_id: string; phone: string; avatar_url?: string | null },
  { maxAgeMs }: { maxAgeMs?: number } = {}
): Promise<string | null> {
  if (isFreshStoredAvatar(contact.avatar_url, maxAgeMs)) return contact.avatar_url ?? null
  for (const config of Array.isArray(configs) ? configs : [configs]) {
    const source = await fetchUazapiProfileImage(config, contact.phone)
    if (!source) continue
    const stored = await storeContactAvatar(db, contact.account_id, contact.id, source)
    if (!stored) continue
    const { error } = await db
      .from('contacts')
      .update({ avatar_url: stored })
      .eq('id', contact.id)
    if (error) {
      console.warn('[contact-avatar] contact update failed:', error.message)
      return null
    }
    return stored
  }
  return null
}
