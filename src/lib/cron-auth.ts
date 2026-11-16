import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

/** Constant-time string compare; length mismatch returns false (timingSafeEqual throws). */
export function safeEqual(supplied: string | null, expected: string): boolean {
  if (supplied === null) return false
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Shared auth for cron endpoints. Accepts `x-cron-secret:
 * $AUTOMATION_CRON_SECRET` (external pinger / pg_net) and, unless
 * `vercel: false`, Vercel Cron's `Authorization: Bearer $CRON_SECRET`.
 *
 * Returns a response to send back when the request is not authorized,
 * or null when it may proceed.
 */
export function rejectUnauthorizedCron(
  request: Request,
  { vercel = true }: { vercel?: boolean } = {},
): NextResponse | null {
  const pingerSecret = process.env.AUTOMATION_CRON_SECRET
  const vercelSecret = vercel ? process.env.CRON_SECRET : undefined
  if (!pingerSecret && !vercelSecret) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const authorized =
    (!!pingerSecret && safeEqual(request.headers.get('x-cron-secret'), pingerSecret)) ||
    (!!vercelSecret &&
      safeEqual(request.headers.get('authorization'), `Bearer ${vercelSecret}`))
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
