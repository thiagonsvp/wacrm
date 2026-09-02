import { NextResponse } from 'next/server';
import { requireModule, toErrorResponse } from '@/lib/auth/account';

const COLUMNS =
  'id,name,prompt,last_result,last_generated_at,created_at,updated_at';

function validatedFields(body: unknown) {
  const value = body && typeof body === 'object' ? body : {};
  const name =
    typeof (value as { name?: unknown }).name === 'string'
      ? (value as { name: string }).name.trim()
      : '';
  const prompt =
    typeof (value as { prompt?: unknown }).prompt === 'string'
      ? (value as { prompt: string }).prompt.trim()
      : '';

  if (!name || name.length > 80) {
    return { error: 'O nome deve ter entre 1 e 80 caracteres.' } as const;
  }
  if (prompt.length < 10 || prompt.length > 4000) {
    return { error: 'O prompt deve ter entre 10 e 4.000 caracteres.' } as const;
  }
  return { name, prompt } as const;
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireModule('custom-reports');
    const { data, error } = await supabase
      .from('custom_reports')
      .select(COLUMNS)
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ reports: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } =
      await requireModule('custom-reports');
    const fields = validatedFields(await request.json().catch(() => null));
    if ('error' in fields) {
      return NextResponse.json({ error: fields.error }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('custom_reports')
      .insert({
        account_id: accountId,
        created_by: userId,
        name: fields.name,
        prompt: fields.prompt,
      })
      .select(COLUMNS)
      .single();
    if (error) throw error;
    return NextResponse.json({ report: data }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireModule('custom-reports');
    const body = await request.json().catch(() => null);
    const id =
      body && typeof body.id === 'string' && body.id.trim()
        ? body.id.trim()
        : '';
    if (!id) {
      return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });
    }
    const fields = validatedFields(body);
    if ('error' in fields) {
      return NextResponse.json({ error: fields.error }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('custom_reports')
      .update({ name: fields.name, prompt: fields.prompt })
      .eq('id', id)
      .eq('account_id', accountId)
      .select(COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: 'Relatório não encontrado.' },
        { status: 404 }
      );
    }
    return NextResponse.json({ report: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
