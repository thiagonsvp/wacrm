import { sendTextMessage, sendMediaMessage } from '@/lib/whatsapp/meta-api'
import type {
  WhatsAppProvider,
  WhatsAppConfigRow,
  SendTextInput,
  SendMediaInput,
  WhatsAppSendResult,
} from '@/lib/whatsapp/provider'
import { META_CAPABILITIES } from '@/lib/whatsapp/provider'

/**
 * Thin adapter over meta-api.ts — no send logic lives here, only
 * argument shaping so it satisfies WhatsAppProvider.
 */
export function createMetaProvider(
  config: WhatsAppConfigRow & { decryptedAccessToken?: string },
): WhatsAppProvider {
  const phoneNumberId = config.phone_number_id
  const accessToken = config.decryptedAccessToken

  if (!phoneNumberId || !accessToken) {
    throw new Error('Meta provider requires phone_number_id and a decrypted access token.')
  }

  return {
    name: 'meta',
    capabilities: META_CAPABILITIES,
    async sendText(input: SendTextInput): Promise<WhatsAppSendResult> {
      const result = await sendTextMessage({
        phoneNumberId,
        accessToken,
        to: input.to,
        text: input.text,
        contextMessageId: input.contextMessageId,
      })
      return { messageId: result.messageId }
    },
    async sendMedia(input: SendMediaInput): Promise<WhatsAppSendResult> {
      const result = await sendMediaMessage({
        phoneNumberId,
        accessToken,
        to: input.to,
        kind: input.kind,
        link: input.link,
        caption: input.caption,
        filename: input.filename,
        contextMessageId: input.contextMessageId,
      })
      return { messageId: result.messageId }
    },
  }
}
