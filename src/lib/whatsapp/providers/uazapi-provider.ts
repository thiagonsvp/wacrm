import { sendText, sendMedia, type UazapiMediaKind } from '@/lib/whatsapp/providers/uazapi'
import type {
  WhatsAppProvider,
  WhatsAppConfigRow,
  SendTextInput,
  SendMediaInput,
  WhatsAppSendResult,
} from '@/lib/whatsapp/provider'
import { UAZAPI_CAPABILITIES } from '@/lib/whatsapp/provider'

function toUazapiMediaKind(kind: SendMediaInput['kind']): UazapiMediaKind {
  return kind as UazapiMediaKind
}

export function createUazapiProvider(
  config: WhatsAppConfigRow & { decryptedUazapiToken?: string },
): WhatsAppProvider {
  const baseUrl = config.uazapi_base_url as string | null | undefined
  const token = config.decryptedUazapiToken

  if (!baseUrl || !token) {
    throw new Error('UAZAPI provider requires uazapi_base_url and a decrypted uazapi_token.')
  }

  return {
    name: 'uazapi',
    capabilities: UAZAPI_CAPABILITIES,
    async sendText(input: SendTextInput): Promise<WhatsAppSendResult> {
      const result = await sendText({ baseUrl, token, number: input.to, text: input.text })
      return { messageId: result.messageId }
    },
    async sendMedia(input: SendMediaInput): Promise<WhatsAppSendResult> {
      const result = await sendMedia({
        baseUrl,
        token,
        number: input.to,
        type: toUazapiMediaKind(input.kind),
        file: input.link,
        caption: input.caption,
      })
      return { messageId: result.messageId }
    },
  }
}
