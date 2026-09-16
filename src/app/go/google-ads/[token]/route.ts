import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  buildGoogleAdsWhatsAppMessage,
  generateGoogleAdsProtocol,
} from '@/lib/google-ads/protocol';
import type { GoogleClickIdType } from '@/lib/google-ads/api';

const MAX_CLICK_ID = 512;
const MAX_CAMPAIGN_ID = 128;

function value(params: URLSearchParams, key: string, max: number): string {
  const raw = params.get(key)?.trim() ?? '';
  // Google Ads preview/test requests can leave ValueTrack macros literal.
  if (!raw || raw.includes('{') || raw.includes('}')) return '';
  return raw.slice(0, max);
}

function clickIdentifier(
  params: URLSearchParams
): { type: GoogleClickIdType; value: string } | null {
  for (const type of ['gclid', 'gbraid', 'wbraid'] as const) {
    const clickId = value(params, type, MAX_CLICK_ID);
    if (clickId) return { type, value: clickId };
  }
  return null;
}

function unavailable(message: string, status = 503) {
  return new NextResponse(message, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}

/**
 * Public Google Ads destination for direct-to-WhatsApp campaigns.
 * Stores the real click id behind an opaque five-character protocol and then
 * redirects to WhatsApp. No credential or click identifier reaches the chat.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const db = supabaseAdmin();
  const { data: config, error: configError } = await db
    .from('google_ads_configs')
    .select('account_id')
    .eq('webhook_token', token)
    .maybeSingle();
  if (configError || !config) return unavailable('Link inválido.', 404);

  const { data: settings, error: settingsError } = await db
    .from('google_ads_whatsapp_settings')
    .select('phone, message')
    .eq('account_id', config.account_id)
    .maybeSingle();
  if (settingsError || !settings)
    return unavailable(
      'Configure o WhatsApp direto no CRM antes de usar este link.'
    );

  const url = new URL(request.url);
  const click = clickIdentifier(url.searchParams);
  const campaignId = value(url.searchParams, 'campaignid', MAX_CAMPAIGN_ID);

  let protocol = '';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = generateGoogleAdsProtocol();
    const { error } = await db.from('google_ads_click_protocols').insert({
      account_id: config.account_id,
      code: candidate,
      click_id: click?.value || null,
      click_id_type: click?.type || null,
      campaign_id: campaignId || null,
    });
    if (!error) {
      protocol = candidate;
      break;
    }
    if (error.code !== '23505') {
      console.error('[google ads] protocol creation failed:', error);
      return unavailable(
        'Não foi possível iniciar o atendimento. Tente novamente.'
      );
    }
  }
  if (!protocol)
    return unavailable('Não foi possível gerar o protocolo. Tente novamente.');

  const whatsapp = new URL(`https://wa.me/${settings.phone}`);
  whatsapp.searchParams.set(
    'text',
    buildGoogleAdsWhatsAppMessage(settings.message, protocol)
  );
  const response = NextResponse.redirect(whatsapp, 302);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}
