import type { ChatMessage } from './types'

// ------------------------------------------------------------
// Is the price the classifier reported one the conversation supports?
//
// The model is told what a valid price is (deal-signal.ts), but measured
// on two accounts it still filed, as the card value: the upgrade top-up
// (~100 cards on one account, R$538k), instalment × count, the customer's
// own down payment, the price printed in the ad template, an example price
// leaked from the account's own prompt, and R$879.900 / R$285.845 read
// from "8799,00" / "2.858,45". Every one of those is a number the BUSINESS
// never quoted as a total — so the rule is enforced here, exactly:
//
//   the price must appear in a Loja message, outside a top-up /
//   instalment / down-payment / fee context — or as the "Valor" on the
//   invoice form the customer returned.
//
// Anything else becomes null. Failing to null is the safe direction: a
// card with no value is an obvious gap a human fills in, while a wrong
// one looks plausible, inflates the pipeline and is reported to the ad
// platforms as revenue.
// ------------------------------------------------------------

const DEFAULT_MAX_PRICE = 50_000

/** Ceiling for a single deal's value. Override with DEAL_MAX_PRICE. */
export function dealMaxPrice(): number {
  const raw = Number(process.env.DEAL_MAX_PRICE)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_PRICE
}

/** Money-ish token: 1.599 / 1599 / 1.599,00 / 7749,00 / 2.858,45. */
const AMOUNT = /(?<![\d.,])(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)(?![\d.,]*\d)/g

/** Parse one pt-BR amount token. */
export function parseBrAmount(token: string): number | null {
  const cleaned = token.replace(/\./g, '').replace(',', '.')
  const n = Number(cleaned)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

const TOPUP =
  /diferen[çc]a|restante a ser pago|dando o seu( aparelho)?|sai (a|por)\b|de volta\b|na cota[çc][ãa]o do seu/i
const TOTAL = /\btotal\b|sem dar o seu|valor dele/i
const OTHER_NOT_PRICE = /entrada|entrega|frete|taxa|sinal\b/i
const INSTALMENT_BEFORE = /(\d{1,2})\s*x\s*(de\s*)?(r\$\s*)?$/i

interface Amount {
  value: number
  /** Why this amount is not a total price, or null when it may be one. */
  rejected: string | null
}

/** Every amount in a Loja message, each tagged with whether it can be a total. */
export function classifyStoreAmounts(text: string): Amount[] {
  const out: Amount[] = []
  const lines = text.split(/\r?\n/)
  // A header line like "DIFERENÇA A SER PAGA:" puts the amounts on the
  // lines below it, until the next blank line.
  let inTopUpBlock = false
  for (const line of lines) {
    if (!line.trim()) {
      inTopUpBlock = false
      continue
    }
    const lineIsTopUpHeader = TOPUP.test(line) && /:\s*$/.test(line.trim())
    // "6900-2500=4.400": the result is the top-up, the first term may be
    // the full price.
    const arithmetic = /(\d[\d.,]*)\s*-\s*(\d[\d.,]*)\s*=\s*(\d[\d.,]*)/.exec(line)
    for (const m of line.matchAll(AMOUNT)) {
      const value = parseBrAmount(m[1])
      if (value == null || value < 50) continue
      const start = m.index ?? 0
      const before = line.slice(Math.max(0, start - 45), start)
      const after = line.slice(start + m[0].length, start + m[0].length + 30)
      const around = `${before} ${after}`
      let rejected: string | null = null
      if (arithmetic && m[1] === arithmetic[3]) rejected = 'top-up'
      else if (arithmetic && m[1] === arithmetic[2]) rejected = 'trade-in'
      else if (TOTAL.test(around)) rejected = null
      else if (inTopUpBlock || TOPUP.test(around)) rejected = 'top-up'
      else if (INSTALMENT_BEFORE.test(before)) rejected = 'instalment'
      else if (OTHER_NOT_PRICE.test(around)) rejected = 'fee/down payment'
      out.push({ value, rejected })
      if (rejected === 'instalment') {
        const count = Number(INSTALMENT_BEFORE.exec(before)?.[1])
        if (count > 1) {
          out.push({ value: Math.round(count * value * 100) / 100, rejected: 'instalment total' })
        }
      }
    }
    if (lineIsTopUpHeader) inTopUpBlock = true
  }
  return out
}

/**
 * "Valor: 2.858,45" from an invoice form the CUSTOMER returned (carries
 * a CPF or IMEI). That is the billed amount of a completed sale.
 */
export function invoiceFormAmounts(text: string): number[] {
  if (!/cpf|imei/i.test(text) || !/valor/i.test(text)) return []
  const out: number[] = []
  for (const m of text.matchAll(/valor\s*(?:total)?\s*[:=]?\s*(?:r\$\s*)?(\d[\d.,]*)/gi)) {
    const v = parseBrAmount(m[1])
    if (v != null && v >= 50) out.push(v)
  }
  return out
}

const near = (a: number, b: number) => Math.abs(a - b) < 1

/**
 * The reported price if the conversation supports it as a total, else
 * null (with the reason, for logs and tests).
 */
export function validateQuotedPrice(
  price: number | null,
  messages: ChatMessage[],
): { price: number | null; reason: string | null } {
  if (price == null) return { price: null, reason: null }
  if (price <= 0) return { price: null, reason: 'not positive' }
  if (price > dealMaxPrice()) return { price: null, reason: 'above the deal ceiling' }

  const store = messages
    .filter((m) => m.role === 'assistant')
    .flatMap((m) => classifyStoreAmounts(m.content))
  const forms = messages
    .filter((m) => m.role === 'user')
    .flatMap((m) => invoiceFormAmounts(m.content))

  if (forms.some((v) => near(v, price))) return { price, reason: null }
  const matches = store.filter((a) => near(a.value, price))
  if (matches.some((a) => a.rejected == null)) return { price, reason: null }
  if (matches.length) return { price: null, reason: matches[0].rejected }
  return { price: null, reason: 'not quoted by the business' }
}
