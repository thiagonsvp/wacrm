import { afterEach, describe, expect, it } from 'vitest';

import { canonicalizeCrmBaseUrl, publicBaseUrl } from './public-url';

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
});

describe('public CRM URL', () => {
  it('replaces the legacy Vercel domain with the canonical CRM domain', () => {
    expect(canonicalizeCrmBaseUrl('https://wacrm-eight-pi.vercel.app/')).toBe(
      'https://crm.natividadedigital.com.br'
    );
  });

  it('also replaces a stale configured legacy domain', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://wacrm-eight-pi.vercel.app';
    expect(publicBaseUrl(new Request('https://internal.vercel.app/path'))).toBe(
      'https://crm.natividadedigital.com.br'
    );
  });

  it('replaces a legacy forwarded host when no environment value exists', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const request = new Request('http://internal.local/path', {
      headers: {
        'x-forwarded-host': 'wacrm-eight-pi.vercel.app',
        'x-forwarded-proto': 'https',
      },
    });
    expect(publicBaseUrl(request)).toBe('https://crm.natividadedigital.com.br');
  });

  it('does not trust an arbitrary forwarded host in production', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const request = new Request('http://internal.local/path', {
      headers: {
        'x-forwarded-host': 'attacker.example',
        'x-forwarded-proto': 'https',
      },
    });
    expect(publicBaseUrl(request)).toBe('https://crm.natividadedigital.com.br');
  });

  it('preserves an explicitly configured non-legacy host', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://staging.example.org/';
    expect(publicBaseUrl(new Request('http://internal.local/path'))).toBe(
      'https://staging.example.org'
    );
  });
});
