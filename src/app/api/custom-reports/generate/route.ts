import { NextResponse } from 'next/server';
import { requireModule, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { loadAiConfig } from '@/lib/ai/config';
import { generateReply } from '@/lib/ai/generate';
import { AiError } from '@/lib/ai/types';
import {
  buildCustomReportSnapshot,
  customReportSystemPrompt,
} from '@/lib/custom-reports/snapshot';

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } =
      await requireModule('custom-reports');

    const userLimit = checkRateLimit(
      `custom-report:${userId}`,
      RATE_LIMITS.aiCustomReport
    );
    if (!userLimit.success) return rateLimitResponse(userLimit);
    const accountLimit = checkRateLimit(
      `custom-report-account:${accountId}`,
      RATE_LIMITS.aiCustomReportAccount
    );
    if (!accountLimit.success) return rateLimitResponse(accountLimit);

    const body = await request.json().catch(() => null);
    const reportId =
      body && typeof body.reportId === 'string' ? body.reportId.trim() : '';
    if (!reportId) {
      return NextResponse.json(
        { error: 'Salve o prompt antes de gerar o relatório.' },
        { status: 400 }
      );
    }

    const { data: report, error: reportError } = await supabase
      .from('custom_reports')
      .select('id,name,prompt')
      .eq('id', reportId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (reportError) throw reportError;
    if (!report) {
      return NextResponse.json(
        { error: 'Relatório não encontrado.' },
        { status: 404 }
      );
    }

    const config = await loadAiConfig(supabase, accountId, {
      requireActive: false,
    }).catch((error) => {
      console.error('[custom-report] AI config error:', error);
      throw new AiError('A chave de IA cadastrada não pôde ser lida.', {
        code: 'key_decrypt_failed',
        status: 400,
      });
    });
    if (!config) {
      return NextResponse.json(
        {
          error:
            'Configure um provedor e uma chave em Agentes de IA antes de gerar relatórios.',
          code: 'ai_not_configured',
        },
        { status: 400 }
      );
    }

    const snapshot = await buildCustomReportSnapshot(supabase, accountId);
    const { text } = await generateReply({
      config,
      systemPrompt: customReportSystemPrompt(snapshot),
      messages: [{ role: 'user', content: report.prompt }],
    });

    const generatedAt = new Date().toISOString();
    const { data: saved, error: saveError } = await supabase
      .from('custom_reports')
      .update({ last_result: text, last_generated_at: generatedAt })
      .eq('id', report.id)
      .eq('account_id', accountId)
      .select(
        'id,name,prompt,last_result,last_generated_at,created_at,updated_at'
      )
      .single();
    if (saveError) throw saveError;

    return NextResponse.json({ report: saved });
  } catch (error) {
    if (error instanceof AiError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    return toErrorResponse(error);
  }
}
