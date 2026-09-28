import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AcquisitionData } from '@/lib/whatsapp/inbound';
import type { GoogleClickIdType } from './api';

const PROTOCOL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PROTOCOL_LENGTH = 6;
// Accepts 5 or 6 chars so protocols already redirected under the old
// 5-character format (still resolvable for MAX_AGE_DAYS) keep parsing
// correctly during the rollout of the new length.
const PROTOCOL_PATTERN = /(?:^|\s)Protocolo:\s*([A-Z2-9]{5,6})(?=\s|$)/i;
const MAX_AGE_DAYS = 90;

export interface GoogleAdsProtocolMatch {
  id: string;
  code: string;
  acquisition: AcquisitionData;
}

export function generateGoogleAdsProtocol(): string {
  const bytes = randomBytes(PROTOCOL_LENGTH);
  return Array.from(
    bytes,
    (byte) => PROTOCOL_ALPHABET[byte % PROTOCOL_ALPHABET.length]
  ).join('');
}

export function parseGoogleAdsProtocol(
  text: string | null | undefined
): string | null {
  return text?.match(PROTOCOL_PATTERN)?.[1]?.toUpperCase() ?? null;
}

export function buildGoogleAdsWhatsAppMessage(
  message: string,
  protocol: string
): string {
  return `${message.trim()}\n\nProtocolo: ${protocol}`;
}

export interface GoogleAdsProtocolUtm {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  term?: string | null;
}

export function buildGoogleAdsProtocolAcquisition(
  protocol: string,
  clickId: string | null,
  clickIdType: GoogleClickIdType | null,
  campaignId: string | null,
  utm?: GoogleAdsProtocolUtm
): AcquisitionData {
  const utmSource = utm?.source?.toLowerCase() ?? null;
  // A Google click id always wins the attribution — it is the only signal
  // that can be reconciled with an actual ad spend row. Without one, fall
  // back to whatever generic utm_source the landing page carried; the
  // reporting rule still classifies a bare utm_source as organic otherwise.
  const source = clickId
    ? ('Google' as const)
    : utmSource === 'facebook'
      ? ('Facebook' as const)
      : utmSource === 'instagram'
        ? ('Instagram' as const)
        : null;
  return {
    source,
    // ValueTrack gives us the numeric campaign id, not its display name —
    // utm_campaign (below) carries the human-readable one when present.
    sourceId: campaignId,
    campaign: utm?.campaign || null,
    medium: utm?.medium || null,
    term: utm?.term || null,
    content: utm?.content || null,
    gclid: clickId,
    clickIdType: clickId ? clickIdType : null,
    // Kept regardless of clickId so an organic lead from this flow still
    // traces back to the click protocol row for support/debugging.
    protocol,
  };
}

/** Resolve only unclaimed, non-expired protocols so forwarded messages cannot
 * steal another lead's click attribution. Webhook retries are harmless: after
 * the first claim the contact already owns the click id. */
export async function resolveGoogleAdsProtocol(
  db: SupabaseClient,
  accountId: string,
  text: string | null | undefined
): Promise<GoogleAdsProtocolMatch | null> {
  const code = parseGoogleAdsProtocol(text);
  if (!code) return null;

  const oldest = new Date(
    Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data, error } = await db
    .from('google_ads_click_protocols')
    .select(
      'id, code, click_id, click_id_type, campaign_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term'
    )
    .eq('account_id', accountId)
    .eq('code', code)
    .is('contact_id', null)
    .gte('created_at', oldest)
    .maybeSingle();

  if (error) {
    if (error.code !== '42P01')
      console.error('[google ads] protocol lookup failed:', error);
    return null;
  }
  if (!data) return null;

  const clickIdType = data.click_id_type as GoogleClickIdType | null;
  const clickId = (data.click_id as string | null) ?? null;
  const campaignId = (data.campaign_id as string | null) ?? null;
  return {
    id: data.id as string,
    code: data.code as string,
    acquisition: buildGoogleAdsProtocolAcquisition(
      data.code as string,
      clickId,
      clickIdType,
      campaignId,
      {
        source: data.utm_source as string | null,
        medium: data.utm_medium as string | null,
        campaign: data.utm_campaign as string | null,
        content: data.utm_content as string | null,
        term: data.utm_term as string | null,
      }
    ),
  };
}

export async function claimGoogleAdsProtocol(
  db: SupabaseClient,
  protocolId: string,
  contactId: string
): Promise<void> {
  const { error } = await db
    .from('google_ads_click_protocols')
    .update({ contact_id: contactId, claimed_at: new Date().toISOString() })
    .eq('id', protocolId)
    .is('contact_id', null);
  if (error && error.code !== '42P01')
    console.error('[google ads] protocol claim failed:', error);
}
