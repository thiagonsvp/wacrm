/**
 * UAZAPI delivery/read receipts (`EventType: 'messages_update'`).
 *
 * Shape confirmed against captured production traffic:
 *   { EventType: 'messages_update', type: 'ReadReceipt', state: 'Read',
 *     owner: '5521…', event: { Type: 'Read', IsFromMe: false,
 *     IsGroup: false, MessageIDs: ['3EB0…', …] } }
 *
 * `IsFromMe: true` receipts are our own linked device reading the
 * customer's messages — they say nothing about our outbound messages and
 * are ignored.
 */

export type ReceiptStatus = 'delivered' | 'read';

export interface UazapiReceiptPayload {
  EventType?: string;
  state?: string;
  owner?: string;
  event?: {
    Type?: string;
    IsFromMe?: boolean | string;
    IsGroup?: boolean | string;
    MessageIDs?: unknown;
  };
}

export interface ParsedReceipt {
  status: ReceiptStatus;
  /** Every stored form of the ids: bare and `owner:id` (CRM sends store the composite). */
  messageIds: string[];
}

const STATE_TO_STATUS: Record<string, ReceiptStatus> = {
  delivered: 'delivered',
  read: 'read',
  played: 'read',
};

/** Statuses a receipt may upgrade from — receipts only move forward. */
export const UPGRADABLE_FROM: Record<ReceiptStatus, string[]> = {
  delivered: ['sending', 'sent'],
  read: ['sending', 'sent', 'delivered'],
};

const truthy = (v: unknown) => v === true || v === 'true';

export function parseUazapiReceipt(body: UazapiReceiptPayload): ParsedReceipt | null {
  if (body?.EventType !== 'messages_update') return null;
  const ev = body.event;
  if (!ev || truthy(ev.IsFromMe) || truthy(ev.IsGroup)) return null;

  const state = (ev.Type || body.state || '').toLowerCase();
  const status = STATE_TO_STATUS[state];
  if (!status) return null;

  const ids = Array.isArray(ev.MessageIDs)
    ? ev.MessageIDs.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  if (ids.length === 0) return null;

  const owner = (body.owner || '').replace(/\D/g, '');
  const messageIds = owner ? ids.flatMap((id) => [id, `${owner}:${id}`]) : ids;
  return { status, messageIds };
}
