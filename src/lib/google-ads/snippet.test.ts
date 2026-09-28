import { describe, expect, it } from 'vitest';
import { googleLeadTrackingSnippet } from './snippet';

describe('googleLeadTrackingSnippet', () => {
  it('includes attribution persistence, form capture and WhatsApp decoration', () => {
    const code = googleLeadTrackingSnippet(
      'https://crm.example/api/google-ads/leads/token'
    );
    expect(code).toContain("'gclid','gbraid','wbraid'");
    expect(code).toContain('localStorage.setItem');
    expect(code).toContain("document.addEventListener('submit'");
    expect(code).toContain('keepalive: true');
    expect(code).toContain("url.searchParams.set('text'");
    expect(code).toContain('https://crm.example/api/google-ads/leads/token');
  });

  it('does not render a script before an endpoint exists', () => {
    expect(googleLeadTrackingSnippet('')).toBe('');
  });

  it('captures landing_url for every visit, not only paid clicks', () => {
    // Organic form submissions need a landing page to show in the CRM too,
    // so this must not be gated on gclid/gbraid/wbraid being present.
    const code = googleLeadTrackingSnippet(
      'https://crm.example/api/google-ads/leads/token'
    );
    expect(code).toContain(
      "if (!saved.landing_url) saved.landing_url = window.location.href;"
    );
  });

  it('without a redirect base, still tags the pre-filled text (old behavior)', () => {
    const code = googleLeadTrackingSnippet(
      'https://crm.example/api/google-ads/leads/token'
    );
    expect(code).toContain('var REDIRECT_BASE = "";');
    expect(code).toContain("url.searchParams.set('text', tracking + ' ' + current)");
  });

  it('with a redirect base, rewrites WhatsApp links to go through it instead of tagging the text', () => {
    const code = googleLeadTrackingSnippet(
      'https://crm.example/api/google-ads/leads/token',
      'https://crm.example/go/google-ads/token'
    );
    expect(code).toContain(
      'var REDIRECT_BASE = "https://crm.example/go/google-ads/token";'
    );
    expect(code).toContain('if (REDIRECT_BASE)');
    expect(code).toContain("redirect.searchParams.set(key, saved[key])");
  });
});
