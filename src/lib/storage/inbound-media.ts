import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';

/**
 * Inbound WhatsApp attachments copied into our own Storage.
 *
 * UAZAPI hands us a `fileUrl` on its own server, and purges that file
 * after roughly two days — so a `messages.media_url` pointing there goes
 * dead fast. At ingestion we copy the file into this bucket and point the
 * message at the copy instead; a daily sweep deletes copies older than
 * the retention window.
 *
 * Path layout (one folder per UTC day, so the sweep drops whole days
 * without listing every file in the bucket):
 *
 *   inbound-media/account-<account_id>/<YYYY-MM-DD>/<uuid>.<ext>
 *
 * The bucket is public (served straight from the Storage CDN, no proxy
 * hop) and the random uuid in each name is what keeps a URL unguessable
 * — the same model UAZAPI's own links had. Only the service role writes
 * or lists it; there are no storage RLS policies for it.
 */
export const INBOUND_MEDIA_BUCKET = 'inbound-media';
export const INBOUND_MEDIA_RETENTION_DAYS = 60;
/** Keep in step with the bucket's `file_size_limit` (migration 080). */
export const INBOUND_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const LIST_PAGE = 1000;

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/webm': 'weba',
  'audio/wav': 'wav',
  'text/csv': 'csv',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'pptx',
  'text/plain': 'txt',
  'application/zip': 'zip',
};

/** File extension from the response's MIME type, else the source URL. */
export function inboundMediaExtension(
  contentType: string | null | undefined,
  sourceUrl: string
): string {
  const mime = contentType?.split(';')[0]?.trim().toLowerCase();
  if (mime && EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];
  try {
    const last = new URL(sourceUrl).pathname.split('/').pop() ?? '';
    const ext = last.includes('.') ? last.split('.').pop()!.toLowerCase() : '';
    if (/^[a-z0-9]{1,5}$/.test(ext)) return ext;
  } catch {
    // Not a parseable URL — fall through.
  }
  return 'bin';
}

/**
 * The Content-Type the copy is stored (and later served) with. The bucket
 * is public, so trusting the upstream header would let `text/html` or
 * `image/svg+xml` become an executable page on our Storage origin. Only
 * allow-listed media types keep their type; everything else is served as
 * an opaque download.
 */
export function safeInboundContentType(
  contentType: string | null | undefined
): string {
  const mime = contentType?.split(';')[0]?.trim().toLowerCase();
  return mime && EXT_BY_MIME[mime] ? mime : 'application/octet-stream';
}

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildInboundMediaPath(
  accountId: string,
  ext: string,
  now: Date = new Date(),
  id: string = randomUUID()
): string {
  return `account-${accountId}/${utcDay(now)}/${id}.${ext}`;
}

/** Day folders (`YYYY-MM-DD`) strictly older than the retention cutoff. */
export function expiredDayFolders(
  names: string[],
  now: Date,
  days: number = INBOUND_MEDIA_RETENTION_DAYS
): string[] {
  const cutoff = utcDay(new Date(now.getTime() - days * 86_400_000));
  return names.filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n) && n < cutoff);
}

/**
 * Copy one attachment into the bucket. Returns the public URL of the
 * copy, or null on any failure — the caller then keeps the original
 * provider URL, so a failed copy degrades to today's behaviour instead
 * of losing the attachment. Never throws.
 */
export async function persistInboundMedia(
  db: SupabaseClient,
  accountId: string,
  sourceUrl: string
): Promise<string | null> {
  try {
    // The URL comes from the provider (or, on backfill, from a stored
    // media_url) and our server fetches it — refuse private/internal
    // targets, and don't follow redirects that could bounce to one.
    if (!/^https?:\/\//i.test(sourceUrl) || !(await isDeliverableUrl(sourceUrl))) {
      console.warn('[inbound-media] refusing non-public source URL');
      return null;
    }
    const res = await fetch(sourceUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[inbound-media] source responded ${res.status}`);
      return null;
    }
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > INBOUND_MEDIA_MAX_BYTES) {
      console.warn(`[inbound-media] skipping ${declared} byte file (over cap)`);
      return null;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > INBOUND_MEDIA_MAX_BYTES)
      return null;

    const contentType = safeInboundContentType(res.headers.get('content-type'));
    const path = buildInboundMediaPath(
      accountId,
      inboundMediaExtension(contentType, sourceUrl)
    );
    const { error } = await db.storage
      .from(INBOUND_MEDIA_BUCKET)
      .upload(path, bytes, {
        contentType,
        // Names are unique and never rewritten, so the CDN may cache forever.
        cacheControl: '31536000',
        upsert: false,
      });
    if (error) {
      console.warn('[inbound-media] upload failed:', error.message);
      return null;
    }
    return db.storage.from(INBOUND_MEDIA_BUCKET).getPublicUrl(path).data
      .publicUrl;
  } catch (err) {
    console.warn(
      '[inbound-media] copy failed:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Point an already-persisted message at the Storage copy. Awaits the copy
 * that was started in parallel with the rest of the inbound pipeline, so
 * the message reaches the inbox immediately with the provider URL and is
 * swapped once the copy lands. Never throws.
 */
export async function swapToPersistedMedia(
  db: SupabaseClient,
  conversationId: string,
  externalMessageId: string,
  pending: Promise<string | null> | null
): Promise<void> {
  if (!pending) return;
  try {
    const url = await pending;
    if (!url) return;
    const { error } = await db
      .from('messages')
      .update({ media_url: url })
      .eq('conversation_id', conversationId)
      .eq('message_id', externalMessageId);
    if (error) console.warn('[inbound-media] media_url swap failed:', error);
  } catch (err) {
    console.warn('[inbound-media] media_url swap failed:', err);
  }
}

async function listNames(
  db: SupabaseClient,
  prefix: string
): Promise<string[]> {
  const names: string[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await db.storage
      .from(INBOUND_MEDIA_BUCKET)
      .list(prefix, { limit: LIST_PAGE, offset });
    if (error) throw new Error(`list ${prefix || '/'}: ${error.message}`);
    names.push(...(data ?? []).map((o) => o.name));
    if (!data || data.length < LIST_PAGE) break;
  }
  return names;
}

export interface PurgeResult {
  days: number;
  folders: string[];
  files: number;
  messages: number;
}

/**
 * Delete copies older than the retention window and clear the
 * `media_url` of the messages that pointed at them, so the inbox shows
 * the message without a broken attachment rather than a dead link.
 */
export async function purgeExpiredInboundMedia(
  db: SupabaseClient,
  { days = INBOUND_MEDIA_RETENTION_DAYS, now = new Date(), apply = true } = {}
): Promise<PurgeResult> {
  const result: PurgeResult = { days, folders: [], files: 0, messages: 0 };
  const accountFolders = (await listNames(db, '')).filter((n) =>
    n.startsWith('account-')
  );

  for (const account of accountFolders) {
    const expired = expiredDayFolders(await listNames(db, account), now, days);
    for (const day of expired) {
      const folder = `${account}/${day}`;
      const files = (await listNames(db, folder)).map((n) => `${folder}/${n}`);
      result.folders.push(folder);
      result.files += files.length;
      if (!apply) continue;

      for (let i = 0; i < files.length; i += LIST_PAGE) {
        const { error } = await db.storage
          .from(INBOUND_MEDIA_BUCKET)
          .remove(files.slice(i, i + LIST_PAGE));
        if (error) throw new Error(`remove ${folder}: ${error.message}`);
      }

      // The copy is made on the day the message arrives, so bounding by
      // created_at keeps this update off a full-table scan.
      const dayStart = new Date(`${day}T00:00:00Z`).getTime();
      const { count, error } = await db
        .from('messages')
        .update({ media_url: null }, { count: 'exact' })
        .like('media_url', `%/${INBOUND_MEDIA_BUCKET}/${folder}/%`)
        .gte('created_at', new Date(dayStart - 2 * 86_400_000).toISOString())
        .lt('created_at', new Date(dayStart + 2 * 86_400_000).toISOString());
      if (error) throw new Error(`clear media_url ${folder}: ${error.message}`);
      result.messages += count ?? 0;
    }
  }
  return result;
}

/**
 * One-off rescue for attachments received before copying existed: copy
 * any provider-hosted `media_url` from the last `days` days that the
 * provider still serves. Links already gone are left untouched.
 */
export async function backfillInboundMedia(
  db: SupabaseClient,
  { days = 3, limit = 300 } = {}
): Promise<{ examined: number; copied: number }> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await db
    .from('messages')
    .select('id, media_url, conversations!inner(account_id)')
    .gte('created_at', since)
    .like('media_url', 'http%')
    .not('media_url', 'like', '%/storage/v1/object/public/%')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`backfill query: ${error.message}`);

  let copied = 0;
  for (const row of data ?? []) {
    const conv = row.conversations as unknown as
      | { account_id: string }
      | { account_id: string }[];
    const accountId = Array.isArray(conv) ? conv[0]?.account_id : conv?.account_id;
    if (!accountId || !row.media_url) continue;
    const url = await persistInboundMedia(db, accountId, row.media_url);
    if (!url) continue;
    const { error: upErr } = await db
      .from('messages')
      .update({ media_url: url })
      .eq('id', row.id);
    if (!upErr) copied += 1;
  }
  return { examined: data?.length ?? 0, copied };
}
