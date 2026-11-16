import { describe, expect, it } from 'vitest';
import { parseUazapiReceipt } from './uazapi-receipts';

const base = {
  EventType: 'messages_update',
  owner: '5521995641438',
  state: 'Read',
  event: { Type: 'Read', IsFromMe: false, IsGroup: false, MessageIDs: ['3EB0AA'] },
};

describe('parseUazapiReceipt', () => {
  it('maps a customer read receipt to both stored id forms', () => {
    expect(parseUazapiReceipt(base)).toEqual({
      status: 'read',
      messageIds: ['3EB0AA', '5521995641438:3EB0AA'],
    });
  });

  it('maps Delivered and Played', () => {
    expect(parseUazapiReceipt({ ...base, event: { ...base.event, Type: 'Delivered' } })?.status).toBe('delivered');
    expect(parseUazapiReceipt({ ...base, event: { ...base.event, Type: 'Played' } })?.status).toBe('read');
  });

  it('falls back to top-level state when Type is empty', () => {
    expect(
      parseUazapiReceipt({ ...base, state: 'Delivered', event: { ...base.event, Type: '' } })?.status,
    ).toBe('delivered');
  });

  it('ignores our own device reading the customer messages', () => {
    expect(parseUazapiReceipt({ ...base, event: { ...base.event, IsFromMe: true } })).toBeNull();
  });

  it('ignores groups, other events, unknown states and empty id lists', () => {
    expect(parseUazapiReceipt({ ...base, event: { ...base.event, IsGroup: true } })).toBeNull();
    expect(parseUazapiReceipt({ ...base, EventType: 'messages' })).toBeNull();
    expect(parseUazapiReceipt({ ...base, state: 'x', event: { ...base.event, Type: 'Retry' } })).toBeNull();
    expect(parseUazapiReceipt({ ...base, event: { ...base.event, MessageIDs: [] } })).toBeNull();
  });
});
