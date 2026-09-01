import { describe, expect, it } from 'vitest';

import {
  CONNECTION_LINK_LIFETIME_MS,
  connectionLinkExpiresAt,
  connectionLinkUrl,
  generateConnectionLinkToken,
  hashConnectionLinkToken,
  isConnectionLinkToken,
} from './connection-links';

describe('temporary WhatsApp connection links', () => {
  it('generates a URL-safe 256-bit token and stores only its deterministic hash', () => {
    const generated = generateConnectionLinkToken();
    expect(generated.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generated.hash).toBe(hashConnectionLinkToken(generated.token));
    expect(generated.hash).not.toContain(generated.token);
  });

  it('expires after ten minutes', () => {
    const now = new Date('2026-09-01T12:00:00.000Z');
    expect(connectionLinkExpiresAt(now).getTime() - now.getTime()).toBe(
      CONNECTION_LINK_LIFETIME_MS
    );
  });

  it('builds the public path and validates token shape', () => {
    const token = 'a'.repeat(43);
    expect(connectionLinkUrl(token, 'https://crm.example/')).toBe(
      `https://crm.example/connect-whatsapp/${token}`
    );
    expect(isConnectionLinkToken(token)).toBe(true);
    expect(isConnectionLinkToken('short')).toBe(false);
  });
});
