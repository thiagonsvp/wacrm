import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
  created_at: string
}

/**
 * Fetch the last N messages with useful text of a conversation and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`. Media messages are included when
 * they carry a caption or transcription in `content_text`.
 *
 * Empty messages (untranscribed audio, bare media) are dropped IN THE
 * QUERY, before the limit — otherwise they ate part of the window and a
 * 20-message context held as few as ~17 readable lines.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_text, created_at')
    .eq('conversation_id', conversationId)
    .not('content_text', 'is', null)
    .neq('content_text', '')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  return rows
    .filter((m) => m.content_text && m.content_text.trim())
    .map((m) => ({
      role: m.sender_type === 'customer' ? 'user' : 'assistant',
      content: m.content_text!.trim(),
      at: m.created_at,
    }))
}
