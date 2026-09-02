/**
 * Currency — the CRM is Brazilian-real only. The optional currency
 * arguments remain for API compatibility, but rendering always uses BRL.
 */

/** App-wide fallback when no account/deal currency is available. */
export const DEFAULT_CURRENCY = 'BRL';

export interface CurrencyOption {
  /** ISO-4217 code stored in the DB. */
  code: string;
  /** Human label for the fixed currency control. */
  label: string;
  /** Symbol used throughout the interface. */
  symbol: string;
}

/**
 * The sole currency offered by the CRM.
 */
export const CURRENCIES: CurrencyOption[] = [
  { code: 'BRL', label: 'Brazilian Real', symbol: 'R$' },
];

/**
 * Format a deal value as a currency string. Whole-number output
 * (no minor units) — deal values are tracked in whole reais across
 * the app. Legacy currency arguments are ignored so old rows cannot
 * leak another symbol back into reports.
 *
 * The formatter is total by design: legacy arguments are accepted for
 * API compatibility but never influence the rendered currency.
 */
export function formatCurrency(
  value: number,
  _currency: string = DEFAULT_CURRENCY
): string {
  const amount = Number(value) || 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: DEFAULT_CURRENCY,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Compact currency for tight spaces (donut center, legend rows), such
 * as "R$1.2M" or "R$34.5k".
 */
export function formatCurrencyShort(
  value: number,
  _currency: string = DEFAULT_CURRENCY
): string {
  return `R$${formatCompactNumber(value)}`;
}

/**
 * Compact number for tight spaces (chart tiles, legends): 1_234 → "1.2k",
 * 1_200_000 → "1.2M", 900 → "900". The unit-less core shared with
 * {@link formatCurrencyShort}.
 */
export function formatCompactNumber(value: number): string {
  const v = Number(value || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toFixed(0);
}
