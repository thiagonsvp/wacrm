'use client'

import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A stat tile: one number, its label, and at most one supporting line.
 *
 * The gradient is chrome, not data. It lives in a `::before`-style
 * absolutely-positioned layer at low alpha and a hairline top rule, so
 * the tile reads as a lit surface without the number ever sitting on a
 * tinted background it has to fight for contrast. The value itself
 * stays in foreground ink for exactly that reason — a colored number is
 * a number nobody can read at 3:1.
 */
export interface KpiTileProps {
  label: string
  value: string
  /** Secondary line: a rate, a comparison, the denominator. */
  hint?: string
  icon?: LucideIcon
  /** CSS color for the accent wash + rule. Defaults to the funnel's mid step. */
  accent?: string
  /** Renders the tile at half the visual weight, for the second-tier strip. */
  compact?: boolean
  loading?: boolean
  className?: string
}

export function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  accent = 'var(--viz-funnel-3)',
  compact = false,
  loading = false,
  className,
}: KpiTileProps) {
  return (
    <div
      className={cn(
        'relative isolate overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 transition-shadow hover:shadow-lg hover:shadow-black/5',
        compact ? 'p-3.5' : 'p-4',
        className,
      )}
    >
      {/* Accent wash — a soft radial from the top-left corner. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-70"
        style={{
          background: `radial-gradient(120% 100% at 0% 0%, color-mix(in oklab, ${accent} 16%, transparent) 0%, transparent 62%)`,
        }}
      />
      {/* Top hairline, brightest at the corner the wash comes from. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background: `linear-gradient(90deg, ${accent} 0%, color-mix(in oklab, ${accent} 25%, transparent) 45%, transparent 100%)`,
        }}
      />
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" style={{ color: accent }} aria-hidden />}
        <span className="truncate">{label}</span>
      </div>
      {loading ? (
        <div className={cn('mt-2 animate-pulse rounded bg-muted', compact ? 'h-6 w-20' : 'h-8 w-28')} />
      ) : (
        <p
          className={cn(
            'mt-1.5 font-semibold tracking-tight text-foreground',
            compact ? 'text-lg' : 'text-2xl',
          )}
        >
          {value}
        </p>
      )}
      {hint && !loading && (
        <p className="mt-1 truncate text-[11px] text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}
