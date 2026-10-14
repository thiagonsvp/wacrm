'use client'

import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  AlertCircle,
  Download,
  Eye,
  Handshake,
  Loader2,
  MousePointerClick,
  Target,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { AuthProvider, useAuth } from '@/hooks/use-auth'
import { usePerformanceReport, type AdSource } from '@/hooks/use-performance-report'
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

// ============================================================
// Printable ads-performance report.
//
// Only the report — no sidebar, header or other CRM chrome — laid out
// for "Salvar como PDF". Data comes from the same hook as the
// Performance page, so the export always matches what was on screen.
// Opened in its own tab, it forces the light palette on that tab only
// (a printed report on a dark background wastes ink and reads badly);
// the user's saved preference is untouched.
// ============================================================

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function brDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export default function PerformanceReportPage() {
  return (
    <AuthProvider>
      <Suspense fallback={<FullScreenLoader />}>
        <Report />
      </Suspense>
    </AuthProvider>
  )
}

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
    </div>
  )
}

function Report() {
  const params = useSearchParams()
  const source: AdSource = params.get('source') === 'google' ? 'google' : 'meta'
  const from = ISO_DAY.test(params.get('from') ?? '') ? params.get('from')! : ''
  const to = ISO_DAY.test(params.get('to') ?? '') ? params.get('to')! : ''
  const { account } = useAuth()
  const [generatedAt] = useState(() => new Date())

  // Light palette for this tab only — see the header comment.
  useEffect(() => {
    const root = document.documentElement
    const previous = root.dataset.mode
    root.dataset.mode = 'light'
    return () => {
      if (previous) root.dataset.mode = previous
    }
  }, [])

  const r = usePerformanceReport({ source, from, to })
  const combined = { ...r.counts, spend: r.totals.spend }
  const sourceLabel = source === 'google' ? 'Google Ads' : 'Meta Ads'

  useEffect(() => {
    document.title = `Relatório de anúncios — ${account?.name ?? 'CRM'} — ${brDate(from)} a ${brDate(to)}`
  }, [account?.name, from, to])

  if (!from || !to) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-6 text-sm text-slate-600">
        Período inválido. Abra o relatório pelo botão &quot;Exportar&quot; da Performance de anúncios.
      </div>
    )
  }

  const roasValue = roas({ revenue: r.counts.revenue, spend: r.totals.spend })

  return (
    <div className="report-root min-h-screen bg-slate-100 text-slate-900 print:bg-white">
      <style>{PRINT_CSS}</style>

      {/* Toolbar — screen only. */}
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-[1040px] items-center justify-between gap-3 px-6 py-3">
          <p className="text-sm text-slate-600">
            {r.loading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando os dados do relatório…
              </span>
            ) : (
              'Relatório pronto. Use "Baixar PDF" e escolha "Salvar como PDF".'
            )}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.close()}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              <X className="h-4 w-4" /> Fechar
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={r.loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> Baixar PDF
            </button>
          </div>
        </div>
      </div>

      <main className="report-page mx-auto my-8 max-w-[1040px] overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 print:my-0 print:rounded-none print:shadow-none print:ring-0">
        {/* Cover band */}
        <header className="relative overflow-hidden bg-gradient-to-br from-violet-700 via-violet-600 to-fuchsia-600 px-10 py-9 text-white">
          <div
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -bottom-32 right-40 h-64 w-64 rounded-full bg-white/5"
            aria-hidden
          />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-100">
            Relatório de performance de anúncios
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{account?.name ?? '—'}</h1>
          <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-sm text-violet-50">
            <Meta label="Período" value={`${brDate(from)} a ${brDate(to)}`} />
            <Meta label="Plataforma" value={sourceLabel} />
            <Meta
              label="Gerado em"
              value={generatedAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            />
          </div>
        </header>

        <div className="space-y-8 px-10 py-9">
          {(r.mediaError || r.crmError) && (
            <div className="space-y-2">
              {r.mediaError && <Notice text={r.mediaError} />}
              {r.crmError && <Notice text={r.crmError} />}
            </div>
          )}

          {/* Executive summary */}
          <Section title="Resumo" subtitle="Do investimento à venda, no período">
            <div className="grid grid-cols-5 gap-3">
              <BigKpi
                icon={Wallet}
                label="Investimento"
                value={money(r.totals.spend, r.currency)}
                hint={`${quantity(r.totals.clicks)} cliques`}
                loading={r.mediaLoading}
              />
              <BigKpi
                icon={Users}
                label="Leads"
                value={quantity(r.counts.leads)}
                hint={`CPL ${moneyOrDash(cpl(combined), r.currency)}`}
                loading={r.crmLoading}
              />
              <BigKpi
                icon={Handshake}
                label={r.stageNames?.negotiating ?? 'Em negociação'}
                value={quantity(reachedNegotiating(r.counts))}
                hint={`${quantity(reachedQualified(r.counts))} qualificados`}
                loading={r.crmLoading}
              />
              <BigKpi
                icon={Trophy}
                label="Vendas"
                value={quantity(r.counts.won)}
                hint={`CAC ${moneyOrDash(cac(combined), r.currency)} · ticket ${moneyOrDash(ticket(r.counts), r.currency)}`}
                loading={r.crmLoading}
              />
              <BigKpi
                icon={TrendingUp}
                label="Receita"
                value={money(r.counts.revenue, r.currency)}
                hint={roasValue === null ? 'Sem investimento' : `ROAS ${decimal(roasValue)}×`}
                loading={r.crmLoading}
                highlight
              />
            </div>
          </Section>

          <Section title="Mídia" subtitle={`Entrega e custo em ${sourceLabel}`}>
            <div className="grid grid-cols-6 gap-3">
              <SmallKpi icon={Eye} label="Impressões" value={quantity(r.totals.impressions)} loading={r.mediaLoading} />
              <SmallKpi icon={Eye} label="Alcance" value={quantity(r.totals.reach)} loading={r.mediaLoading} />
              <SmallKpi icon={MousePointerClick} label="Cliques" value={quantity(r.totals.clicks)} loading={r.mediaLoading} />
              <SmallKpi icon={Target} label="CTR" value={percent(ctr(r.totals), 2)} loading={r.mediaLoading} />
              <SmallKpi icon={MousePointerClick} label="CPC" value={moneyOrDash(cpc(r.totals), r.currency)} loading={r.mediaLoading} />
              <SmallKpi icon={Eye} label="CPM" value={moneyOrDash(cpm(r.totals), r.currency)} loading={r.mediaLoading} />
            </div>
          </Section>

          <div className="report-avoid-break grid grid-cols-5 gap-4">
            <div className="col-span-2">
              <FunnelBars
                counts={r.counts}
                currency={r.currency}
                stageNames={r.stageNames}
                loading={r.crmLoading}
              />
            </div>
            <div className="col-span-3">
              <OriginSplit
                origins={r.funnel.origins}
                totals={r.counts}
                organic={r.funnel.organic}
                excludedContacts={r.funnel.excludedContacts}
                loading={r.crmLoading}
              />
            </div>
          </div>

          <div className="report-avoid-break space-y-4">
            <SpendTrend data={r.trend} currency={r.currency} loading={r.mediaLoading} />
            <FunnelTrend data={r.trend} loading={r.crmLoading} />
          </div>

          <div className="report-break-before">
            <BreakdownTable
              title="Campanhas"
              description="Investimento e funil por campanha"
              rows={r.campaigns}
              currency={r.currency}
              loading={r.loading}
              emptyHint="Nenhuma campanha com dados no período."
              printAll
            />
          </div>

          <BreakdownTable
            title="Criativos"
            description="Um anúncio por linha, com o criativo veiculado"
            rows={r.creatives}
            currency={r.currency}
            loading={r.loading}
            withThumbnails
            emptyHint="Nenhum criativo com dados no período."
            printAll
          />

          <footer className="border-t border-slate-200 pt-5 text-xs leading-relaxed text-slate-500">
            Leads são contados pela data em que entraram e carregam o resultado que tiveram depois —
            uma venda fechada hoje conta para o dia do anúncio que a originou. Qualificados e em
            negociação são acumulados: quem avançou continua contado nas etapas anteriores. Mídia via
            Windsor.ai, cruzada com o funil do CRM pelo ID do anúncio.
          </footer>
        </div>
      </main>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-violet-200">{label}</div>
      <div className="font-medium text-white">{value}</div>
    </div>
  )
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <section className="report-avoid-break">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <span className="text-xs text-slate-500">{subtitle}</span>
      </div>
      {children}
    </section>
  )
}

function BigKpi({
  icon: Icon,
  label,
  value,
  hint,
  loading,
  highlight = false,
}: {
  icon: typeof Wallet
  label: string
  value: string
  hint: string
  loading: boolean
  highlight?: boolean
}) {
  return (
    <div
      className={
        highlight
          ? 'rounded-xl bg-gradient-to-br from-emerald-50 to-white p-4 ring-1 ring-emerald-200'
          : 'rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200'
      }
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Icon className={highlight ? 'h-3.5 w-3.5 text-emerald-600' : 'h-3.5 w-3.5 text-violet-600'} />
        <span className="truncate">{label}</span>
      </div>
      {loading ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-slate-200" />
      ) : (
        <div className="mt-1.5 truncate text-2xl font-bold tabular-nums tracking-tight text-slate-900">
          {value}
        </div>
      )}
      <div className="mt-1 truncate text-[11px] text-slate-500">{loading ? ' ' : hint}</div>
    </div>
  )
}

function SmallKpi({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: typeof Wallet
  label: string
  value: string
  loading: boolean
}) {
  return (
    <div className="rounded-xl p-3 ring-1 ring-slate-200">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
        <Icon className="h-3 w-3 text-slate-400" />
        {label}
      </div>
      {loading ? (
        <div className="mt-1.5 h-5 w-16 animate-pulse rounded bg-slate-200" />
      ) : (
        <div className="mt-1 truncate text-lg font-semibold tabular-nums text-slate-900">{value}</div>
      )}
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      {text}
    </div>
  )
}

const PRINT_CSS = `
  @page { size: A4 landscape; margin: 8mm; }
  @media print {
    html, body { background: #fff !important; }
    .report-root { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .report-page { max-width: none !important; width: 100% !important; }
    .report-avoid-break { break-inside: avoid; }
    .report-root tr { break-inside: avoid; }
    .report-break-before { break-before: page; }
    .report-root table { min-width: 0 !important; font-size: 10px; }
    .report-root .overflow-x-auto { overflow: visible !important; }
  }
`
