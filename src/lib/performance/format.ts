// Number formatting for the ads report. One module so a currency
// change lands everywhere at once, and so "—" is the single agreed
// rendering for "this rate has no denominator" — never a 0 that looks
// like a measured result.

export const DASH = '—'

export function money(value: number, currency = 'BRL'): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency,
    maximumFractionDigits: value !== 0 && Math.abs(value) < 100 ? 2 : 0,
  })
}

/** Compact money for axis ticks and dense cells: R$ 12,4 mil. */
export function moneyShort(value: number, currency = 'BRL'): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  })
}

export function quantity(value: number): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}

export function percent(ratio: number | null, digits = 1): string {
  return ratio === null ? DASH : `${(ratio * 100).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`
}

export function decimal(value: number | null, digits = 2): string {
  return value === null ? DASH : value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function moneyOrDash(value: number | null, currency = 'BRL'): string {
  return value === null ? DASH : money(value, currency)
}

/** "17 ago" for chart axes. Parsed as local noon so the day never slips. */
export function shortDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

export function longDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  })
}
