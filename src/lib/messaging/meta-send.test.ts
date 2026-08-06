import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  channelEnabled,
  channelFromWebhookObject,
  type MetaMessagingConfig,
} from './channels'
import {
  messagingWindow,
  sendMetaMessage,
  HUMAN_AGENT_WINDOW_MS,
  STANDARD_WINDOW_MS,
} from './meta-send'

const NOW = new Date('2026-08-06T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

describe('channelFromWebhookObject', () => {
  it('maps Meta webhook objects to channels', () => {
    expect(channelFromWebhookObject('instagram')).toBe('instagram')
    expect(channelFromWebhookObject('page')).toBe('messenger')
  })

  it('ignores objects this integration does not handle', () => {
    // `whatsapp_business_account` arrives on the same app; it belongs to
    // the WhatsApp webhook, not here.
    expect(channelFromWebhookObject('whatsapp_business_account')).toBeNull()
    expect(channelFromWebhookObject('')).toBeNull()
  })
})

describe('channelEnabled', () => {
  const config = (over: Partial<MetaMessagingConfig> = {}): MetaMessagingConfig => ({
    accountId: 'acct',
    pageId: 'page-1',
    instagramAccountId: 'ig-1',
    pageAccessToken: 'tok',
    instagramEnabled: true,
    messengerEnabled: true,
    ...over,
  })

  it('honours each channel switch independently', () => {
    expect(channelEnabled(config({ messengerEnabled: false }), 'instagram')).toBe(true)
    expect(channelEnabled(config({ messengerEnabled: false }), 'messenger')).toBe(false)
  })

  it('never claims WhatsApp — that channel is not served here', () => {
    expect(channelEnabled(config(), 'whatsapp')).toBe(false)
  })
})

describe('messagingWindow', () => {
  it('is standard inside 24 hours', () => {
    expect(messagingWindow(ago(60_000), NOW)).toBe('standard')
    expect(messagingWindow(ago(STANDARD_WINDOW_MS - 1000), NOW)).toBe('standard')
  })

  it('needs the human-agent tag between 24 hours and 7 days', () => {
    expect(messagingWindow(ago(STANDARD_WINDOW_MS + 1000), NOW)).toBe('human_agent')
    expect(messagingWindow(ago(HUMAN_AGENT_WINDOW_MS - 1000), NOW)).toBe('human_agent')
  })

  it('is expired past 7 days', () => {
    expect(messagingWindow(ago(HUMAN_AGENT_WINDOW_MS + 1000), NOW)).toBe('expired')
  })

  it('treats a thread with no inbound message as expired', () => {
    // Meta has no notion of us opening a conversation cold.
    expect(messagingWindow(null, NOW)).toBe('expired')
  })

  it('tolerates clock skew rather than refusing the send', () => {
    expect(messagingWindow(new Date(NOW.getTime() + 60_000), NOW)).toBe('standard')
  })
})

describe('sendMetaMessage', () => {
  const fetchMock = vi.fn()
  const base = {
    pageId: 'page-1',
    accessToken: 'tok-secret',
    recipientId: 'igsid-123',
    text: 'oi',
    channel: 'instagram' as const,
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('posts to the page messages edge with a bearer token', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message_id: 'mid.1' }), { status: 200 }),
    )
    const res = await sendMetaMessage({ ...base, lastInboundAt: ago(60_000) })
    expect(res.ok).toBe(true)
    expect(res.messageId).toBe('mid.1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/page-1/messages')
    expect(url).not.toContain('tok-secret')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok-secret',
    )
  })

  it('sends no tag inside the 24-hour window', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    await sendMetaMessage({ ...base, lastInboundAt: ago(60_000) })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.tag).toBeUndefined()
    expect(body.messaging_type).toBe('RESPONSE')
  })

  it('adds the human-agent tag past 24 hours', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    await sendMetaMessage({ ...base, lastInboundAt: ago(STANDARD_WINDOW_MS + 60_000) })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.tag).toBe('HUMAN_AGENT')
  })

  it('refuses past 7 days without spending a request', async () => {
    // A rejected send still counts against the app's error rate with
    // Meta, and the agent gets a clearer reason this way.
    const res = await sendMetaMessage({
      ...base,
      lastInboundAt: ago(HUMAN_AGENT_WINDOW_MS + 60_000),
    })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('7 dias')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces Meta errors and marks 4xx non-retryable', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid recipient' } }), {
        status: 400,
      }),
    )
    const res = await sendMetaMessage({ ...base, lastInboundAt: ago(60_000) })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('Invalid recipient')
    expect(res.retryable).toBe(false)
  })

  it('marks 429 and 5xx retryable', async () => {
    for (const status of [429, 500, 503]) {
      fetchMock.mockResolvedValue(new Response('{}', { status }))
      const res = await sendMetaMessage({ ...base, lastInboundAt: ago(60_000) })
      expect(res.retryable, `status=${status}`).toBe(true)
    }
  })

  it('never throws on a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    const res = await sendMetaMessage({ ...base, lastInboundAt: ago(60_000) })
    expect(res.ok).toBe(false)
    expect(res.retryable).toBe(true)
  })
})
