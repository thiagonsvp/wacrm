import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AcquisitionData } from '@/lib/whatsapp/inbound';
import type { GoogleClickIdType } from './api';

const PROTOCOL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PROTOCOL_PATTERN = /(?:^|\s)Protocolo:\s*([A-Z2-9]{5})(?=\s|$)/i;
const MAX_AGE_DAYS = 90;

export interface GoogleAdsProtocolMatch {
  id: string;
  code: string;
  acquisition: AcquisitionData;
}

export function generateGoogleAdsProtocol(): string {
  const bytes = randomBytes(5);
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
    .select('id, code, click_id, click_id_type, campaign_id')
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
  return {
    id: data.id as string,
    code: data.code as string,
    acquisition: {
      source: 'Google',
      sourceId: (data.campaign_id as string | null) ?? null,
      campaign: (data.campaign_id as string | null) ?? null,
      gclid: (data.click_id as string | null) ?? null,
      clickIdType,
    },
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
