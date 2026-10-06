"use client"

import { Clock } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ResponseTimeSummary } from '@/lib/dashboard/types'
import { BarChart } from '@/components/tremor/bar-chart'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface ResponseTimeChartProps {
  data: ResponseTimeSummary | null
  loading: boolean
}

// Tremor takes categories as row keys, so each bucket becomes
// `{ day: 'Seg', minutes: 4.2 }`.
const CATEGORY = 'minutes'

export function ResponseTimeChart({ data, loading }: ResponseTimeChartProps) {
  const t = useTranslations('Dashboard.responseTimeChart')
  const hasData = data?.buckets.some((b) => b.medianMinutes != null) ?? false

  const chartData =
    data?.buckets.map((b, i) => ({
      day: t(`day${i}`),
      [CATEGORY]: b.medianMinutes ?? 0,
    })) ?? []

  return (
    <section className="h-full rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t('title')}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('description')}
          </p>
        </div>
        {data && (data.thisWeekMedian != null || data.lastWeekMedian != null) && (
          <div className="shrink-0 text-right text-xs">
            <div className="text-muted-foreground">
              {t('thisWeek')}{' '}
              <span className="font-medium text-foreground tabular-nums">
                {formatDuration(data.thisWeekMedian)}
              </span>
            </div>
            <div className="text-muted-foreground">
              {t('lastWeek')}{' '}
              <span className="tabular-nums">
                {formatDuration(data.lastWeekMedian)}
              </span>
            </div>
          </div>
        )}
      </header>

      <div className="p-5">
        {loading || !data ? (
          <Skeleton className="h-[260px] w-full" />
        ) : !hasData ? (
          <EmptyState
            icon={Clock}
            title={t('noReplies')}
            hint={t('noRepliesHint')}
          />
        ) : (
          <BarChart
            data={chartData}
            index="day"
            categories={[CATEGORY]}
            colors={['violet']}
            valueFormatter={(value) => formatDuration(value)}
            showLegend={false}
            yAxisWidth={56}
            className="h-[260px]"
          />
        )}
      </div>
    </section>
  )
}

export function formatDuration(mins: number | null): string {
  if (mins == null) return '—'
  if (mins < 1) return `${Math.max(1, Math.round(mins * 60))}s`
  if (mins < 60) return `${Math.round(mins)}min`
  if (mins < 24 * 60) return `${(mins / 60).toFixed(1).replace('.0', '')}h`
  return `${(mins / (24 * 60)).toFixed(1).replace('.0', '')}d`
}
