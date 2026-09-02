import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { loadGlobalWindsorToken } from '@/lib/windsor/global-config'
import { windsorAccounts } from '@/lib/windsor/mcp'

export async function GET(request: Request) {
  try {
    await getCurrentAccount()
    const isGoogle = new URL(request.url).searchParams.get('source') === 'google'
    const token = await loadGlobalWindsorToken()
    if (!token) {
      return NextResponse.json(
        { error: 'Configure a chave Windsor em Configurações de administrador.' },
        { status: 400 },
      )
    }
    const accounts = await windsorAccounts(token, isGoogle ? 'google_ads' : 'facebook')
    return NextResponse.json({ accounts })
  } catch (error) {
    return toErrorResponse(error)
  }
}
