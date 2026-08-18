'use client'

import { ArrowDown } from 'lucide-react'
import type { FunnelCounts } from '@/lib/performance/types'
import { reachedNegotiating, reachedQualified } from '@/lib/performance/merge'
import { money, percent, quantity } from '@/lib/performance/format'

/**
 * The funnel, as four proportional bars.
 *
 * Form: horizontal bars, not a tapered funnel graphic. A drawn funnel
 * encodes magnitude as trapezoid area, which nobody can compare by
 * eye; bar length is the one length encoding people read accurately.
 *
 * Color: an ORDINAL ramp (one hue, four lightness steps), because
 * swapping two of these stages would change what the chart means.
 * Four categorical hues would say "four unrelated categories".
 *
 * Each bar is direct-labeled with its count and its share of the step
 * above, so the drop between stages — the only number that tells you
 * where the money leaks — is readable without arithmetic.
 */

interface Step {
  label: string
  hint: string
  value: number
  color: string
}

export function FunnelBars({
  counts,
  currency,
  stageNames,
  loading,
}: {
  counts: FunnelCounts
  currency: string
  stageNames: { qualified: string; negotiating: string; closed: string } | null
  loading: boolean
}) {
  const qualified = reachedQualified(counts)
  const negotiating = reachedNegotiating(counts)

  const steps: Step[] = [
    {
      label: 'Leads',
      hint: 'contatos vindos de anúncio ou não',
      value: counts.leads,
      color: 'var(--viz-funnel-1)',
    },
    {
      label: stageNames?.qualified ?? 'Qualificados',
      hint: 'chegaram a ser qualificados',
      value: qualified,
      color: 'var(--viz-funnel-2)',
    },
    {
      label: stageNames?.negotiating ?? 'Em negociação',
      hint: 'chegaram a negociar preço',
      value: negotiating,
      color: 'var(--viz-funnel-3)',
    },
    {
      label: 'Vendas',
      hint: 'negócios ganhos',
      value: counts.won,
      color: 'var(--viz-funnel-4)',
    },
  ]

  const top = steps[0].value || 1

  return (
    <section className="flex h-full flex-col rounded-xl bg-card ring-1 ring-foreground/10">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Funil de conversão</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Acumulado: cada etapa conta quem chegou até ela, inclusive quem já avançou
        </p>
      </header>

      <div className="flex flex-1 flex-col justify-between gap-1 p-5">
        {loading ? (
          <div className="h-56 animate-pulse rounded bg-muted" />
        ) : (
          <>
            <ol className="space-y-1">
              {steps.map((step, i) => {
                const previous = i === 0 ? null : steps[i - 1].value
                const share = previous ? (previous > 0 ? step.value / previous : null) : null
                return (
                  <li key={step.label}>
                    {i > 0 && (
                      <div className="flex items-center gap-1.5 py-1 pl-1 text-[11px] text-muted-foreground">
                        <ArrowDown className="h-3 w-3" aria-hidden />
                        <span className="tabular-nums">{percent(share)}</span>
                        <span className="truncate">da etapa anterior</span>
                      </div>
                    )}
                    <div className="flex items-baseline justify-between gap-3 pb-1">
                      <span className="truncate text-xs font-medium text-foreground">
                        {step.label}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {quantity(step.value)}
                        {i > 0 && (
                          <span className="ml-1.5 text-[11px]">
                            ({percent(top > 0 ? step.value / top : null, 0)} dos leads)
                          </span>
                        )}
                      </span>
                    </div>
                    {/* Track + fill. The 2px inset ring is the surface gap the
                        marks spec asks for between touching fills. */}
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-[width] duration-500 ease-out"
                        style={{
                          width: `${Math.max(top > 0 ? (step.value / top) * 100 : 0, step.value > 0 ? 1.5 : 0)}%`,
                          background: `linear-gradient(90deg, color-mix(in oklab, ${step.color} 72%, transparent) 0%, ${step.color} 100%)`,
                        }}
                      />
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{step.hint}</p>
                  </li>
                )
              })}
            </ol>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-4 text-xs">
              <Fact label="Receita ganha" value={money(counts.revenue, currency)} />
              <Fact label="Pipeline aberto" value={money(counts.openValue, currency)} />
              <Fact label="Perdidos" value={quantity(counts.lost)} />
              <Fact label="Desqualificados" value={quantity(counts.disqualified)} />
              <Fact label="Sem negócio criado" value={quantity(counts.noDeal)} />
              <Fact label="Lead → venda" value={percent(counts.leads > 0 ? counts.won / counts.leads : null)} />
            </dl>
          </>
        )}
      </div>
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="shrink-0 font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  )
}
