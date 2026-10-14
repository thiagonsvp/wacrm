import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const send = vi.fn()
vi.mock('@/lib/whatsapp/send-message', () => ({
  sendMessageToConversation: (...args: unknown[]) => send(...args),
  SendMessageError: class SendMessageError extends Error {},
}))

import { dispatchDueScheduledMessages, type ScheduledMessageRow } from './dispatch'

function row(over: Partial<ScheduledMessageRow>): ScheduledMessageRow {
  return {
    id: 'x',
    account_id: 'acc',
    conversation_id: 'conv',
    created_by: 'u',
    group_id: 'g1',
    position: 0,
    message_type: 'text',
    content_text: '*Ana:*\noi',
    media_url: null,
    media_path: null,
    filename: null,
    send_at: '2026-10-14T12:00:00Z',
    status: 'sending',
    attempts: 1,
    error_message: null,
    sent_message_id: null,
    sent_at: null,
    created_at: '2026-10-14T11:00:00Z',
    ...over,
  }
}

/** Records every update (id → patch) and serves the claimed rows. */
function fakeDb(claimed: ScheduledMessageRow[]) {
  const updates: { id?: string; patch: Record<string, unknown> }[] = []
  const rpc = vi.fn(async () => ({ data: claimed, error: null }))
  const db = {
    rpc,
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        const entry: { id?: string; patch: Record<string, unknown> } = { patch }
        updates.push(entry)
        const chain = {
          eq: (col: string, val: string) => {
            if (col === 'id') entry.id = val
            return chain
          },
          lt: () => chain,
          then: (resolve: (v: unknown) => void) => resolve({ error: null }),
        }
        return chain
      },
    }),
  }
  return { db: db as unknown as SupabaseClient, updates, rpc }
}

const statusOf = (updates: { id?: string; patch: Record<string, unknown> }[], id: string) =>
  updates.filter((u) => u.id === id).at(-1)?.patch.status

beforeEach(() => send.mockReset())

describe('dispatchDueScheduledMessages', () => {
  it('sends the items of a schedule in position order', async () => {
    send.mockResolvedValue({ messageId: 'm' })
    const { db, updates } = fakeDb([
      row({ id: 'b', position: 1, message_type: 'audio', media_url: 'https://x/a.ogg', content_text: null }),
      row({ id: 'a', position: 0 }),
    ])
    const out = await dispatchDueScheduledMessages(db)
    expect(send.mock.calls.map((c) => (c[2] as { messageType: string }).messageType)).toEqual(['text', 'audio'])
    expect(out).toEqual({ claimed: 2, sent: 2, failed: 0 })
    expect(statusOf(updates, 'a')).toBe('sent')
    expect(statusOf(updates, 'b')).toBe('sent')
  })

  it('holds back the rest of a schedule when one item fails', async () => {
    send.mockRejectedValueOnce(new Error('número inválido'))
    const { db, updates } = fakeDb([row({ id: 'a', position: 0 }), row({ id: 'b', position: 1 })])
    const out = await dispatchDueScheduledMessages(db)
    expect(send).toHaveBeenCalledTimes(1)
    expect(out.failed).toBe(2)
    expect(statusOf(updates, 'a')).toBe('failed')
    expect(statusOf(updates, 'b')).toBe('failed')
  })

  it('does not let one schedule failing stop another', async () => {
    send.mockRejectedValueOnce(new Error('falhou')).mockResolvedValue({ messageId: 'm' })
    const { db, updates } = fakeDb([row({ id: 'a', group_id: 'g1' }), row({ id: 'c', group_id: 'g2' })])
    await dispatchDueScheduledMessages(db)
    expect(statusOf(updates, 'c')).toBe('sent')
  })

  it('claims only the given account when called from an inbox', async () => {
    const { db, rpc } = fakeDb([])
    await dispatchDueScheduledMessages(db, { accountId: 'acc-1' })
    expect(rpc).toHaveBeenCalledWith('claim_due_scheduled_messages', { p_limit: 50, p_account_id: 'acc-1' })
  })
})
