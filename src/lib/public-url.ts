const CANONICAL_CRM_URL = 'https://crm.natividadedigital.com.br';

const LEGACY_CRM_HOSTS = new Set([
  'wacrm-eight-pi.vercel.app',
  'crm.example.com',
  'wacrm.tech',
]);

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Rewrites known legacy CRM hosts to the canonical Natividade domain. */
export function canonicalizeCrmBaseUrl(value: string): string {
  const normalized = withoutTrailingSlash(value.trim());
  try {
    const url = new URL(normalized);
    return LEGACY_CRM_HOSTS.has(url.hostname.toLowerCase())
      ? CANONICAL_CRM_URL
      : normalized;
  } catch {
    return CANONICAL_CRM_URL;
  }
}

/** Single source of truth for every public link emitted by the CRM. */
export function publicBaseUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return canonicalizeCrmBaseUrl(configured);

  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    ?.trim();
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim();
  if (forwardedHost) {
    const forwardedUrl = new URL(
      `${forwardedProto || 'https'}://${forwardedHost}`
    );
    if (
      forwardedUrl.hostname === 'localhost' ||
      forwardedUrl.hostname === '127.0.0.1'
    ) {
      return withoutTrailingSlash(forwardedUrl.origin);
    }
    return CANONICAL_CRM_URL;
  }

  const requestUrl = new URL(request.url);
  if (
    requestUrl.hostname === 'localhost' ||
    requestUrl.hostname === '127.0.0.1'
  ) {
    return withoutTrailingSlash(requestUrl.origin);
  }
  return CANONICAL_CRM_URL;
}
