import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { findOrCreateContact, resolveAuditUserId } from '@/lib/api/v1/contacts';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import type { GoogleClickIdType } from '@/lib/google-ads/api';

const TEXT_LIMIT = 512;

function cors(origin: string | null): Record<string, string> {
  return origin
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : {};
}

function clean(value: unknown, max = TEXT_LIMIT): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function websiteOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

async function configFor(token: string) {
  const db = supabaseAdmin();
  const { data } = await db
    .from('google_ads_configs')
    .select('account_id, website_url')
    .eq('webhook_token', token)
    .maybeSingle();
  return data;
}

export async function OPTIONS(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const config = await configFor(token);
  if (!config) return new NextResponse(null, { status: 404 });
  const allowed = websiteOrigin(config.website_url);
  const origin = request.headers.get('origin');
  if (allowed && origin && origin !== allowed)
    return new NextResponse(null, { status: 403 });
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...cors(allowed || origin),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const config = await configFor(token);
  if (!config)
    return NextResponse.json({ error: 'Unknown endpoint' }, { status: 404 });
  const allowed = websiteOrigin(config.website_url);
  const origin = request.headers.get('origin');
  if (allowed && origin && origin !== allowed) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
  }
  const forwarded =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const limit = checkRateLimit(
    `google-lead:${token}:${forwarded}`,
    RATE_LIMITS.leadWebhook
  );
  if (!limit.success) return rateLimitResponse(limit);

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body)
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers: cors(allowed || origin) }
    );
  const phone = clean(body.phone, 40);
  if (!phone)
    return NextResponse.json(
      { error: 'phone is required' },
      { status: 400, headers: cors(allowed || origin) }
    );

  const candidates: Array<[GoogleClickIdType, string]> = [
    ['gclid', clean(body.gclid)],
    ['gbraid', clean(body.gbraid)],
    ['wbraid', clean(body.wbraid)],
  ];
  const click = candidates.find(([, value]) => !!value);
  const db = supabaseAdmin();
  try {
    const auditUserId = await resolveAuditUserId(db, config.account_id);
    const contact = await findOrCreateContact(
      db,
      config.account_id,
      auditUserId,
      {
        phone,
        name: clean(body.name, 160) || null,
        email: clean(body.email, 254) || null,
        company: clean(body.company, 160) || null,
      }
    );
    const update: Record<string, unknown> = {
      ...(clean(body.name, 160) ? { name: clean(body.name, 160) } : {}),
      ...(clean(body.email, 254) ? { email: clean(body.email, 254) } : {}),
      ...(clean(body.company, 160)
        ? { company: clean(body.company, 160) }
        : {}),
      ...(click
        ? {
            acquisition_source: 'Google',
            acquisition_gclid: click[1],
            acquisition_click_id_type: click[0],
          }
        : {}),
      ...(clean(body.utm_campaign)
        ? { acquisition_campaign: clean(body.utm_campaign) }
        : {}),
      ...(clean(body.utm_id)
        ? { acquisition_source_id: clean(body.utm_id) }
        : {}),
      ...(clean(body.utm_medium)
        ? { acquisition_medium: clean(body.utm_medium) }
        : {}),
      ...(clean(body.utm_term)
        ? { acquisition_term: clean(body.utm_term) }
        : {}),
      ...(clean(body.utm_content)
        ? { acquisition_content: clean(body.utm_content) }
        : {}),
      ...(clean(body.landing_url, 2048)
        ? { acquisition_url: clean(body.landing_url, 2048) }
        : {}),
      updated_at: new Date().toISOString(),
    };
    const { error } = await db
      .from('contacts')
      .update(update)
      .eq('id', contact.id)
      .eq('account_id', config.account_id);
    if (error) throw error;
    return NextResponse.json(
      { success: true, contact_id: contact.id, created: contact.created },
      { headers: cors(allowed || origin) }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to store lead';
    const status =
      typeof error === 'object' && error && 'status' in error
        ? Number(error.status)
        : 500;
    return NextResponse.json(
      { error: status < 500 ? message : 'Failed to store lead' },
      { status, headers: cors(allowed || origin) }
    );
  }
}
