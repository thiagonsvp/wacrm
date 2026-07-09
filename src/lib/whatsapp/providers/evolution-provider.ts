import { sendText, sendMedia, type EvolutionMediaKind } from '@/lib/whatsapp/providers/evolution-api'
import type {
  WhatsAppProvider,
  WhatsAppConfigRow,
  SendTextInput,
  SendMediaInput,
  WhatsAppSendResult,
} from '@/lib/whatsapp/provider'
import { EVOLUTION_CAPABILITIES } from '@/lib/whatsapp/provider'

// Evolution's sendMedia has no separate 'audio' voice-note affordance
// distinct from a generic file — it accepts the same MediaKind values
// Meta does, so no remapping is needed here.
function toEvolutionMediaKind(kind: SendMediaInput['kind']): EvolutionMediaKind {
  return kind as EvolutionMediaKind
}

export function createEvolutionProvider(
  config: WhatsAppConfigRow & { decryptedEvolutionApiKey?: string },
): WhatsAppProvider {
  const baseUrl = config.evolution_base_url
  const instanceName = config.evolution_instance_name
  const apiKey = config.decryptedEvolutionApiKey

  if (!baseUrl || !instanceName || !apiKey) {
    throw new Error(
      'Evolution provider requires evolution_base_url, evolution_instance_name, and a decrypted evolution_api_key.',
    )
  }

  return {
    name: 'evolution',
    capabilities: EVOLUTION_CAPABILITIES,
    async sendText(input: SendTextInput): Promise<WhatsAppSendResult> {
      const result = await sendText({
        baseUrl,
        apiKey,
        instanceName,
        number: input.to,
        text: input.text,
      })
      return { messageId: result.messageId }
    },
    async sendMedia(input: SendMediaInput): Promise<WhatsAppSendResult> {
      const result = await sendMedia({
        baseUrl,
        apiKey,
        instanceName,
        number: input.to,
        mediatype: toEvolutionMediaKind(input.kind),
        media: input.link,
        caption: input.caption,
        fileName: input.filename,
      })
      return { messageId: result.messageId }
    },
  }
}
