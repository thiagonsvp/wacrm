import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GOOGLE_ADS_API_VERSION,
  testGoogleAdsConnection,
  uploadGoogleClickConversion,
} from './api';

const CONFIG = {
  customerId: '123-456-7890',
  loginCustomerId: '999-888-7777',
  clientId: 'client.apps.googleusercontent.com',
  clientSecret: 'secret',
  refreshToken: 'refresh',
  developerToken: 'developer',
};

afterEach(() => vi.restoreAllMocks());

describe('Google Ads API', () => {
  it('refreshes OAuth and uploads the correct click-id field', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'access' }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{}] }), { status: 200 })
      );

    const result = await uploadGoogleClickConversion(
      {
        clickIdType: 'gbraid',
        clickId: 'GBRAID-1',
        conversionActionId: '444555666',
        conversionDateTime: new Date('2026-09-15T12:00:00Z'),
        orderId: 'deal:QualifiedLead',
        value: 0,
        currency: 'BRL',
      },
      CONFIG
    );

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, options] = fetchMock.mock.calls[1];
    expect(url).toBe(
      `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/1234567890:uploadClickConversions`
    );
    expect(options?.headers).toMatchObject({
      Authorization: 'Bearer access',
      'developer-token': 'developer',
      'login-customer-id': '9998887777',
    });
    expect(JSON.parse(String(options?.body))).toMatchObject({
      partialFailure: true,
      conversions: [
        {
          gbraid: 'GBRAID-1',
          conversionAction: 'customers/1234567890/conversionActions/444555666',
        conversionDateTime: '2026-09-15 12:00:00+00:00',
          orderId: 'deal:QualifiedLead',
        },
      ],
    });
  });

  it('surfaces a partial failure returned with HTTP 200', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'access' }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            partialFailureError: { message: 'Click not found' },
          }),
          { status: 200 }
        )
      );
    const result = await uploadGoogleClickConversion(
      {
        clickIdType: 'gclid',
        clickId: 'bad',
        conversionActionId: '1',
        conversionDateTime: new Date(),
        orderId: 'one',
        value: 1,
        currency: 'BRL',
      },
      CONFIG
    );
    expect(result).toEqual({ ok: false, error: 'Click not found' });
  });

  it('tests connectivity with a read-only customer query', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'access' }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [] }), { status: 200 })
      );
    expect(await testGoogleAdsConnection(CONFIG)).toEqual({ ok: true });
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      '/customers/1234567890/googleAds:search'
    );
  });
});
