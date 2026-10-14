import { describe, expect, it } from 'vitest'
import { isAdTemplate, isNoise } from './deal-ack'
import { renderTranscript } from './deal-signal'
import { storeMessageSignal } from './deal-pipeline'
import { planTransition, titleNamesProduct } from '@/lib/deals/transition'
import type { PipelineStageMap } from '@/lib/deals/stage-map'

describe('isAdTemplate', () => {
  it.each([
    'Olá, vim pelo anúncio e gostaria de mais informações!',
    'Olá! Tenho interesse em fazer Upgrade e queria mais informações, por favor.',
    'Olá! Vi o anúncio do iPhone 14 128GB por R$ 2.599 e tenho interesse.',
    'Olá! Posso ter mais informações sobre isso?',
    'Olá! Quero saber sobre o iPhone 16.',
    'Vim pelo site e queria saber mais',
  ])('recognises %j', (text) => {
    expect(isAdTemplate(text)).toBe(true)
    expect(isNoise(text)).toBe(true)
  })

  it.each(['quanto tá o iPhone 15?', 'Tem 17 pro max 256 azul?', 'quero fazer upgrade do meu 13'])(
    'leaves real customer text alone: %j',
    (text) => {
      expect(isAdTemplate(text)).toBe(false)
      expect(isNoise(text)).toBe(false)
    },
  )
})

describe('renderTranscript', () => {
  it('marks ad templates and stamps each line with São Paulo time', () => {
    const out = renderTranscript(
      [
        { role: 'user', content: 'Olá, vim pelo anúncio e gostaria de mais informações!', at: '2026-10-14T15:05:00Z' },
        { role: 'assistant', content: 'Oi! Compra direta ou up?', at: '2026-10-14T15:06:00Z' },
      ],
      new Date('2026-10-14T18:00:00Z'),
    )
    expect(out).toContain('Hoje é 14/10/2026')
    expect(out).toContain('[14/10, 12:05] Cliente (mensagem automática do anúncio):')
    expect(out).toContain('[14/10, 12:06] Loja: Oi!')
  })
})

describe('storeMessageSignal', () => {
  it('forces a re-read on documents and the invoice form', () => {
    expect(storeMessageSignal('document', 'proposta.pdf')).toBe('force')
    expect(storeMessageSignal('text', 'Segue o NOVO FORMULÁRIO para emissão da nota')).toBe('force')
  })
  it('re-reads (with cooldown) on quotes, links and courier messages', () => {
    expect(storeMessageSignal('text', 'Está no valor de 3299,00')).toBe('normal')
    expect(storeMessageSignal('text', 'Fica uma diferença de 4.500')).toBe('normal')
    expect(storeMessageSignal('text', 'o motoboy saiu')).toBe('normal')
  })
  it('ignores small talk', () => {
    expect(storeMessageSignal('text', 'Bom dia! Tudo bem?')).toBeNull()
    expect(storeMessageSignal('text', '')).toBeNull()
  })
})

const stages: PipelineStageMap = {
  pipelineId: 'p',
  newLead: { id: 'new', position: 0 },
  qualified: { id: 'q', position: 1 },
  negotiating: { id: 'n', position: 2 },
  closed: { id: 'c', position: 4 },
}

describe('planTransition with the new signals', () => {
  it('never files a card for a supplier, not even a Novo Lead', () => {
    expect(
      planTransition({
        signal: { outcome: 'none', model: null, price: null, notCustomer: true },
        current: null,
        stages,
        fallbackTitle: 'Fornecedor',
      }),
    ).toEqual({ action: 'none', reason: 'counterparty is not a customer' })
  })

  it('still files a Novo Lead for a real contact with no signal yet', () => {
    expect(
      planTransition({
        signal: { outcome: 'none', model: null, price: null },
        current: null,
        stages,
        fallbackTitle: 'Ana',
      }),
    ).toMatchObject({ action: 'create', stageId: 'new', value: 0 })
  })
})

describe('titleNamesProduct', () => {
  it('treats a phone number title as a placeholder', () => {
    expect(titleNamesProduct('5521981705087')).toBe(false)
    expect(titleNamesProduct('+55 (21) 98170-5087')).toBe(false)
  })
  it('still keeps product titles', () => {
    expect(titleNamesProduct('iPhone 15 Pro Max 256GB')).toBe(true)
    expect(titleNamesProduct('13 Pro Max 256GB')).toBe(true)
  })
})
