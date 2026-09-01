import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveConnectionLink: vi.fn(),
  consumeConnectionLink: vi.fn(),
  getInstanceStatus: vi.fn(),
  connectInstance: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { whatsappLinkQr: { limit: 6, windowMs: 60_000 } },
  checkRateLimit: vi.fn(() => ({
    success: true,
    remaining: 5,
    reset: Date.now() + 60_000,
    limit: 6,
  })),
  rateLimitResponse: vi.fn(),
}));

vi.mock('@/lib/whatsapp/connection-links', () => ({
  connectionLinkClientIp: vi.fn(() => '127.0.0.1'),
  hashConnectionLinkToken: vi.fn(() => 'a'.repeat(64)),
}));

vi.mock('@/lib/whatsapp/public-connection-link', () => ({
  resolveConnectionLink: mocks.resolveConnectionLink,
  consumeConnectionLink: mocks.consumeConnectionLink,
}));

vi.mock('@/lib/whatsapp/providers/uazapi', () => ({
  getInstanceStatus: mocks.getInstanceStatus,
  connectInstance: mocks.connectInstance,
}));

import { POST } from './route';

const row = {
  id: 'link-1',
  account_id: 'account-secret',
  instance_id: 'instance-secret',
  expires_at: '2026-09-01T18:10:00.000Z',
  used_at: null,
  revoked_at: null,
};

function callRoute() {
  return POST(
    new Request(
      `http://localhost/api/public/whatsapp-connect/${'a'.repeat(43)}/qr`,
      { method: 'POST' }
    ),
    {
      params: Promise.resolve({ token: 'a'.repeat(43) }),
    }
  );
}

describe('POST temporary WhatsApp connection QR', () => {
  beforeEach(() => {
    mocks.resolveConnectionLink.mockResolvedValue({
      ok: true,
      row,
      baseUrl: 'https://uazapi.internal',
      instanceToken: 'uazapi-secret',
    });
    mocks.getInstanceStatus.mockResolvedValue({ connected: false });
    mocks.connectInstance.mockResolvedValue({
      qrcode: 'data:image/png;base64,abc',
      paircode: '12345678',
    });
  });

  it('does not call UAZAPI for an invalid or expired bearer link', async () => {
    mocks.resolveConnectionLink.mockResolvedValue({
      ok: false,
      state: 'invalid',
      status: 404,
    });
    const response = await callRoute();
    expect(response.status).toBe(404);
    expect(mocks.connectInstance).not.toHaveBeenCalled();
  });

  it('returns only the QR allow-list and never serializes backend credentials', async () => {
    const response = await callRoute();
    const body = await response.json();
    expect(body).toEqual({
      state: 'waiting',
      qrCode: 'data:image/png;base64,abc',
      pairCode: '12345678',
      expiresAt: row.expires_at,
    });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('consumes the link only after status confirms a connection', async () => {
    mocks.getInstanceStatus.mockResolvedValue({ connected: true });
    const response = await callRoute();
    expect(await response.json()).toEqual({ state: 'connected' });
    expect(mocks.consumeConnectionLink).toHaveBeenCalledWith(row);
    expect(mocks.connectInstance).not.toHaveBeenCalled();
  });

  it('does not assume that a missing QR means connected', async () => {
    mocks.connectInstance.mockResolvedValue({});
    const response = await callRoute();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ state: 'temporary_error' });
    expect(mocks.consumeConnectionLink).not.toHaveBeenCalled();
  });
});
