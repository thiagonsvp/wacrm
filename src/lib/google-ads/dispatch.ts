import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  uploadGoogleClickConversion,
  type GoogleAdsCredentials,
  type GoogleClickIdType,
  type GoogleConversionName,
} from './api';

interface ConfigRow {
  customer_id: string;
  login_customer_id: string | null;
  client_id: string;
  client_secret: string;
  refresh_token: string;
  developer_token: string | null;
  qualified_lead_conversion_action_id: string | null;
  purchase_conversion_action_id: string | null;
  is_active: boolean;
  send_qualified_lead: boolean;
  send_purchase: boolean;
}

interface LoadedConfig extends GoogleAdsCredentials {
  qualifiedLeadActionId: string | null;
  purchaseActionId: string | null;
  sendQualifiedLead: boolean;
  sendPurchase: boolean;
}

async function loadConfig(
  db: SupabaseClient,
  accountId: string
): Promise<LoadedConfig | null> {
  const { data, error } = await db
    .from('google_ads_configs')
    .select(
      'customer_id, login_customer_id, client_id, client_secret, refresh_token, developer_token, qualified_lead_conversion_action_id, purchase_conversion_action_id, is_active, send_qualified_lead, send_purchase'
    )
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    if (error.code !== '42P01')
      console.error('[google ads] config read failed:', error);
    return null;
  }
  if (!data) return null;
  const row = data as unknown as ConfigRow;
  if (!row.is_active) return null;
  try {
    return {
      customerId: row.customer_id,
      loginCustomerId: row.login_customer_id,
      clientId: row.client_id,
      clientSecret: decrypt(row.client_secret),
      refreshToken: decrypt(row.refresh_token),
      developerToken: row.developer_token ? decrypt(row.developer_token) : null,
      qualifiedLeadActionId: row.qualified_lead_conversion_action_id,
      purchaseActionId: row.purchase_conversion_action_id,
      sendQualifiedLead: row.send_qualified_lead,
      sendPurchase: row.send_purchase,
    };
  } catch {
    console.error(
      `[google ads] credentials for account ${accountId} could not be decrypted`
    );
    return null;
  }
}

export interface GoogleDealConversionArgs {
  accountId: string;
  dealId: string;
  contactId: string;
  qualified: boolean;
  won: boolean;
  value: number | null;
  currency: string | null;
}

/** Best-effort dispatcher: an Ads outage must never undo a CRM write. */
export async function dispatchGoogleDealConversions(
  db: SupabaseClient,
  args: GoogleDealConversionArgs
): Promise<void> {
  try {
    const config = await loadConfig(db, args.accountId);
    if (!config) return;

    const wanted: Array<{ name: GoogleConversionName; actionId: string }> = [];
    if (
      args.qualified &&
      config.sendQualifiedLead &&
      config.qualifiedLeadActionId
    ) {
      wanted.push({
        name: 'QualifiedLead',
        actionId: config.qualifiedLeadActionId,
      });
    }
    if (args.won && config.sendPurchase && config.purchaseActionId) {
      wanted.push({ name: 'Purchase', actionId: config.purchaseActionId });
    }
    if (!wanted.length) return;

    const { data: contact } = await db
      .from('contacts')
      .select('acquisition_gclid, acquisition_click_id_type')
      .eq('id', args.contactId)
      .eq('account_id', args.accountId)
      .maybeSingle();
    const clickId = contact?.acquisition_gclid as string | null | undefined;
    if (!clickId) return;
    const rawType = contact?.acquisition_click_id_type as
      string | null | undefined;
    const clickIdType: GoogleClickIdType =
      rawType === 'gbraid' || rawType === 'wbraid' ? rawType : 'gclid';

    const { data: settled } = await db
      .from('google_ads_conversion_events')
      .select('event_name')
      .eq('deal_id', args.dealId)
      .eq('status', 'sent');
    const sent = new Set(
      (settled ?? []).map((row) => row.event_name as string)
    );

    for (const event of wanted) {
      if (sent.has(event.name)) continue;
      if (event.name === 'Purchase' && !(args.value != null && args.value > 0))
        continue;
      const orderId = `${args.dealId}:${event.name}`;
      const result = await uploadGoogleClickConversion(
        {
          clickIdType,
          clickId,
          conversionActionId: event.actionId,
          conversionDateTime: new Date(),
          orderId,
          value: event.name === 'Purchase' ? (args.value as number) : 0,
          currency: event.name === 'Purchase' ? args.currency || 'BRL' : 'BRL',
        },
        config
      );
      const { error } = await db.from('google_ads_conversion_events').insert({
        account_id: args.accountId,
        deal_id: args.dealId,
        contact_id: args.contactId,
        event_name: event.name,
        order_id: orderId,
        click_id_type: clickIdType,
        click_id: clickId,
        value: event.name === 'Purchase' ? args.value : 0,
        currency: event.name === 'Purchase' ? args.currency || 'BRL' : 'BRL',
        status: result.ok ? 'sent' : 'failed',
        error_message: result.ok
          ? null
          : (result.error || 'unknown error').slice(0, 500),
      });
      if (error && error.code !== '23505')
        console.error('[google ads] ledger insert failed:', error);
    }
  } catch (error) {
    console.error('[google ads] dispatch failed:', error);
  }
}
