import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { sendMetaCapiEvent } from '@/lib/meta/capi'

/**
 * Meta Conversions API credentials for the account.
 *
 * Same shape and discipline as /api/ai/config: any member may read
 * whether it is configured; only admin+ may write; the access token is
 * AES-256-GCM encrypted at rest and never returned to the client.
 */

const MISSING_TABLE = '42P01'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('meta_capi_configs')
      .select(
        'dataset_id, waba_id, page_id, test_event_code, is_active, send_qualified_lead, send_purchase, access_token',
      )
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      // Migration 043 not applied yet — report "not configured" rather
      // than 500, so the Setup page can still render and tell the
      // operator what to do.
      if (error.code === MISSING_TABLE) {
        return NextResponse.json({ configured: false, migration_pending: true })
      }
      console.error('[meta/capi/config GET] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load Meta configuration' },
        { status: 500 },
      )
    }
    if (!data) return NextResponse.json({ configured: false })

    const { access_token, ...safe } = data
    return NextResponse.json({
      configured: true,
      has_token: !!access_token,
      ...safe,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`meta-capi-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const datasetId = typeof body.dataset_id === 'string' ? body.dataset_id.trim() : ''
    if (!datasetId) return bad('dataset_id is required')
    if (!/^\d+$/.test(datasetId)) {
      return bad('dataset_id should be only digits — copy it from Events Manager.')
    }

    const wabaId = typeof body.waba_id === 'string' ? body.waba_id.trim() : ''
    const pageId = typeof body.page_id === 'string' ? body.page_id.trim() : ''
    if (pageId && !/^\d+$/.test(pageId)) {
      return bad('page_id should be only digits — copy it from your Page settings.')
    }
    const testEventCode =
      typeof body.test_event_code === 'string' ? body.test_event_code.trim() : ''
    const rawToken = typeof body.access_token === 'string' ? body.access_token.trim() : ''

    const { data: existing } = await supabase
      .from('meta_capi_configs')
      .select('id, access_token')
      .eq('account_id', accountId)
      .maybeSingle()

    // Reuse the stored token when the form didn't send a fresh one (it
    // only sends it when the admin actually retypes it).
    let tokenPlain: string
    if (rawToken) {
      tokenPlain = rawToken
    } else if (existing?.access_token) {
      try {
        tokenPlain = decrypt(existing.access_token)
      } catch {
        return bad('Stored access token could not be decrypted — re-enter it.')
      }
    } else {
      return bad('access_token is required')
    }

    const payload: Record<string, unknown> = {
      dataset_id: datasetId,
      waba_id: wabaId || null,
      page_id: pageId || null,
      test_event_code: testEventCode || null,
      is_active: body.is_active === true,
      send_qualified_lead: body.send_qualified_lead !== false,
      send_purchase: body.send_purchase === true,
    }
    if (rawToken) payload.access_token = encrypt(rawToken)

    const res = existing
      ? await supabase
          .from('meta_capi_configs')
          .update(payload)
          .eq('account_id', accountId)
      : await supabase.from('meta_capi_configs').insert({
          account_id: accountId,
          created_by: userId,
          access_token: encrypt(tokenPlain),
          ...payload,
        })

    if (res.error) {
      if (res.error.code === MISSING_TABLE) {
        return bad(
          'Run supabase/migrations/043_meta_capi_and_tenant_config.sql in the Supabase SQL editor first.',
        )
      }
      console.error('[meta/capi/config POST] save error:', res.error)
      return NextResponse.json(
        { error: 'Failed to save Meta configuration' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PUT — send one synthetic event to verify the credentials.
 *
 * Always forces a `test_event_code`, so a connectivity check can never
 * write a real conversion into the ad account. The event shows up in
 * Events Manager → Test Events within a few seconds.
 */
export async function PUT(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`meta-capi-test:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => ({}))
    const testCode =
      (typeof body?.test_event_code === 'string' && body.test_event_code.trim()) || ''

    const { data, error } = await supabase
      .from('meta_capi_configs')
      .select('dataset_id, access_token, waba_id, page_id, test_event_code')
      .eq('account_id', accountId)
      .maybeSingle()

    if (error || !data) return bad('Save your Meta credentials first.')

    const effectiveTestCode = testCode || data.test_event_code
    if (!effectiveTestCode) {
      return bad(
        'A test event code is required to run a check — copy it from the Test Events tab in Events Manager.',
      )
    }

    let accessToken: string
    try {
      accessToken = decrypt(data.access_token)
    } catch {
      return bad('Stored access token could not be decrypted — re-enter it.')
    }

    const result = await sendMetaCapiEvent(
      {
        eventName: 'QualifiedLead',
        eventId: `setup-check:${accountId}:${Date.now()}`,
        eventTime: new Date(),
        // Synthetic click id: Meta accepts the event into Test Events and
        // attributes it to nothing, which is exactly what a credential
        // check should do.
        ctwaClid: 'setup-connectivity-check',
        // Generic dataset events (used by UAZAPI) need at least one customer
        // identifier. This is a synthetic number and is sent only hashed;
        // the test_event_code keeps the event out of real attribution.
        phone: '5511999999999',
        value: null,
        currency: null,
      },
      {
        datasetId: data.dataset_id,
        accessToken,
        wabaId: data.waba_id,
        pageId: data.page_id,
        testEventCode: effectiveTestCode,
      },
    )

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ success: true, received: result.received })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('meta_capi_configs')
      .delete()
      .eq('account_id', accountId)
    if (error && error.code !== MISSING_TABLE) {
      console.error('[meta/capi/config DELETE] error:', error)
      return NextResponse.json(
        { error: 'Failed to delete Meta configuration' },
        { status: 500 },
      )
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
