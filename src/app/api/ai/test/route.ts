import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadGlobalAiCredentials } from '@/lib/ai/global-config'
import { validateAiCredentials } from '@/lib/ai/validate'
import { AiError } from '@/lib/ai/types'

/** Validate the deployment-wide OpenAI configuration without exposing it. */
export async function POST() {
  try {
    const { userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-test:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const credentials = await loadGlobalAiCredentials()
    if (!credentials) {
      return NextResponse.json(
        { error: 'Configure a chave e o modelo OpenAI nas configurações do administrador.' },
        { status: 400 },
      )
    }
    try {
      await validateAiCredentials(credentials)
    } catch (err) {
      if (err instanceof AiError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
      }
      console.error('[ai/test] validation error:', err)
      return NextResponse.json({ error: 'Could not validate the API key.' }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
