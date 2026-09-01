'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, ImageOff } from 'lucide-react'
import type { PerformanceRow } from '@/lib/performance/types'
import {
  cac,
  closeRate,
  cpl,
  ctr,
  qualificationRate,
  reachedNegotiating,
  reachedQualified,
  roas,
} from '@/lib/performance/merge'
import { decimal, money, moneyOrDash, percent, quantity } from '@/lib/performance/format'
import { cn } from '@/lib/utils'

/**
 * The campaign / creative table.
 *
 * This is the table the media buyer actually acts on, so it carries
 * the whole chain — spend → clicks → leads → qualified → negotiating →
 * sales → revenue → ROAS — on one row. Money columns are right-aligned
 * and tabular so a column of figures can be scanned vertically.
 *
 * ROAS wears a status color, not a series color: it is the one column
 * that means good-or-bad rather than "which row is this", and it ships
 * with the number itself so the state never rides on hue alone.
 */

type ColumnKey =
  | 'name'
  | 'spend'
  | 'impressions'
  | 'clicks'
  | 'ctr'
  | 'leads'
  | 'cpl'
  | 'qualified'
  | 'negotiating'
  | 'won'
  | 'cac'
  | 'revenue'
  | 'roas'

interface Column {
  key: ColumnKey
  label: string
  title?: string
  numeric: boolean
  value: (row: PerformanceRow) => number | null
  render: (row: PerformanceRow, currency: string) => React.ReactNode
}

const COLUMNS: Column[] = [
  {
    key: 'spend',
    label: 'Investido',
    numeric: true,
    value: (r) => r.spend,
    render: (r, c) => money(r.spend, c),
  },
  {
    key: 'impressions',
    label: 'Impr.',
    title: 'Impressões',
    numeric: true,
    value: (r) => r.impressions,
    render: (r) => quantity(r.impressions),
  },
  {
    key: 'clicks',
    label: 'Cliques',
    numeric: true,
    value: (r) => r.clicks,
    render: (r) => quantity(r.clicks),
  },
  {
    key: 'ctr',
    label: 'CTR',
    numeric: true,
    value: (r) => ctr(r),
    render: (r) => percent(ctr(r), 2),
  },
  {
    key: 'leads',
    label: 'Leads',
    numeric: true,
    value: (r) => r.leads,
    render: (r) => quantity(r.leads),
  },
  {
    key: 'cpl',
    label: 'CPL',
    title: 'Custo por lead',
    numeric: true,
    value: (r) => cpl(r),
    render: (r, c) => moneyOrDash(cpl(r), c),
  },
  {
    key: 'qualified',
    label: 'Qualif.',
    title: 'Leads que chegaram a ser qualificados',
    numeric: true,
    value: (r) => reachedQualified(r),
    render: (r) => (
      <Pair count={reachedQualified(r)} rate={qualificationRate(r)} color="var(--viz-funnel-2)" />
    ),
  },
  {
    key: 'negotiating',
    label: 'Negoc.',
    title: 'Leads que chegaram a negociar preço',
    numeric: true,
    value: (r) => reachedNegotiating(r),
    render: (r) => (
      <Pair
        count={reachedNegotiating(r)}
        rate={reachedQualified(r) > 0 ? reachedNegotiating(r) / reachedQualified(r) : null}
        color="var(--viz-funnel-3)"
      />
    ),
  },
  {
    key: 'won',
    label: 'Vendas',
    numeric: true,
    value: (r) => r.won,
    render: (r) => <Pair count={r.won} rate={closeRate(r)} color="var(--viz-funnel-4)" />,
  },
  {
    key: 'cac',
    label: 'CAC',
    title: 'Custo por venda',
    numeric: true,
    value: (r) => cac(r),
    render: (r, c) => moneyOrDash(cac(r), c),
  },
  {
    key: 'revenue',
    label: 'Receita',
    numeric: true,
    value: (r) => r.revenue,
    render: (r, c) => money(r.revenue, c),
  },
  {
    key: 'roas',
    label: 'ROAS',
    title: 'Receita ganha ÷ investimento',
    numeric: true,
    value: (r) => roas(r),
    render: (r) => <Roas value={roas(r)} />,
  },
]

function Pair({ count, rate, color }: { count: number; rate: number | null; color: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full"
        style={{ background: color }}
      />
      <span className="font-medium text-foreground">{quantity(count)}</span>
      <span className="text-[11px] text-muted-foreground">{percent(rate, 0)}</span>
    </span>
  )
}

/**
 * ROAS below 1 means the campaign gave back less than it cost. That is
 * a state, not a series, so it takes the reserved status color — and
 * the arrow keeps it legible without hue.
 */
function Roas({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>
  const good = value >= 1
  return (
    <span
      className="inline-flex items-center gap-1 font-medium"
      style={{ color: good ? 'var(--viz-good)' : 'var(--viz-critical)' }}
    >
      {good ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />}
      {decimal(value)}×
    </span>
  )
}

export function BreakdownTable({
  title,
  description,
  rows,
  currency,
  loading,
  withThumbnails = false,
  emptyHint,
}: {
  title: string
  description: string
  rows: PerformanceRow[]
  currency: string
  loading: boolean
  withThumbnails?: boolean
  emptyHint: string
}) {
  const [sort, setSort] = useState<{ key: ColumnKey; desc: boolean }>({ key: 'spend', desc: true })
  const [showAll, setShowAll] = useState(false)

  const sorted = useMemo(() => {
    if (sort.key === 'name') {
      const byName = [...rows].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      return sort.desc ? byName.reverse() : byName
    }
    const column = COLUMNS.find((c) => c.key === sort.key)
    if (!column) return rows
    // Nulls are "no denominator", not "zero" — they sink to the bottom in
    // either direction so a sort never promotes a row that has no value.
    return [...rows].sort((a, b) => {
      const av = column.value(a)
      const bv = column.value(b)
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return sort.desc ? bv - av : av - bv
    })
  }, [rows, sort])

  const visible = showAll ? sorted : sorted.slice(0, 10)
  const toggle = (key: ColumnKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }))

  return (
    <section className="flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <header className="flex flex-wrap items-end justify-between gap-2 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        <span className="text-xs text-muted-foreground">
          {quantity(rows.length)} {rows.length === 1 ? 'linha' : 'linhas'}
        </span>
      </header>

      {loading ? (
        <div className="m-5 h-64 animate-pulse rounded bg-muted" />
      ) : rows.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">{emptyHint}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[68rem] text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <HeaderCell
                    label="Nome"
                    align="left"
                    active={sort.key === 'name'}
                    desc={sort.desc}
                    onClick={() => toggle('name')}
                    className="sticky left-0 z-10 bg-card"
                  />
                  {COLUMNS.map((column) => (
                    <HeaderCell
                      key={column.key}
                      label={column.label}
                      title={column.title}
                      align="right"
                      active={sort.key === column.key}
                      desc={sort.desc}
                      onClick={() => toggle(column.key)}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    key={row.key}
                    className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
                  >
                    <td className="sticky left-0 z-10 max-w-[22rem] bg-card p-3">
                      <div className="flex items-center gap-2.5">
                        {withThumbnails && <Thumbnail src={row.imageUrl} alt="" />}
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground" title={row.name}>
                            {row.name}
                          </p>
                          {row.subtitle && (
                            <p className="truncate text-[11px] text-muted-foreground" title={row.subtitle}>
                              {row.subtitle}
                            </p>
                          )}
                        </div>
                        {!row.matched && (
                          <AlertTriangle
                            className="h-3.5 w-3.5 shrink-0"
                            style={{ color: 'var(--viz-warning)' }}
                            aria-label="Sem investimento no período selecionado — anúncio pausado, de outra conta ou desconhecido no Windsor.ai"
                          />
                        )}
                      </div>
                    </td>
                    {COLUMNS.map((column) => (
                      <td key={column.key} className="p-3 text-right tabular-nums whitespace-nowrap">
                        {column.render(row, currency)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sorted.length > 10 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="border-t border-border py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              {showAll ? 'Mostrar apenas o top 10' : `Ver todas as ${quantity(sorted.length)} linhas`}
            </button>
          )}
        </>
      )}
    </section>
  )
}

function HeaderCell({
  label,
  title,
  align,
  active,
  desc,
  onClick,
  className,
}: {
  label: string
  title?: string
  align: 'left' | 'right'
  active: boolean
  desc: boolean
  onClick: () => void
  className?: string
}) {
  return (
    // `aria-sort` belongs on the header cell, not on the control inside
    // it — the sort state describes the column, and `button` has no such
    // property to announce.
    <th
      scope="col"
      className={cn('p-3 font-medium', className)}
      title={title}
      aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'inline-flex items-center gap-1 transition-colors hover:text-foreground',
          align === 'right' ? 'flex-row-reverse' : '',
          active && 'text-foreground',
        )}
      >
        {label}
        {active &&
          (desc ? (
            <ArrowDown className="h-3 w-3" aria-hidden />
          ) : (
            <ArrowUp className="h-3 w-3" aria-hidden />
          ))}
      </button>
    </th>
  )
}

function Thumbnail({ src, alt }: { src: string | null; alt: string }) {
  if (!src) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <ImageOff className="h-3.5 w-3.5" aria-hidden />
      </span>
    )
  }
  return (
    // Remote creative URLs from Meta's CDN — deliberately a plain <img>
    // rather than next/image, which would need every Meta CDN host in
    // `images.remotePatterns` and would 500 the whole row on a host the
    // config hasn't seen yet.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="h-9 w-9 shrink-0 rounded-md object-cover ring-1 ring-foreground/10"
    />
  )
}
