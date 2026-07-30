import { describe, expect, it } from 'vitest'
import {
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

describe('buildDealSignalPrompt — product scoping', () => {
  it('covers the whole Apple line by default', () => {
    const prompt = buildDealSignalPrompt({
      productScope: dealProductScope(),
      businessContext: null,
    })
    expect(prompt).toContain('iPhone')
    expect(prompt).toContain('iPad')
    expect(prompt).toContain('Mac')
  })

  it('still excludes accessories and support from the funnel', () => {
    const prompt = buildDealSignalPrompt({
      productScope: dealProductScope(),
      businessContext: null,
    })
    expect(prompt).toContain('accessories only')
    expect(prompt).toContain('repairs')
  })

  it('is overridable for a shop selling something else', () => {
    const prompt = buildDealSignalPrompt({
      productScope: 'Samsung Galaxy phone',
      businessContext: null,
    })
    expect(prompt).toContain('Samsung Galaxy phone')
  })
})
