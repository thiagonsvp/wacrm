type McpResponse = {
  result?: {
    structuredContent?: { result?: unknown }
    isError?: boolean
    content?: { text?: string }[]
  }
}

export type WindsorAccount = { id: string; name?: string | null }

export function tokenFromWindsorUrl(value: string): string | null {
  return new URL(value).searchParams.get('api_key')
}

export async function windsorMcpCall<T>(
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const response = await fetch('https://mcp.windsor.ai/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-03-26',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }),
    cache: 'no-store',
  })
  const raw = await response.text()
  if (!response.ok) throw new Error('O Windsor.ai recusou a consulta de dados.')
  const line = raw.split('\n').find((item) => item.startsWith('data: '))
  if (!line) throw new Error('O Windsor.ai retornou uma resposta inválida.')
  const json = JSON.parse(line.slice(6)) as McpResponse
  if (json.result?.isError) throw new Error(json.result.content?.[0]?.text || 'O Windsor.ai não conseguiu carregar os dados.')
  const result = json.result?.structuredContent?.result
  if (result !== undefined) return result as T
  const text = json.result?.content?.[0]?.text
  return (text ? JSON.parse(text) : null) as T
}

export async function windsorAccounts(token: string, connector: 'facebook' | 'google_ads') {
  const connectors = await windsorMcpCall<{ id: string; accounts?: WindsorAccount[] }[]>(token, 'get_connectors', { include_actions: false, include_options: false })
  return connectors.find((item) => item.id === connector)?.accounts ?? []
}
