import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { sendMessageToConversation, SendMessageError } from './send-message'

/**
 * Deletar a instância vinculada pelo painel zera `uazapi_token` mas
 * mantém a linha com `provider = 'uazapi'` (é UNIQUE(account_id) e
 * carrega outros campos). O envio precisa dizer "não configurado", não
 * estourar dentro do decrypt.
 */
function dbWith(config: Record<string, unknown>): SupabaseClient {
  const conversation = {
    id: 'cv-1',
    account_id: 'acct-a',
    contact: { id: 'ct-1', phone: '+5521999999999' },
  }
  return {
    from(table: string) {
      const result =
        table === 'conversations'
          ? { data: conversation, error: null }
          : { data: config, error: null }
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => result,
        maybeSingle: async () => result,
      }
      return chain
    },
  } as unknown as SupabaseClient
}

describe('sendMessageToConversation — config uazapi sem token', () => {
  const params = { conversationId: 'cv-1', messageType: 'text', contentText: 'oi' }

  it('responde whatsapp_not_configured quando uazapi_token é null', async () => {
    const db = dbWith({
      id: 'cfg-1',
      account_id: 'acct-a',
      provider: 'uazapi',
      uazapi_token: null,
      uazapi_base_url: 'https://x.uazapi.com',
    })
    await expect(
      sendMessageToConversation(db, 'acct-a', params),
    ).rejects.toBeInstanceOf(SendMessageError)
    await sendMessageToConversation(db, 'acct-a', params).catch(
      (e: SendMessageError) => {
        expect(e.code).toBe('whatsapp_not_configured')
        expect(e.status).toBe(400)
      },
    )
  })

  it('responde whatsapp_not_configured quando uazapi_token é string vazia', async () => {
    const db = dbWith({
      id: 'cfg-1',
      account_id: 'acct-a',
      provider: 'uazapi',
      uazapi_token: '',
      uazapi_base_url: 'https://x.uazapi.com',
    })
    await sendMessageToConversation(db, 'acct-a', params).catch(
      (e: SendMessageError) => {
        expect(e.code).toBe('whatsapp_not_configured')
      },
    )
  })
})
