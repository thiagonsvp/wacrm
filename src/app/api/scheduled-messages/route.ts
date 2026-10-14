import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'

/** Meta's caption cap — same limit the composer and send route enforce. */
const MEDIA_CAPTION_MAX = 1024

type ItemType = 'text' | 'image' | 'video' | 'audio' | 'document'
const ITEM_TYPES: ItemType[] = ['text', 'image', 'video', 'audio', 'document']
const MAX_ITEMS = 10
const MAX_AHEAD_MS = 365 * 24 * 3600_000

interface ItemInput {
  message_type?: string
  content_text?: string | null
  media_url?: string | null
  media_path?: string | null
  filename?: string | null
}

async function caller() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role, full_name')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile?.account_id) return null
  return { supabase, user, profile }
}

/** Scheduled messages of one conversation, newest schedule first. */
export async function GET(request: Request) {
  const ctx = await caller()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const conversationId = new URL(request.url).searchParams.get('conversation_id')
  if (!conversationId) {
    return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 })
  }
  const { data, error } = await ctx.supabase
    .from('scheduled_messages')
    .select(
      'id, group_id, position, message_type, content_text, media_url, filename, send_at, status, error_message, sent_at, created_by, created_at'
    )
    .eq('account_id', ctx.profile.account_id)
    .eq('conversation_id', conversationId)
    .neq('status', 'canceled')
    .order('send_at', { ascending: true })
    .order('position', { ascending: true })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

/**
 * Schedule one or more items to go out together on a conversation.
 * Body: { conversation_id, send_at (ISO), items: [{ message_type,
 * content_text?, media_url?, media_path?, filename? }] }.
 */
export async function POST(request: Request) {
  const ctx = await caller()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { supabase, user, profile } = ctx
  if (profile.account_role === 'viewer') {
    return NextResponse.json({ error: 'Sem permissão para enviar mensagens.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const conversationId: unknown = body?.conversation_id
  const sendAt = new Date(String(body?.send_at ?? ''))
  const items: ItemInput[] = Array.isArray(body?.items) ? body.items : []

  if (typeof conversationId !== 'string' || !conversationId) {
    return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 })
  }
  if (Number.isNaN(sendAt.getTime())) {
    return NextResponse.json({ error: 'Data e horário inválidos.' }, { status: 400 })
  }
  const ahead = sendAt.getTime() - Date.now()
  if (ahead < 30_000) {
    return NextResponse.json({ error: 'Escolha um horário no futuro.' }, { status: 400 })
  }
  if (ahead > MAX_AHEAD_MS) {
    return NextResponse.json({ error: 'O agendamento pode ser de até 1 ano.' }, { status: 400 })
  }
  if (items.length === 0 || items.length > MAX_ITEMS) {
    return NextResponse.json(
      { error: `Inclua de 1 a ${MAX_ITEMS} itens (texto, áudio ou arquivos).` },
      { status: 400 }
    )
  }
  for (const item of items) {
    if (!ITEM_TYPES.includes(item.message_type as ItemType)) {
      return NextResponse.json({ error: 'Tipo de mensagem inválido.' }, { status: 400 })
    }
    if (item.message_type === 'text' && !item.content_text?.trim()) {
      return NextResponse.json({ error: 'A mensagem de texto está vazia.' }, { status: 400 })
    }
    if (item.message_type !== 'text' && !item.media_url) {
      return NextResponse.json({ error: 'Arquivo sem endereço de envio.' }, { status: 400 })
    }
    if (item.message_type !== 'text' && (item.content_text?.length ?? 0) > MEDIA_CAPTION_MAX) {
      return NextResponse.json(
        { error: `A legenda pode ter até ${MEDIA_CAPTION_MAX} caracteres.` },
        { status: 400 }
      )
    }
  }

  const { data: conv } = await supabase
    .from('conversations')
    .select('id, assigned_agent_id')
    .eq('id', conversationId)
    .eq('account_id', profile.account_id)
    .maybeSingle()
  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  // Same rule as /api/whatsapp/send: a plain agent cannot write on a
  // teammate's lead; admin/owner can.
  const isAdminOrOwner = profile.account_role === 'admin' || profile.account_role === 'owner'
  if (conv.assigned_agent_id && conv.assigned_agent_id !== user.id && !isAdminOrOwner) {
    return NextResponse.json(
      { error: 'Esta conversa está atribuída a outro atendente.' },
      { status: 403 }
    )
  }

  // Text goes out with the same "*Name:*" signature the inbox adds.
  const senderName = profile.full_name?.trim() || user.email || 'Usuário'
  const groupId = crypto.randomUUID()
  const rows = items.map((item, position) => {
    const text = item.content_text?.trim() || null
    return {
      account_id: profile.account_id,
      conversation_id: conversationId,
      created_by: user.id,
      group_id: groupId,
      position,
      message_type: item.message_type,
      content_text:
        item.message_type === 'text'
          ? `*${senderName}:*\n${text}`
          : item.message_type === 'audio'
            ? null
            : item.message_type === 'document'
              ? text || item.filename || null
              : text,
      media_url: item.media_url ?? null,
      media_path: item.media_path ?? null,
      filename: item.filename ?? null,
      send_at: sendAt.toISOString(),
    }
  })

  // Service role: signed-in users have no write grant on this table
  // (migration 084) — the checks above are the gate.
  const { error } = await supabaseAdmin().from('scheduled_messages').insert(rows)
  if (error) {
    console.error('[scheduled-messages] insert failed:', error)
    return NextResponse.json({ error: 'Não foi possível agendar.' }, { status: 500 })
  }
  return NextResponse.json({ group_id: groupId, send_at: sendAt.toISOString() })
}
