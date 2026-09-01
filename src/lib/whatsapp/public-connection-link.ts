import { ForbiddenError } from '@/lib/auth/account';
import { whatsappAdminClient } from './admin-client';
import {
  hashConnectionLinkToken,
  isConnectionLinkToken,
} from './connection-links';
import { getUazapiServer, requireOwnedInstance } from './uazapi-admin';

interface LinkRow {
  id: string;
  account_id: string;
  instance_id: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

export type ResolvedConnectionLink =
  | { ok: true; row: LinkRow; baseUrl: string; instanceToken: string }
  | {
      ok: false;
      state: 'invalid' | 'expired' | 'connected' | 'temporary_error';
      status: 404 | 410 | 503;
    };

export async function resolveConnectionLink(
  token: string
): Promise<ResolvedConnectionLink> {
  if (!isConnectionLinkToken(token))
    return { ok: false, state: 'invalid', status: 404 };

  const admin = whatsappAdminClient();
  const { data, error } = await admin
    .from('whatsapp_connection_links')
    .select('id, account_id, instance_id, expires_at, used_at, revoked_at')
    .eq('token_hash', hashConnectionLinkToken(token))
    .maybeSingle();

  if (error) {
    console.error('[whatsapp-link] lookup failed:', error);
    return { ok: false, state: 'temporary_error', status: 503 };
  }
  const row = data as LinkRow | null;
  if (!row || row.revoked_at)
    return { ok: false, state: 'invalid', status: 404 };
  if (row.used_at) return { ok: false, state: 'connected', status: 410 };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, state: 'expired', status: 410 };
  }

  const { data: account, error: accountError } = await admin
    .from('accounts')
    .select('is_active')
    .eq('id', row.account_id)
    .maybeSingle();
  if (accountError) return { ok: false, state: 'temporary_error', status: 503 };
  if (!account?.is_active) return { ok: false, state: 'invalid', status: 404 };

  const server = getUazapiServer();
  if (!server) return { ok: false, state: 'temporary_error', status: 503 };

  try {
    const instance = await requireOwnedInstance(
      server,
      row.account_id,
      row.instance_id
    );
    return {
      ok: true,
      row,
      baseUrl: server.baseUrl,
      instanceToken: instance.token,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      await admin
        .from('whatsapp_connection_links')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', row.id)
        .is('revoked_at', null);
      return { ok: false, state: 'invalid', status: 404 };
    }
    return { ok: false, state: 'temporary_error', status: 503 };
  }
}

export async function consumeConnectionLink(row: LinkRow): Promise<void> {
  const now = new Date().toISOString();
  const admin = whatsappAdminClient();
  const { error } = await admin
    .from('whatsapp_connection_links')
    .update({ used_at: now })
    .eq('id', row.id)
    .is('used_at', null)
    .is('revoked_at', null)
    .gt('expires_at', now);
  if (error) throw new Error('Could not consume WhatsApp connection link');

  const { data: config } = await admin
    .from('whatsapp_config')
    .select('id, status')
    .eq('account_id', row.account_id)
    .eq('uazapi_instance_id', row.instance_id)
    .maybeSingle();
  if (config && config.status !== 'connected') {
    await admin
      .from('whatsapp_config')
      .update({ status: 'connected', connected_at: now })
      .eq('id', config.id);
  }
}
