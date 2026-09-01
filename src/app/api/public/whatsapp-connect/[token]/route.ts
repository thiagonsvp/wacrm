import { NextResponse } from 'next/server';

import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  connectionLinkClientIp,
  hashConnectionLinkToken,
} from '@/lib/whatsapp/connection-links';
import {
  consumeConnectionLink,
  resolveConnectionLink,
} from '@/lib/whatsapp/public-connection-link';
import { getInstanceStatus } from '@/lib/whatsapp/providers/uazapi';

const NO_STORE = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const key = hashConnectionLinkToken(token || '').slice(0, 16);
  const limit = checkRateLimit(
    `whatsappLink:status:${connectionLinkClientIp(request)}:${key}`,
    RATE_LIMITS.whatsappLinkStatus
  );
  if (!limit.success) return rateLimitResponse(limit);

  const resolved = await resolveConnectionLink(token);
  if (!resolved.ok) {
    if (resolved.state === 'connected') {
      return NextResponse.json({ state: 'connected' }, { headers: NO_STORE });
    }
    return NextResponse.json(
      { state: resolved.state },
      { status: resolved.status, headers: NO_STORE }
    );
  }

  try {
    const status = await getInstanceStatus({
      baseUrl: resolved.baseUrl,
      token: resolved.instanceToken,
    });
    if (status.connected) {
      await consumeConnectionLink(resolved.row);
      return NextResponse.json({ state: 'connected' }, { headers: NO_STORE });
    }
    return NextResponse.json(
      { state: 'waiting', expiresAt: resolved.row.expires_at },
      { headers: NO_STORE }
    );
  } catch {
    return NextResponse.json(
      { state: 'temporary_error' },
      { status: 502, headers: NO_STORE }
    );
  }
}
