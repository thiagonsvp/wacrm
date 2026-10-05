import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  backfillInboundMedia,
  INBOUND_MEDIA_RETENTION_DAYS,
  purgeExpiredInboundMedia,
} from '@/lib/storage/inbound-media';

export const maxDuration = 300;

/**
 * Daily sweep of inbound attachment copies older than the retention
 * window (60 days). Hit on a schedule like the other cron endpoints, with
 * the shared `AUTOMATION_CRON_SECRET` in `x-cron-secret`.
 *
 * `?dry=1` lists what would be deleted without deleting.
 * `?backfill_days=N` also copies provider-hosted attachments from the
 * last N days that the provider still serves — a one-off rescue for
 * messages received before copying existed.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (request.headers.get('x-cron-secret') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const dry = url.searchParams.get('dry') === '1';
  const backfillDays = Number(url.searchParams.get('backfill_days'));
  const db = supabaseAdmin();

  try {
    const backfill =
      Number.isFinite(backfillDays) && backfillDays > 0 && !dry
        ? await backfillInboundMedia(db, { days: backfillDays })
        : null;
    const purge = await purgeExpiredInboundMedia(db, {
      days: INBOUND_MEDIA_RETENTION_DAYS,
      apply: !dry,
    });
    return NextResponse.json({ dry_run: dry, backfill, purge });
  } catch (err) {
    console.error('[media/retention] sweep failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
