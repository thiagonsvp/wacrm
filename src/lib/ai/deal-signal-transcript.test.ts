import { describe, expect, it } from 'vitest'
import {
  rejectUpgradeTopUp,
  upgradeTopUpAmounts,
  buildDealSignalPrompt,
  dealProductScope,
  renderTranscript,
} from './deal-signal'
import type { ChatMessage } from './types'

const THREAD: ChatMessage[] = [
  { role: 'user', content: 'oi, tem iphone 15?' },
  { role: 'assistant', content: 'Temos! 128GB sai por R$ 4.199.' },
  { role: 'user', content: 'e o meu 12 vale quanto na troca?' },
]

describe('renderTranscript', () => {
  it('labels each side in Portuguese', () => {
    const out = renderTranscript(THREAD)
    expect(out).toContain('Cliente: oi, tem iphone 15?')
    expect(out).toContain('Loja: Temos! 128GB sai por R$ 4.199.')
  })

  it('delimits the transcript so customer text cannot be read as instructions', () => {
    const out = renderTranscript(THREAD)
    expect(out).toContain('<conversa>')
    expect(out).toContain('</conversa>')
  })

  it('states that this is a record to analyse, not a chat to continue', () => {
    // The failure this guards: handed alternating turns ending on a
    // customer question, the model answers the customer instead of
    // emitting JSON, and the whole classification is discarded.
    const out = renderTranscript(THREAD)
    expect(out).toContain('não responda ao cliente')
    expect(out).toContain('somente com o objeto JSON')
  })

  it('produces one message even for a long thread', () => {
    const long: ChatMessage[] = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg ${i}`,
    }))
    const out = renderTranscript(long)
    expect(out.match(/<conversa>/g)).toHaveLength(1)
    expect(out).toContain('msg 39')
  })

  it('handles an empty thread without producing a malformed block', () => {
    const out = renderTranscript([])
    expect(out).toContain('<conversa>')
    expect(out).toContain('</conversa>')
  })
})

describe('buildDealSignalPrompt — commercial scoping', () => {
  it('uses a generic default when the account has no scope yet', () => {
    const prompt = buildDealSignalPrompt({
      productScope: dealProductScope(),
      businessContext: null,
    })
    expect(prompt).toContain('products and services described')
  })

  it('keeps ambiguous conversations out of the funnel', () => {
    const prompt = buildDealSignalPrompt({
      productScope: dealProductScope(),
      businessContext: null,
    })
    expect(prompt).toContain('conversation is ambiguous')
  })

  it('is overridable for a shop selling something else', () => {
    const prompt = buildDealSignalPrompt({
      productScope: 'Samsung Galaxy phone',
      businessContext: null,
    })
    expect(prompt).toContain('Samsung Galaxy phone')
  })
})

describe('upgradeTopUpAmounts', () => {
  const proposal = [
    'Loja: Tudo pronto! Veja como fica o seu upgrade:',
    'Seu aparelho: 11 128gb',
    'Aparelho novo: 16 plus 128gb lacrado',
    'Diferença a pagar: R$ 4.900',
    'Condições de pagamento da diferença: (Pix/Dinheiro) Ou EM ATÉ 18x no cartão.',
  ].join('\n')

  it('pulls a single top-up out of the store proposal format', () => {
    expect(upgradeTopUpAmounts(proposal)).toContain(4900)
  })

  it('pulls every per-colour top-up', () => {
    const multi =
      'Diferença a pagar: azul R$ 5.049 laranja R$ 4.849 silver R$ 5.099\nCondições de pagamento'
    const found = upgradeTopUpAmounts(multi)
    expect(found).toEqual(expect.arrayContaining([5049, 4849, 5099]))
  })

  it('stops at the payment-conditions section', () => {
    // "18x" must not be mistaken for an amount.
    expect(upgradeTopUpAmounts(proposal)).not.toContain(18)
  })

  it('returns nothing for a thread with no upgrade proposal', () => {
    expect(upgradeTopUpAmounts('Loja: o 15 sai 4200. Cliente: fechado')).toEqual([])
  })
})

describe('rejectUpgradeTopUp', () => {
  const proposal = 'Diferença a pagar: R$ 4.900\nCondições de pagamento'
  const sig = (price: number | null) => ({
    outcome: 'negotiating' as const,
    model: 'iPhone 16 Plus 128GB',
    price,
  })

  it('nulls a price that matches the quoted top-up', () => {
    // Measured on live threads: the model reported the top-up as the
    // device price in roughly a third of upgrade conversations.
    expect(rejectUpgradeTopUp(sig(4900), proposal).price).toBeNull()
  })

  it('keeps a price that is genuinely the device price', () => {
    expect(rejectUpgradeTopUp(sig(7350), proposal).price).toBe(7350)
  })

  it('leaves a null price alone', () => {
    expect(rejectUpgradeTopUp(sig(null), proposal).price).toBeNull()
  })

  it('never touches the outcome or the model', () => {
    const out = rejectUpgradeTopUp(sig(4900), proposal)
    expect(out.outcome).toBe('negotiating')
    expect(out.model).toBe('iPhone 16 Plus 128GB')
  })

  it('is a no-op on a thread with no upgrade proposal', () => {
    expect(rejectUpgradeTopUp(sig(4200), 'Loja: o 15 sai 4200').price).toBe(4200)
  })
})
