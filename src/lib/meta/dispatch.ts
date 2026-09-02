import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  sendMetaCapiEvent,
  type MetaCapiConfig,
  type MetaEventName,
} from './capi';

// ------------------------------------------------------------
// Turn a pipeline outcome into a Meta conversion.
//
// Called right after the AI pipeline writes a deal. Owns its try/catch
// and NEVER throws: a failing ad-platform call must not disturb the
// inbound webhook, and it must never cost the CRM a deal write that
// already succeeded.
// ------------------------------------------------------------

interface MetaCapiRow {
  dataset_id: string;
  access_token: string;
  waba_id: string | null;
  page_id: string | null;
  require_purchase_approval: boolean | null;
  test_event_code: string | null;
  is_active: boolean;
  send_qualified_lead: boolean;
  send_purchase: boolean;
}

export interface LoadedMetaCapiConfig extends MetaCapiConfig {
  sendQualifiedLead: boolean;
  sendPurchase: boolean;
  /** Hold Purchase events for a human instead of sending them. */
  requirePurchaseApproval: boolean;
}

/**
 * Load and decrypt the account's Conversions API setup, or null when it
 * is absent or switched off. Returns null (rather than throwing) on a
 * token that cannot be decrypted — a broken ad integration must not take
 * down the pipeline that produced the deal.
 */
export async function loadMetaCapiConfig(
  db: SupabaseClient,
  accountId: string
): Promise<LoadedMetaCapiConfig | null> {
  const { data, error } = await db
    .from('meta_capi_configs')
    .select(
      'dataset_id, access_token, waba_id, page_id, require_purchase_approval, ' +
        'test_event_code, is_active, send_qualified_lead, send_purchase'
    )
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    // 42P01 = table missing, i.e. migration 043 not applied here yet.
    if (error.code === '42P01') {
      console.warn(
        '[meta capi] supabase/migrations/043_meta_capi_and_tenant_config.sql has not ' +
          'been applied — conversions stay off until it is.'
      );
      return null;
    }
    console.error('[meta capi] config read failed:', error);
    return null;
  }
  if (!data) return null;

  const row = data as unknown as MetaCapiRow;
  if (!row.is_active || !row.dataset_id || !row.access_token) return null;

  let accessToken: string;
  try {
    accessToken = decrypt(row.access_token);
  } catch {
    console.error(
      `[meta capi] access token for account ${accountId} could not be decrypted — ` +
        'check ENCRYPTION_KEY; re-enter the token in Settings.'
    );
    return null;
  }

  return {
    datasetId: row.dataset_id,
    accessToken,
    wabaId: row.waba_id,
    pageId: row.page_id,
    testEventCode: row.test_event_code,
    sendQualifiedLead: row.send_qualified_lead,
    sendPurchase: row.send_purchase,
    // Default ON when the column predates migration 051: an operator who
    // has not opted in should under-report, never over-report.
    requirePurchaseApproval: row.require_purchase_approval !== false,
  };
}

export interface DealConversionArgs {
  accountId: string;
  dealId: string;
  contactId: string;
  /** Fire QualifiedLead — the deal exists at qualified-or-beyond. */
  qualified: boolean;
  /** Fire Purchase — the deal is closed-won. */
  won: boolean;
  value: number | null;
  currency: string | null;
}

/**
 * Send the conversions implied by a deal's current state.
 *
 * Both events are attempted every time; `meta_capi_events` is what makes
 * them fire once. That is deliberate — deriving "did this just change?"
 * from the transition would silently miss a deal whose first send failed,
 * whereas a ledger lookup is cheap and self-healing.
 */
export async function dispatchDealConversions(
  db: SupabaseClient,
  args: DealConversionArgs
): Promise<void> {
  try {
    const config = await loadMetaCapiConfig(db, args.accountId);
    if (!config) return;

    const wanted: MetaEventName[] = [];
    if (args.qualified && config.sendQualifiedLead)
      wanted.push('QualifiedLead');
    if (args.won && config.sendPurchase) wanted.push('Purchase');
    if (wanted.length === 0) return;

    // The click id is the whole point; without it Meta accepts the event
    // and attributes it to nothing.
    const { data: contact } = await db
      .from('contacts')
      .select('phone, acquisition_ctwa_clid')
      .eq('id', args.contactId)
      .eq('account_id', args.accountId)
      .maybeSingle();

    const ctwaClid = contact?.acquisition_ctwa_clid as
      string | null | undefined;
    if (!ctwaClid) return; // organic lead — nothing to attribute to an ad

    // 'sent' is final and 'rejected' is a human's no — both stop a resend.
    // 'pending' means it is already waiting in the approval queue.
    const { data: already } = await db
      .from('meta_capi_events')
      .select('event_name, status')
      .eq('deal_id', args.dealId)
      .in('status', ['sent', 'pending', 'rejected']);
    const settled = new Set((already ?? []).map((r) => r.event_name as string));

    for (const eventName of wanted) {
      if (settled.has(eventName)) continue;

      // A won deal whose price is not recorded yet cannot be reported —
      // Meta rejects a Purchase with no value/currency. Skip without
      // writing a ledger row: this is a "not ready" state, not a failure,
      // and recording it every pass would bury the real errors. The sweep
      // in /api/meta/capi/backfill picks it up once the amount lands.
      if (eventName === 'Purchase' && !(args.value != null && args.value > 0)) {
        console.warn(
          `[meta capi] Purchase for deal ${args.dealId} deferred — no amount recorded yet`
        );
        continue;
      }

      const eventId = `${args.dealId}:${eventName}`;

      // Money waits for a human. A conversion cannot be recalled, and the
      // AI has been wrong about "won" — a bare "Ok" after a closing pitch
      // once produced a R$7.400 sale that never happened. Queue it and let
      // someone who knows the customer decide. QualifiedLead is never held:
      // it carries no amount and runs often enough that a queue would just
      // get rubber-stamped.
      if (eventName === 'Purchase' && config.requirePurchaseApproval) {
        const { error: queueErr } = await db.from('meta_capi_events').insert({
          account_id: args.accountId,
          deal_id: args.dealId,
          contact_id: args.contactId,
          event_name: eventName,
          event_id: eventId,
          value: args.value,
          currency: 'BRL',
          status: 'pending',
        });
        if (queueErr && queueErr.code !== '23505') {
          console.error(
            '[meta capi] could not queue Purchase for review:',
            queueErr
          );
        }
        console.log(
          `[meta capi] Purchase for deal ${args.dealId}: awaiting approval`
        );
        continue;
      }

      const result = await sendMetaCapiEvent(
        {
          eventName,
          eventId,
          eventTime: new Date(),
          ctwaClid,
          phone: (contact?.phone as string | null) ?? null,
          // Only a purchase carries money; a qualified lead has no
          // realised value yet.
          value: eventName === 'Purchase' ? args.value : null,
          currency: eventName === 'Purchase' ? 'BRL' : null,
        },
        config
      );

      const { error: ledgerErr } = await db.from('meta_capi_events').insert({
        account_id: args.accountId,
        deal_id: args.dealId,
        contact_id: args.contactId,
        event_name: eventName,
        event_id: eventId,
        value: eventName === 'Purchase' ? args.value : null,
        currency: eventName === 'Purchase' ? 'BRL' : null,
        status: result.ok ? 'sent' : 'failed',
        error_message: result.ok
          ? null
          : (result.error ?? 'unknown error').slice(0, 500),
      });
      // 23505 = the partial unique index caught a concurrent send. That
      // is the guard working, not an error worth surfacing.
      if (ledgerErr && ledgerErr.code !== '23505') {
        console.error('[meta capi] ledger insert failed:', ledgerErr);
      }

      console.log(
        `[meta capi] ${eventName} for deal ${args.dealId}: ` +
          (result.ok ? 'sent' : `FAILED — ${result.error}`)
      );
    }
  } catch (err) {
    console.error('[meta capi] dispatch failed:', err);
  }
}
