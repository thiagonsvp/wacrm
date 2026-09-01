import { createHash, randomBytes } from 'node:crypto';

export const CONNECTION_LINK_LIFETIME_MS = 10 * 60 * 1000;

export interface GeneratedConnectionLinkToken {
  token: string;
  hash: string;
}

export function hashConnectionLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateConnectionLinkToken(): GeneratedConnectionLinkToken {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashConnectionLinkToken(token) };
}

export function connectionLinkExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + CONNECTION_LINK_LIFETIME_MS);
}

export function connectionLinkUrl(token: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/connect-whatsapp/${token}`;
}

export function isConnectionLinkToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function connectionLinkClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  );
}
