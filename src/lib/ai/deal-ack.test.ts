import { describe, expect, it } from 'vitest'
import { isAcknowledgement, normalizeForAck } from './deal-ack'

describe('normalizeForAck', () => {
  it('folds accents, case, punctuation and emoji', () => {
    expect(normalizeForAck('  Olá, BOA tarde!! 👍 ')).toBe('ola boa tarde')
  })

  it('keeps digits', () => {
    expect(normalizeForAck('R$ 4.199,00')).toBe('r 4 199 00')
  })
})

describe('isAcknowledgement', () => {
  // The most frequent triggers on this deployment's own usage log, in
  // descending order of how many classifications each one bought.
  it.each([
    'bom dia',
    'boa tarde',
    'ok',
    'oi',
    'boa noite',
    'obrigado',
    '👍',
    'obrigada',
    '❤️',
    'isso',
    'olá',
    'boa tarde!',
    'blz',
    'ta bom',
    'tá bom',
    'obg',
    'oii',
    'entendi',
    'perfeito',
    'tudo bem ?',
    'oie',
    'olá bom dia',
    'oi, bom dia',
    'show',
    'ok obrigado',
    'Certo, aguardo!',
    '?',
    '...',
    'vou ver',
    'valeu, até mais',
  ])('treats %j as an ack', (text) => {
    expect(isAcknowledgement(text)).toBe(true)
  })

  // Anything that can be the customer's answer to a quote or an offer
  // must still reach the model.
  it.each([
    'sim',
    'não',
    'quero',
    'fechado',
    'pode ser',
    'manda o pix',
    'qual o valor?',
    '128',
    '14 pro max',
    'iphone 13',
    'lacrado',
    'parcelado',
    'visa',
    'ok, quero o preto',
    'bom dia, tem o 15?',
    'obrigado, mas achei caro',
    'vou pensar',
    'vou levar',
  ])('does not treat %j as an ack', (text) => {
    expect(isAcknowledgement(text)).toBe(false)
  })

  it('is false for empty or missing text — nothing to skip', () => {
    expect(isAcknowledgement('')).toBe(false)
    expect(isAcknowledgement('   ')).toBe(false)
    expect(isAcknowledgement(null)).toBe(false)
    expect(isAcknowledgement(undefined)).toBe(false)
  })
})
