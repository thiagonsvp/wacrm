"use client"

import { AlertTriangle, Clock } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ResponseTimeSummary } from '@/lib/dashboard/types'
import { BarChart } from '@/components/tremor/bar-chart'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface ResponseTimeChartProps {
  data: ResponseTimeSummary | null
  loading: boolean
  /** The load failed — shown instead of an endless skeleton. */
  failed?: boolean
}

// Tremor takes categories as row keys, so each bucket becomes
// `{ day: 'Seg', minutes: 4.2 }`.
const CATEGORY = 'minutes'
// Sunday (dow 6) is off: there is no shift, so a Sunday message is only
// answered on Monday and its bar is just "time until the week starts",
// which dwarfs every working day on the shared axis.
const CLOSED_DOWS = new Set([6])

export function ResponseTimeChart({
  data,
  loading,
  failed = false,
}: ResponseTimeChartProps) {
  const t = useTranslations('Dashboard.responseTimeChart')
  const openBuckets = data?.buckets.filter((b) => !CLOSED_DOWS.has(b.dow)) ?? []
  const hasData = openBuckets.some((b) => b.medianMinutes != null)

  const chartData = openBuckets.map((b) => ({
    day: t(`day${b.dow}`),
    [CATEGORY]: b.medianMinutes ?? 0,
  }))

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
        {failed ? (
          <EmptyState
            icon={AlertTriangle}
            title={t('loadFailed')}
            hint={t('loadFailedHint')}
          />
        ) : loading || !data ? (
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
