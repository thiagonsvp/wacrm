import { describe, expect, it } from 'vitest';
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  formatCurrency,
  formatCurrencyShort,
} from './currency';

describe('formatCurrency', () => {
  it('formats whole amounts with no minor units', () => {
    // Use a non-breaking-space-tolerant check: Intl may insert NBSP.
    const out = formatCurrency(1234, 'BRL');
    expect(out).toContain('1.234');
    expect(out).not.toContain('.00');
  });

  it('defaults to BRL when no currency is given', () => {
    expect(formatCurrency(10)).toBe(formatCurrency(10, DEFAULT_CURRENCY));
  });

  it('treats an empty-string currency as the default', () => {
    expect(formatCurrency(10, '')).toBe(formatCurrency(10, DEFAULT_CURRENCY));
  });

  it('coerces non-finite values to 0', () => {
    expect(formatCurrency(Number.NaN, 'BRL')).toContain('R$');
  });

  it('ignores legacy currency codes and always renders reais', () => {
    for (const bad of ['United States', 'US', 'foreign', '12', 'u$d']) {
      expect(() => formatCurrency(1234, bad)).not.toThrow();
      expect(formatCurrency(1234, bad)).toContain('1.234');
      expect(formatCurrency(1234, bad)).toContain('R$');
    }
  });

  it('formats every offered currency without throwing', () => {
    for (const c of CURRENCIES) {
      expect(() => formatCurrency(1000, c.code)).not.toThrow();
    }
  });
});

describe('formatCurrencyShort', () => {
  it('abbreviates millions and thousands with the currency symbol', () => {
    expect(formatCurrencyShort(2_500_000, 'BRL')).toBe('R$2.5M');
    expect(formatCurrencyShort(3_400, 'BRL')).toBe('R$3.4k');
    expect(formatCurrencyShort(900, 'BRL')).toBe('R$900');
  });

  it('uses the BRL symbol', () => {
    expect(formatCurrencyShort(1_000, 'BRL')).toBe('R$1.0k');
  });

  it('ignores legacy codes and keeps the BRL symbol', () => {
    expect(formatCurrencyShort(1_000, 'ZZZ')).toBe('R$1.0k');
  });
});
