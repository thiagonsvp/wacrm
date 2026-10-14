import { describe, expect, it } from 'vitest'
import { buildDealSignalPrompt } from './deal-signal'

/**
 * Regression cover for the 2026-08-12 false "won".
 *
 * A lead was marked closed-won four minutes after the card was created.
 * The only thing the customer had said was "Ok", right after the seller's
 * standard closing pitch ("Fechando o seu iPhone hoje, preparei um combo
 * de mimos"). Twelve minutes later the same customer wrote "Sim mas eu tô
 * procurando sem juros na máquina" — still shopping.
 *
 * The rule then ended with "...or agreed to close", which is far looser
 * than what the business actually asked for: delivery scheduled, courier
 * sent, or the payment link requested. A bare acknowledgement satisfied
 * "agreed to close".
 *
 * This matters beyond a misplaced card: a won deal fires a Purchase
 * conversion to Meta, so a false positive teaches the ad platform that a
 * non-buyer was a buyer, and pollutes the campaign's optimisation.
 */
const prompt = buildDealSignalPrompt({
  productScope: 'iPhone',
  businessContext: null,
})

describe('the "won" rule demands a concrete act', () => {
  it('no longer accepts vague agreement as a purchase', () => {
    expect(prompt).not.toMatch(/agreed to close/i)
  })

  it('names the concrete acts that do count', () => {
    for (const signal of [/payment link/i, /PIX/i, /they paid/i, /invoice form/i]) {
      expect(prompt).toMatch(signal)
    }
  })

  it('spells out that a bare acknowledgement is not a purchase', () => {
    expect(prompt).toMatch(/bare acknowledgement is NOT a purchase/i)
    // The exact word that caused this incident.
    expect(prompt).toMatch(/"ok"/i)
  })

  it('warns that closing pitches are the seller talking, not the customer buying', () => {
    expect(prompt).toMatch(/closing (offer|pitch)/i)
    expect(prompt).toMatch(/does not mean the customer has bought anything/i)
  })

  it('requires the confirmation to come from the customer', () => {
    expect(prompt).toMatch(/by the CUSTOMER/i)
  })

  it('treats a scheduled delivery as negotiating, not won', () => {
    // Customers backed out after agreeing a delivery time, and won is
    // terminal, so those cards could never be corrected.
    expect(prompt).toMatch(/Agreeing on a delivery time[^.]*is "negotiating", not "won"/i)
    expect(prompt).not.toMatch(/accepting a specific delivery\/pickup time/i)
  })
})

describe('ad templates and non-customers', () => {
  it('says pre-filled ad messages carry no intent', () => {
    expect(prompt).toMatch(/Pre-filled first messages from ads/i)
  })

  it('asks for the counterparty so suppliers never get a card', () => {
    expect(prompt).toContain('"counterparty": "customer" | "not_customer"')
  })
})

describe('model and price must come from the same quoted line', () => {
  it('forbids pairing a capacity with another line\'s price', () => {
    // The same card was titled "iPhone 14 pro Max 256gb" but valued at
    // R$ 3.849 — the price of the 128gb in the very same table.
    expect(prompt).toMatch(/SAME quoted line/i)
    expect(prompt).toMatch(/Never pair a capacity from one line with the price from another/i)
  })

  it('prefers reporting no capacity over guessing one', () => {
    expect(prompt).toMatch(/WITHOUT inventing a capacity/i)
  })
})

describe('the rules that were already right are still there', () => {
  it('keeps refusing the trade-in valuation as the price', () => {
    expect(prompt).toMatch(/trade-in valuation/i)
  })

  it('keeps refusing the upgrade top-up as the price', () => {
    expect(prompt).toMatch(/is the top-up, NOT the price/i)
  })

  it('keeps the lost signals intact', () => {
    expect(prompt).toMatch(/price is too high/i)
    expect(prompt).toMatch(/bought elsewhere/i)
  })
})
