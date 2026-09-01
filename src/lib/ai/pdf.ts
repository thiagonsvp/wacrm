import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAiConfig } from './config'

const MAX_PDF_BYTES = 16 * 1024 * 1024
// The deal classifier already gets recent conversation context. Keeping a
// PDF excerpt bounded prevents a long catalogue from consuming the account's
// token budget on every future classification of that conversation.
const MAX_PDF_TEXT_CHARS = 12_000

function cleanPdfText(raw: string): string {
  return raw
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_PDF_TEXT_CHARS)
}

/**
 * Extract selectable text from an inbound PDF for the deal classifier.
 *
 * This deliberately does not call an LLM: extraction happens once at
 * receipt, and the existing (already rate-limited) classifier interprets the
 * compact text along with the conversation. Scanned/image-only PDFs return
 * null; OCR is intentionally not attempted here because it adds a separate
 * paid model call and can turn an unreadable quote into invented values.
 */
export async function extractInboundPdfText(
  db: SupabaseClient,
  accountId: string,
  bytes: Buffer,
  filename?: string | null,
): Promise<string | null> {
  if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES) return null

  try {
    const config = await loadAiConfig(db, accountId)
    if (!config?.dealPipelineEnabled) return null

    const { default: pdfParse } = await import('pdf-parse')
    const parsed = await pdfParse(bytes)
    const text = cleanPdfText(typeof parsed.text === 'string' ? parsed.text : '')
    if (!text) return null

    const displayName = filename?.trim() || 'documento PDF'
    return `[Conteúdo extraído do PDF: ${displayName}]\n${text}`
  } catch (err) {
    // PDF parsing is best effort. A corrupt/encrypted document must never
    // reject the webhook or keep a normal customer message from arriving.
    console.warn('[ai pdf] could not extract inbound PDF:', err)
    return null
  }
}
