import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'

type McpResponse = {
  result?: { structuredContent?: { result?: unknown }; isError?: boolean; content?: { text?: string }[] }
}

const FIELDS = [
  'date', 'campaign', 'campaign_id', 'ad_name', 'spend', 'impressions',
  'reach', 'clicks', 'ctr', 'cpc', 'cpm', 'image_url',
]

async function mcpCall<T>(token: string, name: string, args: Record<string, unknown>): Promise<T> {
  const payload = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } })
  const response = await fetch('https://mcp.windsor.ai/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-03-26',
    },
    body: payload,
    cache: 'no-store',
  })
  const raw = await response.text()
  if (!response.ok) throw new Error('O Windsor.ai recusou a consulta de dados.')
  const line = raw.split('\n').find((item) => item.startsWith('data: '))
  if (!line) throw new Error('O Windsor.ai retornou uma resposta inválida.')
  const json = JSON.parse(line.slice(6)) as McpResponse
  if (json.result?.isError) throw new Error(json.result.content?.[0]?.text || 'O Windsor.ai não conseguiu carregar os dados.')
  const structured = json.result?.structuredContent?.result
  if (structured !== undefined) return structured as T
  const text = json.result?.content?.[0]?.text
  return (text ? JSON.parse(text) : null) as T
}

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const params = new URL(request.url).searchParams
    const isGoogle = params.get('source') === 'google'
    const column = isGoogle ? 'google_ads_url' : 'meta_ads_url'
    const connector = isGoogle ? 'google_ads' : 'facebook'
    const { data, error } = await supabase
      .from('windsor_configs')
      .select('meta_ads_url, google_ads_url')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) throw error
    if (!data?.[column]) return NextResponse.json({ error: 'Configure a fonte do Windsor.ai em Configurações.' }, { status: 404 })

    const savedUrl = new URL(decrypt(data[column]))
    const token = savedUrl.searchParams.get('api_key')
    if (!token) return NextResponse.json({ error: 'O link salvo não contém uma chave do Windsor.ai.' }, { status: 400 })

    const connectors = await mcpCall<{ id: string; accounts?: { id: string }[] }[]>(token, 'get_connectors', { include_actions: false, include_options: false })
    const connected = connectors.find((item) => item.id === connector)
    const accounts = connected?.accounts?.map((item) => item.id) ?? []
    if (!accounts.length) return NextResponse.json({ error: `Nenhuma conta ${isGoogle ? 'Google Ads' : 'Meta Ads'} conectada no Windsor.ai.` }, { status: 400 })

    const rows = await mcpCall<Record<string, unknown>[]>(token, 'get_data', {
      connector,
      accounts,
      fields: FIELDS,
      date_from: params.get('from') || undefined,
      date_to: params.get('to') || undefined,
      date_preset: params.get('from') || params.get('to') ? undefined : 'this_monthT',
    })
    return NextResponse.json(rows)
  } catch (err) {
    console.error('[windsor/performance]', err)
    return toErrorResponse(err)
  }
}
