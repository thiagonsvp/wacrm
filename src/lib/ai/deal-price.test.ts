import { describe, expect, it } from 'vitest'
import type { ChatMessage } from './types'
import { parseBrAmount, validateQuotedPrice } from './deal-price'

const loja = (content: string): ChatMessage => ({ role: 'assistant', content })
const cliente = (content: string): ChatMessage => ({ role: 'user', content })

const check = (price: number | null, msgs: ChatMessage[]) =>
  validateQuotedPrice(price, msgs).price

describe('parseBrAmount', () => {
  it('reads pt-BR grouping and decimals', () => {
    expect(parseBrAmount('2.858,45')).toBe(2858.45)
    expect(parseBrAmount('7749,00')).toBe(7749)
    expect(parseBrAmount('4.499')).toBe(4499)
  })
})

describe('validateQuotedPrice — accepts real totals', () => {
  it('keeps a price the store wrote', () => {
    expect(check(3299, [cliente('quanto tá iPhone 15'), loja('Está no valor de 3299,00')])).toBe(3299)
    expect(check(7899, [loja('17 Pro 256GB lacrado R$ 7.899')])).toBe(7899)
  })

  it('keeps the full price stated next to the top-up', () => {
    expect(
      check(7850, [loja('Fica uma diferença de 5349,00, 7850,00 o total dele')]),
    ).toBe(7850)
  })

  it('keeps the value from the invoice form the customer returned', () => {
    expect(
      check(2858.45, [
        loja('Segue o NOVO FORMULÁRIO para a nota'),
        cliente('Nome: Fulano\nCPF: 000\nImei: 35...\nValor:2.858,45'),
      ]),
    ).toBe(2858.45)
  })
})

describe('validateQuotedPrice — rejects what the audits found on the board', () => {
  it('drops R$879.900 read from "8799,00" (above the ceiling)', () => {
    expect(check(879900, [loja('Fica uma diferença de 8799,00 para o 18 Pro Max')])).toBeNull()
  })

  it('drops R$285.845 read from "2.858,45" (not in the conversation)', () => {
    expect(check(285845, [cliente('CPF: 1\nValor:2.858,45')])).toBeNull()
  })

  it('drops every phrasing of the upgrade top-up', () => {
    expect(check(5349, [loja('Fica uma diferença de 5349,00')])).toBeNull()
    expect(check(7700, [loja('R$7.700 De diferença na cotação do seu 14')])).toBeNull()
    expect(check(4500, [loja('dando o seu aparelho de entrada, o 17 pro max sai a: 4.500')])).toBeNull()
    expect(
      check(1599, [loja('UPGRADE 13 128GB DIFERENÇA A SER PAGA:\n15 128GB seminovo R$ 1.599')]),
    ).toBeNull()
    expect(check(4400, [loja('6900-2500=4.400')])).toBeNull()
  })

  it('keeps the full price in an "a-b=c" upgrade line', () => {
    expect(check(6900, [loja('6900-2500=4.400')])).toBe(6900)
  })

  it('drops instalments and instalment totals', () => {
    expect(check(591.36, [loja('Fica 10x de 591,36')])).toBeNull()
    expect(check(5913.6, [loja('Fica 10x de 591,36')])).toBeNull()
    expect(check(5258.76, [loja('12x R$438,23')])).toBeNull()
  })

  it("drops the customer's own numbers and the ad price", () => {
    expect(check(1600, [cliente('A entrada seria 1600')])).toBeNull()
    expect(
      check(2599, [cliente('Olá! Vi o anúncio do iPhone 14 128GB por R$ 2.599 e tenho interesse.')]),
    ).toBeNull()
  })

  it('drops a down payment and a delivery fee the store wrote', () => {
    expect(check(2000, [loja('Com uma entrada de 2.000 fica ótimo')])).toBeNull()
    expect(check(10, [loja('fica 10 reais pra entregar')])).toBeNull()
  })

  it('drops a value never written by the store (prompt example leak)', () => {
    expect(check(6899, [loja('O 17 Pro Max Silver está R$ 7.900')])).toBeNull()
  })
})
