"use client"

import type { LeadStats } from '@/lib/dashboard/types'
import { Skeleton } from './skeleton'

export function LeadStats({ data, loading }: { data: LeadStats | null; loading: boolean }) {
  const max = Math.max(...(data?.byDay.map((x) => x.count) ?? [1]), 1)
  return <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
    <section className="rounded-xl border border-border bg-card p-5 lg:col-span-3">
      <h2 className="text-sm font-semibold text-foreground">Leads por dia</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Novos leads nos últimos 30 dias</p>
      {loading || !data ? <Skeleton className="mt-5 h-32 w-full" /> : <div className="mt-5 flex h-32 items-end gap-1">
        {data.byDay.map((item) => {
          const barHeight = Math.max((item.count / max) * 100, item.count ? 6 : 2)
          return <div key={item.day} className="group relative h-full flex-1" title={`${item.day}: ${item.count}`}>
          <span className="absolute left-1/2 z-10 -translate-x-1/2 -translate-y-1 whitespace-nowrap text-[10px] font-semibold tabular-nums text-foreground" style={{ bottom: `${barHeight}%` }}>{item.count}</span>
          <div className="absolute inset-x-0 bottom-0 rounded-t bg-primary/80 transition-colors group-hover:bg-primary" style={{ height: `${barHeight}%` }} />
        </div>})}
      </div>}
    </section>
    <section className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
      <h2 className="text-sm font-semibold text-foreground">Leads por origem</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Distribuição nos últimos 30 dias</p>
      {loading || !data ? <Skeleton className="mt-5 h-32 w-full" /> : <div className="mt-4 space-y-3">
        {data.byOrigin.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum lead no período.</p> : data.byOrigin.map((item) => <div key={item.origin} className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{item.origin}</span><span className="font-semibold tabular-nums text-foreground">{item.count}</span></div>)}
      </div>}
    </section>
  </div>
}
