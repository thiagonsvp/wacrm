import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { daysAgoStart, lastNDayKeys, localDayKey } from '@/lib/dashboard/date-utils'
import { isUndefinedColumnError, undefinedColumnName } from '@/lib/ai/config'

// Rows are aggregated in-process over a bounded window. An active
// account writes a handful of rows per conversation, so 30 days sits
// comfortably under this cap; we surface `truncated` when it doesn't so
// the UI can say "showing a partial window" rather than under-reporting
// silently.
const MAX_ROWS = 10_000
const DEFAULT_WINDOW_DAYS = 30

/** Every surface that spends tokens — must match the `mode` CHECK
 *  constraint (widened to `deal_pipeline` by migration 042 and
 *  `playground` by 058). A row whose mode is missing here used to throw
 *  mid-aggregation and take the whole dashboard down with a 500. */
const MODES = ['auto_reply', 'draft', 'deal_pipeline', 'playground'] as const
type UsageMode = (typeof MODES)[number]

interface UsageRow {
  created_at: string
  mode: UsageMode
  provider: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  /** Added by migration 057; null on older rows and on a project that
   *  hasn't applied it yet. */
  cached_prompt_tokens?: number | null
}

const BASE_COLUMNS =
  'created_at, mode, provider, model, prompt_tokens, completion_tokens, total_tokens'
const CACHED_COLUMN = 'cached_prompt_tokens'

/**
 * GET /api/ai/usage?days=30  (admin+)
 *
 * Token-spend summary for the account's BYO key over the last `days`
 * (1–90, default 30): totals, per-mode + per-model breakdowns, and a
 * zero-filled daily series for charting. Admin-only, mirroring the
 * `ai_usage_log` SELECT policy — spend is billing-class.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const url = new URL(request.url)
    const rawDays = Number(url.searchParams.get('days'))
    // Guard `>= 1`, not just `isFinite`: a missing/blank param is
    // Number(null)/Number('') === 0, which is finite — without the lower
    // bound the default would never apply and the window would collapse
    // to a single day.
    const days =
      Number.isFinite(rawDays) && rawDays >= 1
        ? Math.min(90, Math.floor(rawDays))
        : DEFAULT_WINDOW_DAYS

    // Align the query cutoff to the START of the oldest local day we'll
    // chart (not a rolling `now - N*24h` instant). Otherwise rows in the
    // oldest partial day would be counted in the totals but fall outside
    // every daily bucket, so the chart's bars wouldn't sum to the
    // headline total. Local-day boundaries match every other dashboard
    // chart (see lib/dashboard/date-utils).
    const since = daysAgoStart(days - 1)

    const fetchRows = (columns: string) =>
      supabase
        .from('ai_usage_log')
        .select(columns)
        .eq('account_id', accountId)
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS + 1)

    // Migrations are applied by hand, out of band; a project that hasn't
    // run 057 yet must still get its dashboard, just without the cached
    // split. Retry only for that specific column.
    let { data, error } = await fetchRows(`${BASE_COLUMNS}, ${CACHED_COLUMN}`)
    let hasCachedColumn = true
    if (
      error &&
      isUndefinedColumnError(error) &&
      undefinedColumnName(error) === CACHED_COLUMN
    ) {
      hasCachedColumn = false
      ;({ data, error } = await fetchRows(BASE_COLUMNS))
    }

    if (error) {
      console.error('[ai/usage GET] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load usage' },
        { status: 500 },
      )
    }

    const all = (data ?? []) as unknown as UsageRow[]
    const truncated = all.length > MAX_ROWS
    const rows = truncated ? all.slice(0, MAX_ROWS) : all

    // Totals.
    let promptTokens = 0
    let completionTokens = 0
    let totalTokens = 0
    let cachedPromptTokens = 0

    // Per-mode + per-model tallies.
    const byMode = Object.fromEntries(
      MODES.map((m) => [m, { calls: 0, tokens: 0 }]),
    ) as Record<UsageMode, { calls: number; tokens: number }>
    const modelMap = new Map<
      string,
      { model: string; provider: string; calls: number; tokens: number }
    >()

    // Zero-filled daily buckets so the chart shows quiet days as gaps,
    // not missing points. Local-day keys, oldest → newest — the same
    // helper every other dashboard chart uses, so day boundaries agree.
    const daily = new Map<string, { date: string; tokens: number; calls: number }>()
    for (const key of lastNDayKeys(days)) {
      daily.set(key, { date: key, tokens: 0, calls: 0 })
    }

    for (const r of rows) {
      promptTokens += r.prompt_tokens
      completionTokens += r.completion_tokens
      totalTokens += r.total_tokens
      cachedPromptTokens += r.cached_prompt_tokens ?? 0

      // `mode` is DB-CHECK-constrained to MODES; tolerate a value added
      // by a future migration rather than 500 the whole dashboard.
      const mode = byMode[r.mode]
      if (mode) {
        mode.calls += 1
        mode.tokens += r.total_tokens
      }

      const mk = `${r.provider}:${r.model}`
      const m =
        modelMap.get(mk) ??
        { model: r.model, provider: r.provider, calls: 0, tokens: 0 }
      m.calls += 1
      m.tokens += r.total_tokens
      modelMap.set(mk, m)

      const bucket = daily.get(localDayKey(r.created_at))
      if (bucket) {
        bucket.tokens += r.total_tokens
        bucket.calls += 1
      }
    }

    const byModel = [...modelMap.values()].sort((a, b) => b.tokens - a.tokens)

    return NextResponse.json({
      window_days: days,
      truncated,
      totals: {
        calls: rows.length,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        // Null (not 0) when the column isn't there, so the UI can tell
        // "nothing was cached" from "we can't know".
        cached_prompt_tokens: hasCachedColumn ? cachedPromptTokens : null,
      },
      by_mode: byMode,
      by_model: byModel,
      daily: [...daily.values()],
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
