import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const MISSING_TABLE = '42P01';
const DEFAULT_MESSAGE =
  'Olá! Vim pelo Google Ads e gostaria de mais informações.';

function digits(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { data, error } = await supabase
      .from('google_ads_whatsapp_settings')
      .select('phone, message')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error?.code === MISSING_TABLE)
      return NextResponse.json({
        configured: false,
        migration_pending: true,
        message: DEFAULT_MESSAGE,
      });
    if (error) throw error;
    return NextResponse.json({
      configured: !!data,
      phone: data?.phone ?? '',
      message: data?.message ?? DEFAULT_MESSAGE,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(
      `google-ads-whatsapp:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body)
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    const phone = digits(body.phone);
    const message =
      typeof body.message === 'string' ? body.message.trim().slice(0, 500) : '';
    if (!/^\d{8,15}$/.test(phone))
      return NextResponse.json(
        { error: 'Informe o telefone com DDI e DDD, usando apenas números.' },
        { status: 400 }
      );
    if (!message)
      return NextResponse.json(
        { error: 'Informe a mensagem inicial do WhatsApp.' },
        { status: 400 }
      );

    const { error } = await supabase
      .from('google_ads_whatsapp_settings')
      .upsert(
        { account_id: accountId, phone, message },
        { onConflict: 'account_id' }
      );
    if (error?.code === MISSING_TABLE)
      return NextResponse.json(
        { error: 'Execute a migração 074_google_ads_whatsapp_protocols.sql.' },
        { status: 400 }
      );
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
