import { describe, expect, it } from 'vitest'
import { autocertoMarker, autocertoNote, autocertoPhone } from './autocerto'

describe('autocertoPhone', () => {
  it('adds Brazil\'s country code to the digits Autocerto sends', () => {
    expect(autocertoPhone('11912345678')).toBe('+5511912345678')
    expect(autocertoPhone('2133334444')).toBe('+552133334444')
  })

  it('keeps a number that already has 55, and strips formatting', () => {
    expect(autocertoPhone('5521964548153')).toBe('+5521964548153')
    expect(autocertoPhone('(21) 96454-8153')).toBe('+5521964548153')
  })

  it('returns null for empty or unusable numbers', () => {
    expect(autocertoPhone('')).toBeNull()
    expect(autocertoPhone('123')).toBeNull()
    expect(autocertoPhone(undefined)).toBeNull()
  })
})

describe('autocertoNote', () => {
  it('starts with the marker used to recognise a re-sent lead', () => {
    const note = autocertoNote({ id: 18452, veiculo: 'Honda Civic 2024', placa: 'ABC-1234', midia: 'Site', teor: 'Quero saber mais' })
    expect(note.startsWith(autocertoMarker(18452))).toBe(true)
    expect(note).toContain('Veículo de interesse: Honda Civic 2024')
    expect(note).toContain('Mensagem do cliente: Quero saber mais')
  })

  it('leaves out fields Autocerto sent empty', () => {
    expect(autocertoNote({ id: 1, veiculo: '', placa: '', cpf: '' })).not.toContain('Placa')
  })
})
