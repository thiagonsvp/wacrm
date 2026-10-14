import { createHash } from 'node:crypto'
import { unstable_cache } from 'next/cache'

/**
 * Windsor's get_data took 2–26s per call in production. Without a
 * ceiling a stuck call held the Performance page on skeletons forever;
 * past this it fails with a message instead.
 */
const WINDSOR_TIMEOUT_MS = 45_000

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
  let response: Response
  let raw: string
  try {
    response = await fetch('https://mcp.windsor.ai/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-03-26',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }),
      cache: 'no-store',
      signal: AbortSignal.timeout(WINDSOR_TIMEOUT_MS),
    })
    raw = await response.text()
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error('O Windsor.ai demorou demais para responder. Tente atualizar em instantes.')
    }
    throw err
  }
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

/**
 * `windsorMcpCall` with a short-lived server cache. Ad metrics move
 * slowly and the same report is opened repeatedly, so serving a result
 * up to `ttlSeconds` old turns a 2–26s Windsor round trip into an
 * instant one. The key covers the tool, every argument and a hash of
 * the token, so different accounts or ranges never share an entry.
 * `fresh` skips the cache (the page's "Atualizar" button).
 */
export async function windsorMcpCallCached<T>(
  token: string,
  name: string,
  args: Record<string, unknown>,
  { ttlSeconds = 600, fresh = false }: { ttlSeconds?: number; fresh?: boolean } = {},
): Promise<T> {
  if (fresh) return windsorMcpCall<T>(token, name, args)
  const tokenKey = createHash('sha256').update(token).digest('hex').slice(0, 16)
  return unstable_cache(
    () => windsorMcpCall<T>(token, name, args),
    ['windsor', name, tokenKey, JSON.stringify(args)],
    { revalidate: ttlSeconds },
  )()
}

export async function windsorAccounts(token: string, connector: 'facebook' | 'google_ads') {
  const connectors = await windsorMcpCall<{ id: string; accounts?: WindsorAccount[] }[]>(token, 'get_connectors', { include_actions: false, include_options: false })
  return connectors.find((item) => item.id === connector)?.accounts ?? []
}
