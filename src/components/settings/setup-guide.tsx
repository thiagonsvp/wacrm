'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Circle,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SettingsPanelHead } from './settings-panel-head';
import type { SettingsSection } from './settings-sections';

/**
 * Onboarding checklist for a fresh deployment.
 *
 * This CRM is deployed once per client, so the same handful of steps get
 * repeated for every new one — and each involves a credential from a
 * different console. The value here is not the status dots but the
 * "where do I get this" answer next to each step, so setting up client
 * number five doesn't mean re-deriving what a Dataset ID is.
 *
 * Every check is a real query against this account. A step is only green
 * when the thing actually works, never merely because a form was saved.
 */

type StepState = 'done' | 'todo' | 'warn' | 'loading';

interface StepStatus {
  state: StepState;
  detail?: string;
}

interface Checks {
  whatsapp: StepStatus;
  stages: StepStatus;
  ai: StepStatus;
  pipeline: StepStatus;
  meta: StepStatus;
}

const LOADING: StepStatus = { state: 'loading' };

function StatusIcon({ state }: { state: StepState }) {
  if (state === 'loading') {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }
  if (state === 'done') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15">
        <Check className="h-3 w-3 text-emerald-500" />
      </span>
    );
  }
  if (state === 'warn') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/15">
        <AlertTriangle className="h-3 w-3 text-amber-500" />
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted">
      <Circle className="h-2.5 w-2.5 text-muted-foreground" />
    </span>
  );
}

function Step({
  index,
  title,
  what,
  where,
  status,
  actionLabel,
  onAction,
  externalHref,
}: {
  index: number;
  title: string;
  what: string;
  where?: string;
  status: StepStatus;
  actionLabel: string;
  onAction?: () => void;
  externalHref?: string;
}) {
  return (
    <Card
      className={cn(
        'p-4',
        status.state === 'done' && 'border-emerald-500/25',
        status.state === 'warn' && 'border-amber-500/25',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          <StatusIcon state={status.state} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {index}
            </span>
            <h3 className="text-sm font-medium text-foreground">{title}</h3>
          </div>

          <p className="mt-1 text-sm text-muted-foreground">{what}</p>

          {where && (
            <p className="mt-2 rounded-md bg-muted/60 px-2.5 py-2 text-xs text-muted-foreground">
              {where}
            </p>
          )}

          {status.detail && (
            <p
              className={cn(
                'mt-2 text-xs',
                status.state === 'done' && 'text-emerald-600 dark:text-emerald-400',
                status.state === 'warn' && 'text-amber-600 dark:text-amber-400',
                status.state === 'todo' && 'text-muted-foreground',
              )}
            >
              {status.detail}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {onAction && (
              <Button size="sm" variant="outline" onClick={onAction}>
                {actionLabel}
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            )}
            {externalHref && (
              <a
                href={externalHref}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm text-foreground transition-colors hover:bg-muted"
              >
                {actionLabel}
                <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function SetupGuide({
  onSelect,
}: {
  onSelect: (section: SettingsSection) => void;
}) {
  const { accountId } = useAuth();
  const t = useTranslations('Settings.setup');

  const [checks, setChecks] = useState<Checks>({
    whatsapp: LOADING,
    stages: LOADING,
    ai: LOADING,
    pipeline: LOADING,
    meta: LOADING,
  });

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;

    (async () => {
      const supabase = createClient();

      const [waRes, stagesRes, aiRes, metaRes] = await Promise.allSettled([
        supabase
          .from('whatsapp_config')
          .select('provider, status')
          .eq('account_id', accountId)
          .maybeSingle(),
        supabase
          .from('pipeline_stages')
          .select('id, name, pipeline_id')
          .order('position'),
        fetch('/api/ai/config', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/meta/capi/config', { cache: 'no-store' }).then((r) => r.json()),
      ]);
      if (cancelled) return;

      // 1 — WhatsApp
      const wa =
        waRes.status === 'fulfilled' ? (waRes.value.data as Record<string, unknown> | null) : null;
      const whatsapp: StepStatus = wa
        ? wa.status === 'connected'
          ? { state: 'done', detail: t('whatsappOk', { provider: String(wa.provider ?? '') }) }
          : { state: 'warn', detail: t('whatsappDisconnected') }
        : { state: 'todo' };

      // 2 — the board must have the three stages the pipeline drives
      const stageRows =
        stagesRes.status === 'fulfilled'
          ? ((stagesRes.value.data ?? []) as { name: string }[])
          : [];
      const norm = (s: string) =>
        s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
      const names = new Set(stageRows.map((s) => norm(s.name)));
      const missing = [
        ['lead qualificado', 'qualificado'],
        ['negociacao', 'em negociacao'],
        ['finalizado', 'fechado', 'ganho'],
      ].filter((aliases) => !aliases.some((a) => names.has(a)));
      const stages: StepStatus =
        stageRows.length === 0
          ? { state: 'todo' }
          : missing.length === 0
            ? { state: 'done', detail: t('stagesOk', { count: stageRows.length }) }
            : { state: 'warn', detail: t('stagesMissing') };

      // 3 / 4 — AI key, then the pipeline switch on top of it
      const ai = aiRes.status === 'fulfilled' ? aiRes.value : null;
      const aiStep: StepStatus = !ai?.configured
        ? { state: 'todo' }
        : !ai.has_key
          ? { state: 'warn', detail: t('aiNoKey') }
          : !ai.is_active
            ? { state: 'warn', detail: t('aiInactive') }
            : { state: 'done', detail: t('aiOk', { model: String(ai.model ?? '') }) };

      const pipeline: StepStatus = !ai?.configured
        ? { state: 'todo' }
        : ai.deal_pipeline_enabled
          ? { state: 'done', detail: t('pipelineOk') }
          : { state: 'todo', detail: t('pipelineOff') };

      // 5 — Meta conversions
      const meta = metaRes.status === 'fulfilled' ? metaRes.value : null;
      const metaStep: StepStatus = meta?.migration_pending
        ? { state: 'warn', detail: t('metaMigration') }
        : !meta?.configured
          ? { state: 'todo' }
          : !meta.is_active
            ? { state: 'warn', detail: t('metaInactive') }
            : !meta.waba_id
              ? { state: 'warn', detail: t('metaNoWaba') }
              : { state: 'done', detail: t('metaOk') };

      setChecks({ whatsapp, stages, ai: aiStep, pipeline, meta: metaStep });
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, t]);

  const total = 5;
  const done = Object.values(checks).filter((c) => c.state === 'done').length;

  return (
    <div>
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <span className="text-sm text-muted-foreground">
            {t('progress', { done, total })}
          </span>
        }
      />

      <div className="space-y-3">
        <Step
          index={1}
          title={t('s1Title')}
          what={t('s1What')}
          where={t('s1Where')}
          status={checks.whatsapp}
          actionLabel={t('goConfigure')}
          onAction={() => onSelect('whatsapp')}
        />
        <Step
          index={2}
          title={t('s2Title')}
          what={t('s2What')}
          where={t('s2Where')}
          status={checks.stages}
          actionLabel={t('goPipelines')}
          externalHref="/pipelines"
        />
        <Step
          index={3}
          title={t('s3Title')}
          what={t('s3What')}
          where={t('s3Where')}
          status={checks.ai}
          actionLabel={t('goAgents')}
          externalHref="/agents"
        />
        <Step
          index={4}
          title={t('s4Title')}
          what={t('s4What')}
          where={t('s4Where')}
          status={checks.pipeline}
          actionLabel={t('goAgents')}
          externalHref="/agents"
        />
        <Step
          index={5}
          title={t('s5Title')}
          what={t('s5What')}
          where={t('s5Where')}
          status={checks.meta}
          actionLabel={t('goConfigure')}
          onAction={() => onSelect('meta-ads')}
        />
      </div>

      <Card className="mt-4 p-4">
        <h3 className="text-sm font-medium text-foreground">{t('migrationsTitle')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('migrationsDesc')}</p>
        <code className="mt-2 block whitespace-pre-wrap text-xs text-muted-foreground">
          supabase/migrations/*.sql
        </code>
      </Card>
    </div>
  );
}
