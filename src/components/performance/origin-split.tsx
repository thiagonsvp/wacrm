'use client'

import type { FunnelCounts, OriginSlice } from '@/lib/performance/types'
import { percent, quantity } from '@/lib/performance/format'

/**
 * Where the leads came from, plus how much of the report the ad join
 * actually covers.
 *
 * Color is bound to the ENTITY, not to rank: Instagram is always slot
 * 1 whether it came first or last this month, so a filter that
 * reorders the list never repaints it. "Não informado" is not a
 * platform — it is the absence of one — so it takes a neutral surface
 * step rather than spending a hue on it.
 *
 * Every slice is direct-labeled with its count and share. That is
 * required, not decorative: slot 3 sits at 2.82:1 on the light
 * surface, below the 3:1 mark floor, and visible labels are the
 * relief channel that makes it legal.
 */

const SLOT: Record<string, string> = {
  Instagram: 'var(--viz-cat-1)',
  Facebook: 'var(--viz-cat-2)',
  'Meta Ads': 'var(--viz-cat-3)',
}
const NEUTRAL = 'var(--muted-foreground)'

const colorFor = (name: string) => SLOT[name] ?? NEUTRAL

export function OriginSplit({
  origins,
  totals,
  organic,
  excludedContacts,
  loading,
}: {
  origins: OriginSlice[]
  totals: FunnelCounts
  organic: FunnelCounts
  excludedContacts: number
  loading: boolean
}) {
  const total = origins.reduce((sum, o) => sum + o.leads, 0)
  const attributed = totals.leads - organic.leads

  return (
    <section className="flex h-full flex-col rounded-xl bg-card ring-1 ring-foreground/10">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Origem dos leads</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Plataforma informada pelo clique no anúncio
        </p>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-5">
        {loading ? (
          <div className="h-40 animate-pulse rounded bg-muted" />
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum lead no período selecionado.</p>
        ) : (
          <>
            {/* Proportion bar. The 2px surface gap between segments is the
                spacer the marks spec asks for on touching fills. */}
            <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
              {origins.map((origin) => (
                <span
                  key={origin.name}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                  style={{
                    width: `${(origin.leads / total) * 100}%`,
                    background: `linear-gradient(90deg, color-mix(in oklab, ${colorFor(origin.name)} 70%, transparent), ${colorFor(origin.name)})`,
                  }}
                />
              ))}
            </div>

            <ul className="space-y-2 text-xs">
              {origins.map((origin) => (
                <li key={origin.name} className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: colorFor(origin.name) }}
                  />
                  <span className="flex-1 truncate text-muted-foreground">{origin.name}</span>
                  <span className="shrink-0 font-medium tabular-nums text-foreground">
                    {quantity(origin.leads)}
                  </span>
                  <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
                    {percent(origin.leads / total, 0)}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="mt-auto space-y-2 border-t border-border pt-4 text-xs">
              <Row
                label="Com anúncio identificado"
                value={`${quantity(attributed)} · ${percent(totals.leads > 0 ? attributed / totals.leads : null, 0)}`}
              />
              <Row label="Sem atribuição (orgânico/direto)" value={quantity(organic.leads)} />
              <Row label="Vendas de leads orgânicos" value={quantity(organic.won)} />
              {excludedContacts > 0 && (
                <Row
                  label="Ignorados por tag (Fornecedor/Outros)"
                  value={quantity(excludedContacts)}
                />
              )}
            </dl>
          </>
        )}
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="shrink-0 font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  )
}
