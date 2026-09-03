import { describe, expect, it } from 'vitest'
import { resolveLeadOrigin } from './queries'

describe('resolveLeadOrigin', () => {
  it('uses the persisted acquisition source when available', () => {
    expect(resolveLeadOrigin(' Google ', [])).toBe('Google')
    expect(resolveLeadOrigin('Facebook', [{ tags: { name: 'Google' } }])).toBe(
      'Facebook',
    )
  })

  it('falls back to the Google tag when the acquisition source is empty', () => {
    expect(
      resolveLeadOrigin(null, [{ tags: { name: ' google ' } }]),
    ).toBe('Google')
  })

  it('supports the other source tags with the same fallback', () => {
    expect(resolveLeadOrigin(null, [{ tags: { name: 'Instagram' } }])).toBe(
      'Instagram',
    )
    expect(resolveLeadOrigin(undefined, [{ tags: { name: 'Facebook' } }])).toBe(
      'Facebook',
    )
  })

  it('keeps unrelated tags in the organic bucket', () => {
    expect(resolveLeadOrigin(null, [{ tags: { name: 'Orçamento' } }])).toBe(
      'Orgânico / não informado',
    )
  })
})
