import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  connectionLinkExpiresAt,
  connectionLinkUrl,
  generateConnectionLinkToken,
  publicBaseUrl,
} from '@/lib/whatsapp/connection-links';
import {
  getUazapiServer,
  requireOwnedInstance,
} from '@/lib/whatsapp/uazapi-admin';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(
      `admin:whatsappLink:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const server = getUazapiServer();
    if (!server)
      return NextResponse.json(
        { error: 'uazapi_not_configured' },
        { status: 503 }
      );
    await requireOwnedInstance(server, ctx.accountId, id);

    const { token, hash } = generateConnectionLinkToken();
    const expiresAt = connectionLinkExpiresAt();
    const { data, error } = await ctx.supabase.rpc(
      'issue_whatsapp_connection_link',
      {
        p_account_id: ctx.accountId,
        p_instance_id: id,
        p_token_hash: hash,
      }
    );

    if (error || !Array.isArray(data) || !data[0]) {
      console.error('[uazapi/connection-link] failed to issue link:', error);
      return NextResponse.json(
        { error: 'link_create_failed' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        url: connectionLinkUrl(token, publicBaseUrl(request)),
        expiresAt: data[0].expires_at ?? expiresAt.toISOString(),
        expiresInMinutes: 10,
      },
      {
        status: 201,
        headers: { 'Cache-Control': 'private, no-store, max-age=0' },
      }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
