import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  buildGoogleAdsWhatsAppMessage,
  generateGoogleAdsProtocol,
} from '@/lib/google-ads/protocol';
import type { GoogleClickIdType } from '@/lib/google-ads/api';

const MAX_CLICK_ID = 512;
const MAX_CAMPAIGN_ID = 128;
const MAX_UTM = 256;
const MAX_TEXT = 512;

function value(params: URLSearchParams, key: string, max: number): string {
  const raw = params.get(key)?.trim() ?? '';
  // Google Ads preview/test requests can leave ValueTrack macros literal.
  if (!raw || raw.includes('{') || raw.includes('}')) return '';
  return raw.slice(0, max);
}

/** Like `value`, but for the pre-filled message text — free-form human
 * copy from the site's own WhatsApp button, not a ValueTrack macro, so
 * braces are legitimate content rather than a sign of an unexpanded one. */
function freeText(params: URLSearchParams, key: string, max: number): string {
  return params.get(key)?.trim().slice(0, max) ?? '';
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
 * Stores the real click id behind an opaque six-character protocol and then
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
  const utmSource = value(url.searchParams, 'utm_source', MAX_UTM);
  const utmMedium = value(url.searchParams, 'utm_medium', MAX_UTM);
  const utmCampaign = value(url.searchParams, 'utm_campaign', MAX_UTM);
  // A click-to-WhatsApp ad extension has no utm_content/utm_term of its
  // own — no landing page sits in between to set them — but Google Ads'
  // tracking-template ValueTrack macros play the same role: {creative} is
  // the ad/creative id, {keyword} is the matched search term. Prefer an
  // explicit utm_* (the landing-page-script path) when both are present.
  const utmContent =
    value(url.searchParams, 'utm_content', MAX_UTM) ||
    value(url.searchParams, 'creative', MAX_UTM);
  const utmTerm =
    value(url.searchParams, 'utm_term', MAX_UTM) ||
    value(url.searchParams, 'keyword', MAX_UTM);
  // The landing page's own button already has a pre-filled message tailored
  // to that page (e.g. "Quero orçamento de Fachadas"); fall back to the
  // account's generic message only when the link brought none.
  const customText = freeText(url.searchParams, 'text', MAX_TEXT);

  let protocol = '';
  // Degrades to click-id-only if the utm_* columns (migration 077) are not
  // live yet in this environment, rather than failing a real ad click.
  let utmColumnsMissing = false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = generateGoogleAdsProtocol();
    const { error } = await db.from('google_ads_click_protocols').insert({
      account_id: config.account_id,
      code: candidate,
      click_id: click?.value || null,
      click_id_type: click?.type || null,
      campaign_id: campaignId || null,
      ...(utmColumnsMissing
        ? {}
        : {
            utm_source: utmSource || null,
            utm_medium: utmMedium || null,
            utm_campaign: utmCampaign || null,
            utm_content: utmContent || null,
            utm_term: utmTerm || null,
          }),
    });
    if (!error) {
      protocol = candidate;
      break;
    }
    if (error.code === '42703' && !utmColumnsMissing) {
      utmColumnsMissing = true;
      attempt -= 1;
      continue;
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
    buildGoogleAdsWhatsAppMessage(customText || settings.message, protocol)
  );
  const response = NextResponse.redirect(whatsapp, 302);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}
