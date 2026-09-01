import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAiConfig } from './config'

const OPENAI_TRANSCRIPTION_URL = 'https://api.openai.com/v1/audio/transcriptions'
const MAX_AUDIO_BYTES = 16 * 1024 * 1024
const TRANSCRIPTION_TIMEOUT_MS = 20_000

const EXTENSIONS: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
}

async function transcribeWithOpenAi(
  apiKey: string,
  buffer: ArrayBuffer,
  rawContentType: string
): Promise<string | null> {
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_AUDIO_BYTES) {
    throw new Error('audio is empty or exceeds 16 MB transcription limit')
  }

  const contentType = (rawContentType || 'audio/ogg').split(';')[0].trim().toLowerCase()
  const extension = EXTENSIONS[contentType] ?? 'ogg'
  const form = new FormData()
  form.append('file', new Blob([buffer], { type: contentType }), `whatsapp-audio.${extension}`)
  form.append('model', 'gpt-4o-mini-transcribe')
  form.append('language', 'pt')
  form.append('prompt', 'Áudio de atendimento comercial pelo WhatsApp em português do Brasil.')

  const response = await fetch(OPENAI_TRANSCRIPTION_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
  })
  if (!response.ok) {
    const details = await response.text().catch(() => '')
    throw new Error(`OpenAI transcription returned ${response.status}: ${details.slice(0, 200)}`)
  }

  const payload = (await response.json()) as { text?: unknown }
  return typeof payload.text === 'string' && payload.text.trim() ? payload.text.trim() : null
}

/** Transcribe bytes already downloaded by a provider-specific webhook. */
export async function transcribeInboundAudioBytes(
  db: SupabaseClient,
  accountId: string,
  buffer: ArrayBuffer,
  contentType: string
): Promise<string | null> {
  try {
    const config = await loadAiConfig(db, accountId)
    if (!config?.autoReplyEnabled || config.provider !== 'openai') return null
    return await transcribeWithOpenAi(config.apiKey, buffer, contentType)
  } catch (err) {
    console.error('[ai transcription] failed:', err)
    return null
  }
}

/** Best-effort transcription for inbound WhatsApp audio. */
export async function transcribeInboundAudio(
  db: SupabaseClient,
  accountId: string,
  mediaUrl: string | null
): Promise<string | null> {
  if (!mediaUrl) return null

  try {
    const config = await loadAiConfig(db, accountId)
    if (!config?.autoReplyEnabled || config.provider !== 'openai') return null

    const mediaResponse = await fetch(mediaUrl, {
      signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
    })
    if (!mediaResponse.ok) {
      throw new Error(`audio download returned ${mediaResponse.status}`)
    }

    const declaredLength = Number(mediaResponse.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_BYTES) {
      throw new Error('audio exceeds 16 MB transcription limit')
    }

    const buffer = await mediaResponse.arrayBuffer()
    return await transcribeWithOpenAi(
      config.apiKey,
      buffer,
      mediaResponse.headers.get('content-type') || 'audio/ogg'
    )
  } catch (err) {
    console.error('[ai transcription] failed:', err)
    return null
  }
}
