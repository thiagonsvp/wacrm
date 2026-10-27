import { NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/auth/api-context'
import { toApiErrorResponse } from '@/lib/api/v1/respond'
import { resolveAuditUserId } from '@/lib/api/v1/contacts'
import { ingestAutocertoLead, type AutocertoLead } from '@/lib/integrations/autocerto'

export const maxDuration = 60

/**
 * POST /api/v1/integrations/autocerto
 *
 * Receives Autocerto's lead webhook. Autocerto sends the account's API key
 * as `Authorization: Bearer <key>` (the key needs the `contacts:write`
 * scope), so the key decides which company the lead belongs to.
 *
 * Autocerto treats any 2xx as delivered and re-sends anything else on its
 * next 30-minute cycle. Leads that can't be filed (no phone) are still
 * answered 200 so they don't loop forever; a real failure answers 500 so
 * the lead comes back.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:write')
    const body = (await request.json().catch(() => null)) as AutocertoLead | AutocertoLead[] | null
    const leads = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : []
    if (leads.length === 0) {
      return NextResponse.json({ error: 'corpo JSON do lead ausente' }, { status: 400 })
    }

    const auditUserId = ctx.createdBy ?? (await resolveAuditUserId(ctx.supabase, ctx.accountId))
    const results = []
    for (const lead of leads.slice(0, 200)) {
      const result = await ingestAutocertoLead(ctx.supabase, ctx.accountId, auditUserId, lead)
      if (result.status === 'skipped') {
        console.warn(`[autocerto] lead ${String(lead?.id ?? '?')} skipped: ${result.reason}`)
      }
      results.push({ id: lead?.id ?? null, ...result })
    }
    return NextResponse.json({ received: results.length, results })
  } catch (err) {
    console.error('[autocerto] webhook failed:', err)
    return toApiErrorResponse(err)
  }
}
