import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendMetaMessage } from '@/lib/messaging/meta-send'

/**
 * Reply on Instagram Direct or Messenger.
 *
 * A separate route from /api/whatsapp/send rather than a branch inside
 * it: that one is built around phone numbers, WhatsApp templates and the
 * provider abstraction, none of which apply here. Sharing it would mean
 * threading a channel flag through every layer to skip most of them.
 *
 * The conversation's own `channel` decides — never a value from the
 * client — so a caller cannot ask for a WhatsApp thread to be answered
 * through Meta, or the reverse.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')

    const limit = checkRateLimit(`messaging-send:${ctx.userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const conversationId =
      typeof body?.conversation_id === 'string' ? body.conversation_id : ''
    const text = typeof body?.text === 'string' ? body.text.trim() : ''

    if (!conversationId || !text) {
      return NextResponse.json(
        { error: 'conversation_id and text are required' },
        { status: 400 },
      )
    }

    const { data: conversation } = await ctx.supabase
      .from('conversations')
      .select('id, channel, contact_id, account_id')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    if (conversation.channel !== 'instagram' && conversation.channel !== 'messenger') {
      return NextResponse.json(
        { error: 'This conversation is not an Instagram or Messenger thread' },
        { status: 400 },
      )
    }

    const { data: contact } = await ctx.supabase
      .from('contacts')
      .select('external_id')
      .eq('id', conversation.contact_id)
      .maybeSingle()

    if (!contact?.external_id) {
      return NextResponse.json(
        { error: 'Contact has no Instagram/Messenger id' },
        { status: 400 },
      )
    }

    const { data: config } = await ctx.supabase
      .from('meta_messaging_configs')
      .select('page_id, page_access_token, is_active')
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (!config?.is_active || !config.page_id || !config.page_access_token) {
      return NextResponse.json(
        { error: 'Meta messaging is not configured for this company' },
        { status: 400 },
      )
    }

    // The reply window is measured from the customer's last message, not
    // from any activity in the thread — an agent's own replies must not
    // extend the window Meta is enforcing.
    const { data: lastInbound } = await ctx.supabase
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let token: string
    try {
      token = decrypt(config.page_access_token)
    } catch {
      return NextResponse.json(
        { error: 'Stored page token could not be decrypted — re-enter it.' },
        { status: 400 },
      )
    }

    const result = await sendMetaMessage({
      pageId: config.page_id,
      accessToken: token,
      recipientId: contact.external_id,
      text,
      channel: conversation.channel,
      lastInboundAt: lastInbound?.created_at ? new Date(lastInbound.created_at) : null,
    })

    // Recorded either way: a failed reply the agent can see and retry is
    // better than one that silently vanishes from the thread.
    const { data: saved } = await ctx.supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        content_type: 'text',
        content_text: text,
        message_id: result.messageId ?? `local-${Date.now()}`,
        status: result.ok ? 'sent' : 'failed',
      })
      .select()
      .single()

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, message: saved },
        { status: result.retryable ? 503 : 400 },
      )
    }

    await ctx.supabase
      .from('conversations')
      .update({
        last_message_text: text,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)

    return NextResponse.json({ message: saved })
  } catch (err) {
    return toErrorResponse(err)
  }
}
