import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { connectInstance } from '@/lib/whatsapp/providers/uazapi'
import { getUazapiServer, requireOwnedInstance } from '@/lib/whatsapp/uazapi-admin'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { accountId } = await requireRole('admin')
    const server = getUazapiServer()
    if (!server) return NextResponse.json({ error: 'uazapi_not_configured' }, { status: 503 })

    const instance = await requireOwnedInstance(server, accountId, id)
    try {
      const qr = await connectInstance({ baseUrl: server.baseUrl, token: instance.token })
      if (!qr.qrcode && !qr.paircode) return NextResponse.json({ connected: true })
      return NextResponse.json({ connected: false, base64: qr.qrcode, paircode: qr.paircode })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown UAZAPI error'
      console.error('[uazapi/connect] failed:', message)
      return NextResponse.json({ error: 'uazapi_error', message }, { status: 502 })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
