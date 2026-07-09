/**
 * Provider abstraction over the two supported WhatsApp backends
 * (Meta Cloud API, Evolution API). Only covers what both share —
 * text + media sending. Capabilities that only Meta has (templates,
 * interactive, reactions, phone registration) stay off this
 * interface; callers check `capabilities` before touching them.
 */

import type { MediaKind } from '@/lib/whatsapp/meta-api'
import { createMetaProvider } from '@/lib/whatsapp/providers/meta-provider'
import { createEvolutionProvider } from '@/lib/whatsapp/providers/evolution-provider'

export interface WhatsAppSendResult {
  messageId: string
}

export interface SendTextInput {
  to: string
  text: string
  contextMessageId?: string
}

export interface SendMediaInput {
  to: string
  kind: MediaKind
  link: string
  caption?: string
  filename?: string
  contextMessageId?: string
}

export interface WhatsAppProviderCapabilities {
  templates: boolean
  interactive: boolean
  reactions: boolean
  registration: boolean
}

export interface WhatsAppProvider {
  readonly name: 'meta' | 'evolution'
  readonly capabilities: WhatsAppProviderCapabilities
  sendText(input: SendTextInput): Promise<WhatsAppSendResult>
  sendMedia(input: SendMediaInput): Promise<WhatsAppSendResult>
}

/**
 * Minimal shape of a `whatsapp_config` row needed to resolve a
 * provider. Accepts the full row (extra fields ignored) so callers
 * can pass the raw Supabase result directly.
 */
export interface WhatsAppConfigRow {
  provider?: string | null
  phone_number_id?: string | null
  access_token?: string | null
  evolution_base_url?: string | null
  evolution_instance_name?: string | null
  evolution_api_key?: string | null
  [key: string]: unknown
}

const META_CAPABILITIES: WhatsAppProviderCapabilities = {
  templates: true,
  interactive: true,
  reactions: true,
  registration: true,
}

const EVOLUTION_CAPABILITIES: WhatsAppProviderCapabilities = {
  templates: false,
  interactive: false,
  reactions: false,
  registration: false,
}

export { META_CAPABILITIES, EVOLUTION_CAPABILITIES }

/**
 * Resolve the right provider implementation for a `whatsapp_config`
 * row. Callers must have already decrypted any tokens on `config`
 * (both provider constructors read the plaintext fields).
 */
export function resolveProvider(
  config: WhatsAppConfigRow & { decryptedAccessToken?: string; decryptedEvolutionApiKey?: string },
): WhatsAppProvider {
  if (config.provider === 'evolution') {
    return createEvolutionProvider(config)
  }
  return createMetaProvider(config)
}
