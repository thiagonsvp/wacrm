import type { SupabaseClient } from '@supabase/supabase-js'
import {
  sendMessageToConversation,
  SendMessageError,
} from '@/lib/whatsapp/send-message'

/** Row of `scheduled_messages` (migration 084). */
export interface ScheduledMessageRow {
  id: string
  account_id: string
  conversation_id: string
  created_by: string | null
  group_id: string
  position: number
  message_type: 'text' | 'image' | 'video' | 'audio' | 'document'
  content_text: string | null
  media_url: string | null
  media_path: string | null
  filename: string | null
  send_at: string
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'canceled'
  attempts: number
  error_message: string | null
  sent_message_id: string | null
  sent_at: string | null
  created_at: string
}

export interface DispatchResult {
  claimed: number
  sent: number
  failed: number
}

/** A claim older than this never got its result written — the function
 *  died mid-send. Marked failed rather than retried: the message may well
 *  have reached the customer, and sending it twice is the worse outcome. */
const STUCK_AFTER_MS = 10 * 60_000

/**
 * Send every scheduled message whose time has come.
 *
 * Called by the per-minute pg_cron tick (all accounts) and by an open
 * inbox (its own account only). Items are claimed atomically in the
 * database, so overlapping callers never send the same item twice.
 * Items of one schedule go out in order; if one fails, the rest of that
 * schedule is held back as failed too, so the customer never gets the
 * second half of a message without the first.
 *
 * `db` must be a service-role client: the claim function is not granted
 * to signed-in users.
 */
export async function dispatchDueScheduledMessages(
  db: SupabaseClient,
  opts: { accountId?: string; limit?: number } = {}
): Promise<DispatchResult> {
  const result: DispatchResult = { claimed: 0, sent: 0, failed: 0 }

  await db
    .from('scheduled_messages')
    .update({
      status: 'failed',
      error_message: 'O envio foi interrompido. Confira na conversa se a mensagem chegou.',
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'sending')
    .lt('updated_at', new Date(Date.now() - STUCK_AFTER_MS).toISOString())

  const { data, error } = await db.rpc('claim_due_scheduled_messages', {
    p_limit: opts.limit ?? 50,
    p_account_id: opts.accountId ?? null,
  })
  if (error) throw error
  const rows = (data ?? []) as ScheduledMessageRow[]
  result.claimed = rows.length

  const groups = new Map<string, ScheduledMessageRow[]>()
  for (const row of rows) {
    const list = groups.get(row.group_id) ?? []
    list.push(row)
    groups.set(row.group_id, list)
  }

  for (const items of groups.values()) {
    items.sort((a, b) => a.position - b.position)
    let blockedBy: string | null = null
    for (const item of items) {
      if (blockedBy) {
        await markFailed(db, item.id, `Não enviada porque a anterior falhou: ${blockedBy}`)
        result.failed++
        continue
      }
      try {
        const sent = await sendMessageToConversation(db, item.account_id, {
          conversationId: item.conversation_id,
          messageType: item.message_type,
          contentText: item.content_text ?? undefined,
          mediaUrl: item.media_url ?? undefined,
          filename: item.filename ?? undefined,
        })
        await db
          .from('scheduled_messages')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            sent_message_id: sent.messageId ?? null,
            error_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id)
        result.sent++
      } catch (err) {
        const reason =
          err instanceof SendMessageError || err instanceof Error
            ? err.message
            : String(err)
        console.error(`[scheduled-messages] ${item.id} failed:`, reason)
        await markFailed(db, item.id, reason)
        blockedBy = reason
        result.failed++
      }
    }
  }
  return result
}

async function markFailed(db: SupabaseClient, id: string, reason: string) {
  await db
    .from('scheduled_messages')
    .update({
      status: 'failed',
      error_message: reason.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
}
