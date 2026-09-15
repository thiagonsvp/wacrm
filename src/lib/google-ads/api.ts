export const GOOGLE_ADS_API_VERSION = 'v25';

export type GoogleClickIdType = 'gclid' | 'gbraid' | 'wbraid';
export type GoogleConversionName = 'QualifiedLead' | 'Purchase';

export interface GoogleAdsCredentials {
  customerId: string;
  loginCustomerId?: string | null;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken?: string | null;
}

export interface GoogleClickConversion {
  clickIdType: GoogleClickIdType;
  clickId: string;
  conversionActionId: string;
  conversionDateTime: Date;
  orderId: string;
  value: number;
  currency: string;
}

export interface GoogleAdsResult {
  ok: boolean;
  error?: string;
}

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

function errorText(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const root = payload as Record<string, unknown>;
  const error = root.error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const errorRecord = error as Record<string, unknown>;
    const details = errorRecord.details;
    if (Array.isArray(details)) {
      for (const detail of details) {
        if (!detail || typeof detail !== 'object') continue;
        const errors = (detail as Record<string, unknown>).errors;
        if (!Array.isArray(errors)) continue;
        for (const item of errors) {
          if (!item || typeof item !== 'object') continue;
          const itemRecord = item as Record<string, unknown>;
          const detailMessage = itemRecord.message;
          const errorCode = itemRecord.errorCode;
          if (typeof detailMessage === 'string') {
            const code =
              errorCode && typeof errorCode === 'object'
                ? Object.values(errorCode as Record<string, unknown>).find(
                    (value): value is string => typeof value === 'string'
                  )
                : undefined;
            return code ? `${code}: ${detailMessage}` : detailMessage;
          }
        }
      }
    }
    const message = errorRecord.message;
    if (typeof message === 'string') return message;
  }
  const partial = root.partialFailureError;
  if (partial && typeof partial === 'object') {
    const message = (partial as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

async function accessToken(
  config: GoogleAdsCredentials
): Promise<GoogleAdsResult & { token?: string }> {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok || typeof payload.access_token !== 'string') {
      return {
        ok: false,
        error: errorText(payload, `OAuth returned HTTP ${response.status}`),
      };
    }
    return { ok: true, token: payload.access_token };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function headers(
  config: GoogleAdsCredentials,
  token: string
): Record<string, string> {
  const result: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  // Developer tokens became optional in September 2026. Keep sending one
  // when supplied so deployments that have not completed the migration keep
  // working; current servers safely ignore it.
  if (config.developerToken) result['developer-token'] = config.developerToken;
  if (config.loginCustomerId)
    result['login-customer-id'] = digits(config.loginCustomerId);
  return result;
}

/** Read-only connectivity check; it never creates a conversion. */
export async function testGoogleAdsConnection(
  config: GoogleAdsCredentials
): Promise<GoogleAdsResult> {
  const auth = await accessToken(config);
  if (!auth.ok || !auth.token) return auth;
  const customerId = digits(config.customerId);
  try {
    const response = await fetch(
      `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:search`,
      {
        method: 'POST',
        headers: headers(config, auth.token),
        body: JSON.stringify({
          query:
            'SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1',
        }),
      }
    );
    const payload = await response.json().catch(() => ({}));
    return response.ok
      ? { ok: true }
      : {
          ok: false,
          error: errorText(
            payload,
            `Google Ads returned HTTP ${response.status}`
          ),
        };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function googleDateTime(date: Date): string {
  return date
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '+00:00');
}

export async function uploadGoogleClickConversion(
  event: GoogleClickConversion,
  config: GoogleAdsCredentials
): Promise<GoogleAdsResult> {
  const auth = await accessToken(config);
  if (!auth.ok || !auth.token) return auth;
  const customerId = digits(config.customerId);
  const conversion = {
    [event.clickIdType]: event.clickId,
    conversionAction: `customers/${customerId}/conversionActions/${digits(event.conversionActionId)}`,
    conversionDateTime: googleDateTime(event.conversionDateTime),
    conversionValue: event.value,
    currencyCode: event.currency,
    orderId: event.orderId,
  };

  try {
    const response = await fetch(
      `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}:uploadClickConversions`,
      {
        method: 'POST',
        headers: headers(config, auth.token),
        body: JSON.stringify({
          conversions: [conversion],
          partialFailure: true,
        }),
      }
    );
    const payload = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      return {
        ok: false,
        error: errorText(
          payload,
          `Google Ads returned HTTP ${response.status}`
        ),
      };
    }
    if (payload.partialFailureError) {
      return {
        ok: false,
        error: errorText(payload, 'Google Ads rejected the conversion'),
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
