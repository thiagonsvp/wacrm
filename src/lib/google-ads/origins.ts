export interface ParsedWebsiteOrigins {
  origins: string[];
  invalid: string[];
}

/**
 * Parse the website/LP allow-list stored in the legacy `website_url` column.
 *
 * Keeping the values newline-delimited lets existing installations gain
 * multi-domain support without a database migration. Full page URLs are
 * accepted for convenience, but only their origin is persisted and compared
 * during CORS checks.
 */
export function parseWebsiteOrigins(
  value: string | null
): ParsedWebsiteOrigins {
  const origins: string[] = [];
  const invalid: string[] = [];

  for (const raw of (value ?? '').split(/[\n,;]+/)) {
    const candidate = raw.trim();
    if (!candidate) continue;

    try {
      const url = new URL(candidate);
      const isLocalHttp =
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname);
      if (url.protocol !== 'https:' && !isLocalHttp) {
        invalid.push(candidate);
        continue;
      }
      if (!origins.includes(url.origin)) origins.push(url.origin);
    } catch {
      invalid.push(candidate);
    }
  }

  return { origins, invalid };
}

export function serializeWebsiteOrigins(origins: string[]): string {
  return origins.join('\n');
}
