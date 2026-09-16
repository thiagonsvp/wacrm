import { describe, expect, it } from 'vitest';
import { parseWebsiteOrigins, serializeWebsiteOrigins } from './origins';

describe('Google Ads website origins', () => {
  it('normalizes multiple pages to unique HTTPS origins', () => {
    const result = parseWebsiteOrigins(`
      https://example.com/
      https://example.com/lp/google
      https://lp.example.com/oferta?utm_source=test
    `);

    expect(result).toEqual({
      origins: ['https://example.com', 'https://lp.example.com'],
      invalid: [],
    });
    expect(serializeWebsiteOrigins(result.origins)).toBe(
      'https://example.com\nhttps://lp.example.com'
    );
  });

  it('accepts comma-separated values and reports unsafe URLs', () => {
    expect(
      parseWebsiteOrigins(
        'https://one.example, http://unsafe.example; http://localhost:3000'
      )
    ).toEqual({
      origins: ['https://one.example', 'http://localhost:3000'],
      invalid: ['http://unsafe.example'],
    });
  });
});
