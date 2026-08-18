'use client'

import { useId } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import type { FunnelDay } from '@/lib/performance/types'
import { reachedNegotiating, reachedQualified } from '@/lib/performance/merge'
import { longDay, money, moneyShort, quantity, shortDay } from '@/lib/performance/format'

// ------------------------------------------------------------
// Two charts, never one.
//
// Spend is currency and the funnel is a count; putting them on one
// plot needs a second y-axis, and a dual axis lets whoever picked the
// scales decide where the two lines appear to cross. That crossing is
// read as a finding, and it is an artefact. So: small multiples,
// stacked, sharing an x-axis and a synchronised crosshair — the
// comparison stays available, the false precision doesn't.
// ------------------------------------------------------------

const SYNC = 'performance-trend'

interface Point extends FunnelDay {
  spend: number
  qualifiedReached: number
  negotiatingReached: number
}

export function buildTrend(daily: FunnelDay[], spendByDay: Map<string, number>): Point[] {
  return daily.map((day) => ({
    ...day,
    spend: spendByDay.get(day.day) ?? 0,
    qualifiedReached: reachedQualified(day),
    negotiatingReached: reachedNegotiating(day),
  }))
}

const axis = { fontSize: 11, fill: 'var(--muted-foreground)' }

function ChartCard({
  title,
  description,
  legend,
  loading,
  children,
}: {
  title: string
  description: string
  legend?: React.ReactNode
  loading: boolean
  children: React.ReactElement
}) {
  return (
    <section className="flex flex-col rounded-xl bg-card ring-1 ring-foreground/10">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        {legend}
      </header>
      <div className="p-3 pt-4">
        {loading ? (
          <div className="h-56 animate-pulse rounded bg-muted" />
        ) : (
          <ResponsiveContainer width="100%" height={224}>
            {children}
          </ResponsiveContainer>
        )}
      </div>
    </section>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full ring-2 ring-card"
        style={{ background: color }}
      />
      {label}
    </span>
  )
}

function TooltipShell({
  label,
  rows,
}: {
  label: string
  rows: { color?: string; name: string; value: string }[]
}) {
  return (
    <div className="rounded-lg bg-popover px-3 py-2 text-[11px] shadow-xl ring-1 ring-foreground/10">
      <p className="font-medium text-popover-foreground">{label}</p>
      <ul className="mt-1.5 space-y-1">
        {rows.map((row) => (
          <li key={row.name} className="flex items-center gap-2">
            {row.color && (
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: row.color }}
              />
            )}
            <span className="text-muted-foreground">{row.name}</span>
            <span className="ml-auto font-medium tabular-nums text-popover-foreground">
              {row.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// --- Chart 1: spend ---------------------------------------------------

export function SpendTrend({
  data,
  currency,
  loading,
}: {
  data: Point[]
  currency: string
  loading: boolean
}) {
  const gradientId = useId()
  return (
    <ChartCard
      title="Investimento por dia"
      description="Gasto de mídia no período selecionado"
      loading={loading}
    >
      <AreaChart data={data} syncId={SYNC} margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
        <defs>
          {/* The gradient is the fill only — the stroke stays solid, so the
              series keeps a crisp, readable edge at the top of the band. */}
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--viz-cat-2)" stopOpacity={0.45} />
            <stop offset="55%" stopColor="var(--viz-cat-2)" stopOpacity={0.14} />
            <stop offset="100%" stopColor="var(--viz-cat-2)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis
          dataKey="day"
          tick={axis}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
          tickFormatter={shortDay}
        />
        <YAxis
          tick={axis}
          tickLine={false}
          axisLine={false}
          width={64}
          tickFormatter={(v: number) => moneyShort(v, currency)}
        />
        <Tooltip
          cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }}
          content={(props: TooltipContentProps) =>
            props.active && props.payload?.length ? (
              <TooltipShell
                label={longDay(String(props.label))}
                rows={[
                  {
                    color: 'var(--viz-cat-2)',
                    name: 'Investimento',
                    value: money(Number(props.payload[0].value ?? 0), currency),
                  },
                ]}
              />
            ) : null
          }
        />
        <Area
          type="monotone"
          dataKey="spend"
          name="Investimento"
          stroke="var(--viz-cat-2)"
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
        />
      </AreaChart>
    </ChartCard>
  )
}

// --- Chart 2: the funnel over time ------------------------------------

const FUNNEL_SERIES = [
  { key: 'leads', name: 'Leads', color: 'var(--viz-funnel-1)' },
  { key: 'qualifiedReached', name: 'Qualificados', color: 'var(--viz-funnel-2)' },
  { key: 'negotiatingReached', name: 'Em negociação', color: 'var(--viz-funnel-3)' },
  { key: 'won', name: 'Vendas', color: 'var(--viz-funnel-4)' },
] as const

export function FunnelTrend({ data, loading }: { data: Point[]; loading: boolean }) {
  return (
    <ChartCard
      title="Funil por dia"
      description="Leads pela data de entrada — cada um carrega o resultado que teve depois"
      loading={loading}
      legend={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {FUNNEL_SERIES.map((s) => (
            <LegendDot key={s.key} color={s.color} label={s.name} />
          ))}
        </div>
      }
    >
      <LineChart data={data} syncId={SYNC} margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis
          dataKey="day"
          tick={axis}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
          tickFormatter={shortDay}
        />
        <YAxis
          tick={axis}
          tickLine={false}
          axisLine={false}
          width={40}
          allowDecimals={false}
          tickFormatter={quantity}
        />
        <Tooltip
          cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }}
          content={(props: TooltipContentProps) =>
            props.active && props.payload?.length ? (
              <TooltipShell
                label={longDay(String(props.label))}
                rows={FUNNEL_SERIES.map((s) => ({
                  color: s.color,
                  name: s.name,
                  value: quantity(
                    Number(props.payload?.find((p) => p.dataKey === s.key)?.value ?? 0),
                  ),
                }))}
              />
            ) : null
          }
        />
        {FUNNEL_SERIES.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
          />
        ))}
      </LineChart>
    </ChartCard>
  )
}
