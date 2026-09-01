'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CalendarDays,
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
import { buildTrend, FunnelTrend, SpendTrend } from '@/components/performance/trend-charts'
import {
  cac,
  cpc,
  cpl,
  cpm,
  ctr,
  groupByCampaign,
  groupByCreative,
  indexByAd,
  indexIdentity,
  mediaTotals,
  reachedNegotiating,
  reachedQualified,
  roas,
  spendByDay,
  ticket,
  toAdIdentity,
  toAdMedia,
} from '@/lib/performance/merge'
import { decimal, money, moneyOrDash, percent, quantity } from '@/lib/performance/format'
import {
  emptyCounts,
  type AdIdentity,
  type AdMedia,
  type FunnelPayload,
} from '@/lib/performance/types'
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

const emptyFunnel = (): FunnelPayload => ({
  currency: 'BRL',
  stageNames: null,
  ads: [],
  organic: emptyCounts(),
  totals: emptyCounts(),
  daily: [],
  origins: [],
  excludedContacts: 0,
})

export default function PerformancePage() {
  const initial = daysAgo(30)
  const [source, setSource] = useState<'meta' | 'google'>('meta')
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [media, setMedia] = useState<AdMedia[]>([])
  const [funnel, setFunnel] = useState<FunnelPayload>(emptyFunnel)
  const [identity, setIdentity] = useState<AdIdentity[]>([])
  const [mediaError, setMediaError] = useState('')
  const [crmError, setCrmError] = useState('')
  // "Atualizar" re-runs the same query, so it needs something to change.
  const [nonce, setNonce] = useState(0)
  const [settled, setSettled] = useState<string | null>(null)

  // `loading` is DERIVED, not stored. Storing it would mean flipping it
  // on inside the effect body, which cascades an extra render before a
  // single byte has been fetched; comparing "what we asked for" against
  // "what came back" says the same thing with no state to keep in sync,
  // and it can never get stuck on after an early return.
  const request = `${source}|${from}|${to}|${nonce}`
  const loading = settled !== request

  useEffect(() => {
    // Guards an out-of-order response: switch Meta → Google quickly and
    // the slower first reply would otherwise land last and win.
    let current = true
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

    const run = async () => {
      // Independent requests, settled independently: an unconfigured
      // Windsor connection must not blank out the CRM funnel, and a CRM
      // hiccup must not hide the media spend. Each side reports its own
      // failure and the page renders whatever did arrive.
      const [ads, crm] = await Promise.allSettled([
        fetch(`/api/windsor/performance?source=${source}&from=${from}&to=${to}`, { cache: 'no-store' }),
        fetch(`/api/performance/funnel?from=${from}&to=${to}&tz=${encodeURIComponent(tz)}`, { cache: 'no-store' }),
      ])

      const adsPayload =
        ads.status === 'fulfilled' ? await ads.value.json().catch(() => null) : null
      const crmPayload =
        crm.status === 'fulfilled' ? await crm.value.json().catch(() => null) : null

      const adsOk = ads.status === 'fulfilled' && ads.value.ok
      const crmOk = crm.status === 'fulfilled' && crm.value.ok
      const mediaRows: AdMedia[] =
        adsOk && Array.isArray(adsPayload) ? adsPayload.map(toAdMedia) : []
      const funnelPayload: FunnelPayload = crmOk ? (crmPayload as FunnelPayload) : emptyFunnel()

      // Second pass: leads whose ad id got no media row in the window.
      // A wide, id-filtered Windsor lookup recovers those ads' campaign
      // and creative names (paused ads, ads in a sibling ad account), so
      // they group under their real campaign instead of a "no match"
      // bucket. Identity only — its spend never enters the totals. Best
      // effort: if it fails, the report still renders, just less named.
      let identityRows: AdIdentity[] = []
      const known = indexByAd(mediaRows)
      const orphanIds = funnelPayload.ads
        .map((ad) => ad.adId)
        .filter((id) => !known.has(id))
      if (adsOk && orphanIds.length) {
        try {
          const res = await fetch(
            `/api/windsor/ad-identity?source=${source}&ids=${orphanIds.join(',')}`,
            { cache: 'no-store' },
          )
          const payload = await res.json().catch(() => null)
          if (res.ok && Array.isArray(payload)) identityRows = payload.map(toAdIdentity)
        } catch {
          // Leads keep their WhatsApp-headline fallback names.
        }
      }
      if (!current) return

      if (adsOk) {
        setMedia(mediaRows)
        setMediaError('')
      } else {
        setMedia([])
        setMediaError(adsPayload?.error || 'Não foi possível consultar o Windsor.ai.')
      }

      if (crmOk) {
        setFunnel(funnelPayload)
        setCrmError('')
      } else {
        setFunnel(emptyFunnel())
        setCrmError(crmPayload?.error || 'Não foi possível carregar os leads do CRM.')
      }

      setIdentity(identityRows)
      setSettled(request)
    }

    void run()
    return () => {
      current = false
    }
  }, [source, from, to, request])

  const currency = funnel.currency
  const totals = useMemo(() => mediaTotals(media), [media])
  const counts = funnel.totals
  const identityByAd = useMemo(() => indexIdentity(identity), [identity])
  const campaigns = useMemo(
    () => groupByCampaign(media, funnel.ads, identityByAd),
    [media, funnel.ads, identityByAd],
  )
  const creatives = useMemo(
    () => groupByCreative(media, funnel.ads, identityByAd),
    [media, funnel.ads, identityByAd],
  )

  const dailySpend = useMemo(() => spendByDay(media), [media])
  const trend = useMemo(() => buildTrend(funnel.daily, dailySpend), [funnel.daily, dailySpend])

  const combined = { ...counts, spend: totals.spend }
  const stageNames = funnel.stageNames

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
          <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1">
            {(['meta', 'google'] as const).map((option) => (
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
            onClick={() => setNonce((n) => n + 1)}
            disabled={loading}
          >
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} />
            Atualizar
          </Button>
        </div>
      </header>

      {(mediaError || crmError) && (
        <div className="space-y-2">
          {mediaError && <Notice text={mediaError} />}
          {crmError && <Notice text={crmError} />}
        </div>
      )}
      {!crmError && !loading && !stageNames && (
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
          loading={loading}
        />
        <KpiTile
          label="Leads"
          value={quantity(counts.leads)}
          hint={`Custo por lead ${moneyOrDash(cpl(combined), currency)}`}
          icon={Users}
          accent="var(--viz-funnel-1)"
          loading={loading}
        />
        <KpiTile
          label={stageNames?.negotiating ?? 'Em negociação'}
          value={quantity(reachedNegotiating(counts))}
          hint={`${quantity(reachedQualified(counts))} qualificados antes disso`}
          icon={Handshake}
          accent="var(--viz-funnel-3)"
          loading={loading}
        />
        <KpiTile
          label="Vendas"
          value={quantity(counts.won)}
          hint={`CAC ${moneyOrDash(cac(combined), currency)} · ticket ${moneyOrDash(ticket(counts), currency)}`}
          icon={Trophy}
          accent="var(--viz-funnel-4)"
          loading={loading}
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
          loading={loading}
        />
      </div>

      {/* Secondary strip — the media mechanics behind the numbers above. */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
        <KpiTile compact label="Impressões" value={quantity(totals.impressions)} icon={Eye} accent="var(--viz-cat-2)" loading={loading} />
        <KpiTile compact label="Alcance" value={quantity(totals.reach)} icon={Eye} accent="var(--viz-cat-2)" loading={loading} />
        <KpiTile compact label="Cliques" value={quantity(totals.clicks)} icon={MousePointerClick} accent="var(--viz-cat-2)" loading={loading} />
        <KpiTile compact label="CTR" value={percent(ctr(totals), 2)} icon={Target} accent="var(--viz-cat-2)" loading={loading} />
        <KpiTile compact label="CPC" value={moneyOrDash(cpc(totals), currency)} icon={MousePointerClick} accent="var(--viz-cat-2)" loading={loading} />
        <KpiTile compact label="CPM" value={moneyOrDash(cpm(totals), currency)} icon={Eye} accent="var(--viz-cat-2)" loading={loading} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <FunnelBars counts={counts} currency={currency} stageNames={stageNames} loading={loading} />
        <div className="xl:col-span-2">
          <SpendTrend data={trend} currency={currency} loading={loading} />
        </div>
        <OriginSplit
          origins={funnel.origins}
          totals={counts}
          organic={funnel.organic}
          excludedContacts={funnel.excludedContacts}
          loading={loading}
        />
        <div className="xl:col-span-2">
          <FunnelTrend data={trend} loading={loading} />
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
