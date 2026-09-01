import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  decrypt: vi.fn((value: string) => `decrypted:${value}`),
  metaSendText: vi.fn(),
  uazapiSendText: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: mocks.decrypt,
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: mocks.metaSendText,
  sendMediaMessage: vi.fn(),
  sendInteractiveButtons: vi.fn(),
  sendInteractiveList: vi.fn(),
}))

vi.mock('@/lib/whatsapp/providers/uazapi', () => ({
  sendText: mocks.uazapiSendText,
}))

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({ from: mocks.from }),
}))

import { engineSendText } from './meta-send'

describe('engineSendText with UAZAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.uazapiSendText.mockResolvedValue({ messageId: 'uaz-msg-1' })

    mocks.from.mockImplementation((table: string) => {
      if (table === 'contacts') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: 'contact-1', phone: '5521981930313' },
                  error: null,
                }),
              }),
            }),
          }),
        }
      }

      if (table === 'whatsapp_config') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  provider: 'uazapi',
                  uazapi_base_url: 'https://uazapi.example',
                  uazapi_token: 'encrypted-token',
                  access_token: null,
                },
                error: null,
              }),
            }),
          }),
        }
      }

      if (table === 'messages') {
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }

      if (table === 'conversations') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        }
      }

      throw new Error(`unexpected table: ${table}`)
    })
  })

  it('sends through UAZAPI and persists an AI bot message', async () => {
    const result = await engineSendText({
      accountId: 'account-1',
      userId: 'user-1',
      conversationId: 'conversation-1',
      contactId: 'contact-1',
      text: 'Olá! Como posso ajudar?',
      aiGenerated: true,
    })

    expect(mocks.uazapiSendText).toHaveBeenCalledWith({
      baseUrl: 'https://uazapi.example',
      token: 'decrypted:encrypted-token',
      number: '5521981930313',
      text: 'Olá! Como posso ajudar?',
    })
    expect(mocks.metaSendText).not.toHaveBeenCalled()

    const messages = mocks.from.mock.results.find(
      (call) => call.type === 'return' && call.value?.insert,
    )?.value
    expect(messages.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        sender_type: 'bot',
        content_type: 'text',
        content_text: 'Olá! Como posso ajudar?',
        message_id: 'uaz-msg-1',
        ai_generated: true,
      }),
    )
    expect(result).toEqual({ whatsapp_message_id: 'uaz-msg-1' })
  })
})
