import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiConfig } from './types'

const h = vi.hoisted(() => ({ loadAiConfig: vi.fn() }))
vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))

import { transcribeInboundAudio } from './transcription'

function config(provider: 'openai' | 'anthropic' = 'openai'): AiConfig {
  return {
    provider,
    model: 'test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    dealPipelineEnabled: false,
    dealProductScope: null,
    dealPipelineInstructions: null,
    dealStageQualifiedId: null,
    dealStageNegotiatingId: null,
    dealStageClosedId: null,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('transcribeInboundAudio', () => {
  it('downloads WhatsApp audio and sends it to the low-cost transcription model', async () => {
    h.loadAiConfig.mockResolvedValue(config())
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'audio/ogg', 'content-length': '3' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: 'Quero saber o preço.' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      transcribeInboundAudio({} as never, 'acct-1', 'https://media.example/audio.ogg'),
    ).resolves.toBe('Quero saber o preço.')

    const [, request] = fetchMock.mock.calls[1]
    expect(request.headers.Authorization).toBe('Bearer sk-test')
    expect(request.body).toBeInstanceOf(FormData)
    expect((request.body as FormData).get('model')).toBe('gpt-4o-mini-transcribe')
  })

  it('does not spend on transcription when the account is not using OpenAI', async () => {
    h.loadAiConfig.mockResolvedValue(config('anthropic'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      transcribeInboundAudio({} as never, 'acct-1', 'https://media.example/audio.ogg'),
    ).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
