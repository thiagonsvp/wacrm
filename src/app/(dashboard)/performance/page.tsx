'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  CalendarDays,
  Download,
  Eye,
  Handshake,
  MousePointerClick,
  RefreshCw,
  Target,
  TrendingUp,
  Trophy,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { KpiTile } from '@/components/performance/kpi-tile'
import { FunnelBars } from '@/components/performance/funnel-bars'
import { OriginSplit } from '@/components/performance/origin-split'
import { BreakdownTable } from '@/components/performance/breakdown-table'
import { FunnelTrend, SpendTrend } from '@/components/performance/trend-charts'
import {
  cac,
  cpc,
  cpl,
  cpm,
  ctr,
  reachedNegotiating,
  reachedQualified,
  roas,
  ticket,
} from '@/lib/performance/merge'
import { decimal, money, moneyOrDash, percent, quantity } from '@/lib/performance/format'
import { usePerformanceReport, type AdSource } from '@/hooks/use-performance-report'
import { cn } from '@/lib/utils'

// ============================================================
// Ads performance report.
//
// Two sources, one join key. Windsor.ai supplies the media side
// (spend, impressions, clicks per ad); the CRM supplies what those
// leads became (qualified, negotiating, sold). They meet on the Meta
// AD ID — `ad_id` on one side, `contacts.acquisition_source_id` on
// the other.
//
// The previous version joined `contacts.acquisition_campaign` against
// Windsor's `campaign`. That field is not a campaign name: it is the
// ad's HEADLINE, the line WhatsApp shows above the referral card
// ("Converse conosco"). It never equals a campaign name, so the leads
// column was structurally always zero and every cost-per-lead on the
// page was silently wrong.
// ============================================================

const PRESETS = [
  { days: 7, label: '7 dias' },
  { days: 14, label: '14 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
] as const

const iso = (date: Date) => date.toLocaleDateString('en-CA')

function daysAgo(days: number): { from: string; to: string } {
  const today = new Date()
  const start = new Date(today)
  start.setDate(today.getDate() - (days - 1))
  return { from: iso(start), to: iso(today) }
}

export default function PerformancePage() {
  const initial = daysAgo(30)
  const [source, setSource] = useState<AdSource>('meta')
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  // "Atualizar" re-runs the same query, so it needs something to change;
  // that one run also bypasses the server's Windsor cache.
  const [nonce, setNonce] = useState(0)
  const [freshNonce, setFreshNonce] = useState(-1)

  const {
    availableSources,
    funnel,
    mediaError,
    crmError,
    crmLoading,
    mediaLoading,
    loading,
    totals,
    counts,
    currency,
    stageNames,
    campaigns,
    creatives,
    trend,
  } = usePerformanceReport({
    source,
    from,
    to,
    nonce,
    fresh: freshNonce === nonce,
    onSources: (sources) => {
      if (sources.length) setSource((cur) => (sources.includes(cur) ? cur : sources[0]))
    },
  })

  const combined = { ...counts, spend: totals.spend }

  const applyPreset = (days: number) => {
    const range = daysAgo(days)
    setFrom(range.from)
    setTo(range.to)
  }
  const activePreset = PRESETS.find((p) => {
    const range = daysAgo(p.days)
    return range.from === from && range.to === to
  })?.days

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Performance de anúncios</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Mídia do Windsor.ai cruzada com o funil do CRM pelo ID do anúncio
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {availableSources && availableSources.length > 0 ? (
          <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1">
            {availableSources.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setSource(option)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  source === option
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option === 'meta' ? 'Meta Ads' : 'Google Ads'}
              </button>
            ))}
          </div>
          ) : null}
          <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1">
            {PRESETS.map((preset) => (
              <button
                key={preset.days}
                type="button"
                onClick={() => applyPreset(preset.days)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  activePreset === preset.days
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <span className="flex items-center gap-1 text-muted-foreground">
            <CalendarDays className="h-4 w-4" aria-hidden />
            <Input
              aria-label="Data inicial"
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 w-36"
            />
            <span className="text-xs">até</span>
            <Input
              aria-label="Data final"
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 w-36"
            />
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setFreshNonce(nonce + 1)
              setNonce(nonce + 1)
            }}
            disabled={loading}
          >
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} />
            Atualizar
          </Button>
          <Link
            href={`/report/performance?source=${source}&from=${from}&to=${to}`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar
          </Link>
        </div>
      </header>

      {(mediaError || crmError) && (
        <div className="space-y-2">
          {mediaError && <Notice text={mediaError} />}
          {crmError && <Notice text={crmError} />}
        </div>
      )}
      {!crmError && !crmLoading && !stageNames && (
        <Notice text="Nenhum funil reconhecido no quadro de negócios: as colunas de qualificação, negociação e finalização não foram encontradas. Defina-as em Configurações › IA para ver as etapas por campanha." />
      )}

      {/* Primary KPIs — what the money did, end to end. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiTile
          label="Investimento"
          value={money(totals.spend, currency)}
          hint={`${quantity(totals.impressions)} impressões · ${quantity(totals.clicks)} cliques`}
          icon={Wallet}
          accent="var(--viz-cat-2)"
          loading={mediaLoading}
        />
        <KpiTile
          label="Leads"
          value={quantity(counts.leads)}
          hint={`Custo por lead ${moneyOrDash(cpl(combined), currency)}`}
          icon={Users}
          accent="var(--viz-funnel-1)"
          loading={crmLoading}
        />
        <KpiTile
          label={stageNames?.negotiating ?? 'Em negociação'}
          value={quantity(reachedNegotiating(counts))}
          hint={`${quantity(reachedQualified(counts))} qualificados antes disso`}
          icon={Handshake}
          accent="var(--viz-funnel-3)"
          loading={crmLoading}
        />
        <KpiTile
          label="Vendas"
          value={quantity(counts.won)}
          hint={`CAC ${moneyOrDash(cac(combined), currency)} · ticket ${moneyOrDash(ticket(counts), currency)}`}
          icon={Trophy}
          accent="var(--viz-funnel-4)"
          loading={crmLoading}
        />
        <KpiTile
          label="Receita e ROAS"
          value={money(counts.revenue, currency)}
          hint={
            roas({ revenue: counts.revenue, spend: totals.spend }) === null
              ? 'Sem investimento no período'
              : `${decimal(roas({ revenue: counts.revenue, spend: totals.spend }))}× o investido · ${money(counts.openValue, currency)} em aberto`
          }
          icon={TrendingUp}
          accent="var(--viz-good)"
          loading={crmLoading}
        />
      </div>

      {/* Secondary strip — the media mechanics behind the numbers above. */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
        <KpiTile compact label="Impressões" value={quantity(totals.impressions)} icon={Eye} accent="var(--viz-cat-2)" loading={mediaLoading} />
        <KpiTile compact label="Alcance" value={quantity(totals.reach)} icon={Eye} accent="var(--viz-cat-2)" loading={mediaLoading} />
        <KpiTile compact label="Cliques" value={quantity(totals.clicks)} icon={MousePointerClick} accent="var(--viz-cat-2)" loading={mediaLoading} />
        <KpiTile compact label="CTR" value={percent(ctr(totals), 2)} icon={Target} accent="var(--viz-cat-2)" loading={mediaLoading} />
        <KpiTile compact label="CPC" value={moneyOrDash(cpc(totals), currency)} icon={MousePointerClick} accent="var(--viz-cat-2)" loading={mediaLoading} />
        <KpiTile compact label="CPM" value={moneyOrDash(cpm(totals), currency)} icon={Eye} accent="var(--viz-cat-2)" loading={mediaLoading} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <FunnelBars counts={counts} currency={currency} stageNames={stageNames} loading={crmLoading} />
        <div className="xl:col-span-2">
          <SpendTrend data={trend} currency={currency} loading={mediaLoading} />
        </div>
        <OriginSplit
          origins={funnel.origins}
          totals={counts}
          organic={funnel.organic}
          excludedContacts={funnel.excludedContacts}
          loading={crmLoading}
        />
        <div className="xl:col-span-2">
          <FunnelTrend data={trend} loading={crmLoading} />
        </div>
      </div>

      <BreakdownTable
        title="Campanhas"
        description="Investimento e funil por campanha — leads chegam pelo ID do anúncio"
        rows={campaigns}
        currency={currency}
        loading={loading}
        emptyHint="Nenhuma campanha com dados no período selecionado."
      />

      <BreakdownTable
        title="Criativos"
        description="Um anúncio por linha, com o criativo veiculado"
        rows={creatives}
        currency={currency}
        loading={loading}
        withThumbnails
        emptyHint="Nenhum criativo com dados no período selecionado."
      />

      <p className="px-1 pb-2 text-xs leading-relaxed text-muted-foreground">
        <UserCheck className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
        Leads são contados pela data em que entraram, e carregam o resultado que tiveram depois —
        uma venda fechada hoje conta para o dia do anúncio que a originou. Por isso os dias mais
        recentes tendem a subir com o tempo. Qualificados e em negociação são acumulados: quem já
        avançou continua contado nas etapas anteriores.
      </p>
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return (
    <div
      className="flex items-start gap-2.5 rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10"
      role="status"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--viz-warning)' }} aria-hidden />
      <span className="text-muted-foreground">{text}</span>
    </div>
  )
}
