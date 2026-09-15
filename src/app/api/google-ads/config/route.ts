import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import { testGoogleAdsConnection } from '@/lib/google-ads/api';

const MISSING_TABLE = '42P01';
const SECRET_FIELDS = [
  'client_secret',
  'refresh_token',
  'developer_token',
] as const;

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function string(body: Record<string, unknown>, key: string): string {
  return typeof body[key] === 'string' ? body[key].trim() : '';
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function validWebsiteUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname))
    );
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { data, error } = await supabase
      .from('google_ads_configs')
      .select(
        'customer_id, login_customer_id, client_id, client_secret, refresh_token, developer_token, qualified_lead_conversion_action_id, purchase_conversion_action_id, website_url, webhook_token, is_active, send_qualified_lead, send_purchase'
      )
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) {
      if (error.code === MISSING_TABLE) {
        return NextResponse.json({
          configured: false,
          migration_pending: true,
        });
      }
      console.error('[google-ads/config GET] fetch failed:', error);
      return NextResponse.json(
        { error: 'Failed to load Google Ads configuration' },
        { status: 500 }
      );
    }
    if (!data) return NextResponse.json({ configured: false });
    const { client_secret, refresh_token, developer_token, ...safe } = data;
    return NextResponse.json({
      configured: true,
      has_client_secret: !!client_secret,
      has_refresh_token: !!refresh_token,
      has_developer_token: !!developer_token,
      ...safe,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(
      `google-ads-config:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) return bad('Invalid request body');

    const customerId = onlyDigits(string(body, 'customer_id'));
    const loginCustomerId = onlyDigits(string(body, 'login_customer_id'));
    const clientId = string(body, 'client_id');
    const leadAction = onlyDigits(
      string(body, 'qualified_lead_conversion_action_id')
    );
    const purchaseAction = onlyDigits(
      string(body, 'purchase_conversion_action_id')
    );
    const websiteUrl = string(body, 'website_url').replace(/\/$/, '');
    if (!/^\d{10}$/.test(customerId))
      return bad('customer_id must contain 10 digits');
    if (loginCustomerId && !/^\d{10}$/.test(loginCustomerId))
      return bad('login_customer_id must contain 10 digits');
    if (!clientId) return bad('client_id is required');
    if (!validWebsiteUrl(websiteUrl))
      return bad('website_url must be a valid HTTPS URL');
    if (
      body.is_active === true &&
      body.send_qualified_lead !== false &&
      !leadAction
    ) {
      return bad(
        'qualified_lead_conversion_action_id is required while qualified leads are enabled'
      );
    }
    if (
      body.is_active === true &&
      body.send_purchase === true &&
      !purchaseAction
    ) {
      return bad(
        'purchase_conversion_action_id is required while purchases are enabled'
      );
    }

    const { data: existing, error: existingError } = await supabase
      .from('google_ads_configs')
      .select('id, client_secret, refresh_token, developer_token')
      .eq('account_id', accountId)
      .maybeSingle();
    if (existingError && existingError.code === MISSING_TABLE) {
      return bad(
        'Run supabase/migrations/073_google_ads_offline_conversions.sql first.'
      );
    }

    const payload: Record<string, unknown> = {
      customer_id: customerId,
      login_customer_id: loginCustomerId || null,
      client_id: clientId,
      qualified_lead_conversion_action_id: leadAction || null,
      purchase_conversion_action_id: purchaseAction || null,
      website_url: websiteUrl || null,
      is_active: body.is_active === true,
      send_qualified_lead: body.send_qualified_lead !== false,
      send_purchase: body.send_purchase === true,
    };

    for (const field of SECRET_FIELDS) {
      const raw = string(body, field);
      if (raw) payload[field] = encrypt(raw);
      else if (!existing && field !== 'developer_token')
        return bad(`${field} is required`);
    }

    const result = existing
      ? await supabase
          .from('google_ads_configs')
          .update(payload)
          .eq('account_id', accountId)
      : await supabase.from('google_ads_configs').insert({
          account_id: accountId,
          created_by: userId,
          developer_token: null,
          ...payload,
        });
    if (result.error) {
      console.error('[google-ads/config POST] save failed:', result.error);
      return NextResponse.json(
        { error: 'Failed to save Google Ads configuration' },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(
      `google-ads-test:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const { data, error } = await supabase
      .from('google_ads_configs')
      .select(
        'customer_id, login_customer_id, client_id, client_secret, refresh_token, developer_token'
      )
      .eq('account_id', accountId)
      .maybeSingle();
    if (error || !data) return bad('Save the Google Ads credentials first.');
    try {
      const result = await testGoogleAdsConnection({
        customerId: data.customer_id,
        loginCustomerId: data.login_customer_id,
        clientId: data.client_id,
        clientSecret: decrypt(data.client_secret),
        refreshToken: decrypt(data.refresh_token),
        developerToken: data.developer_token
          ? decrypt(data.developer_token)
          : null,
      });
      if (!result.ok)
        return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ success: true });
    } catch {
      return bad(
        'Stored credentials could not be decrypted; enter them again.'
      );
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Rotate the capability token after accidental disclosure or site changes. */
export async function PATCH() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(
      `google-ads-webhook-rotate:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const webhookToken = randomBytes(32).toString('hex');
    const { error } = await supabase
      .from('google_ads_configs')
      .update({ webhook_token: webhookToken })
      .eq('account_id', accountId);
    if (error) {
      console.error('[google-ads/config PATCH] rotate failed:', error);
      return NextResponse.json(
        { error: 'Failed to rotate the lead webhook' },
        { status: 500 }
      );
    }
    return NextResponse.json({ webhook_token: webhookToken });
  } catch (error) {
    return toErrorResponse(error);
  }
}
