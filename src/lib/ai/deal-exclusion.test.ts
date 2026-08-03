import { afterEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { dealPipelineExcludedTags, excludedTagFor } from './deal-pipeline'

const ORIGINAL = process.env.DEAL_PIPELINE_EXCLUDED_TAGS
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DEAL_PIPELINE_EXCLUDED_TAGS
  else process.env.DEAL_PIPELINE_EXCLUDED_TAGS = ORIGINAL
})

/** Stub returning the tag rows PostgREST would give for a contact. */
function dbWithTags(
  rows: { tags: { name: string } | { name: string }[] | null }[],
  error: { message: string } | null = null,
): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: error ? null : rows, error }),
      }),
    }),
  } as unknown as SupabaseClient
}

describe('dealPipelineExcludedTags', () => {
  it('defaults to the supplier / misc tags', () => {
    delete process.env.DEAL_PIPELINE_EXCLUDED_TAGS
    expect(dealPipelineExcludedTags()).toEqual(['fornecedor', 'outros'])
  })

  it('is overridable per deployment', () => {
    process.env.DEAL_PIPELINE_EXCLUDED_TAGS = 'Parceiro, Interno'
    expect(dealPipelineExcludedTags()).toEqual(['parceiro', 'interno'])
  })

  it('can be disabled with an empty value', () => {
    process.env.DEAL_PIPELINE_EXCLUDED_TAGS = ''
    expect(dealPipelineExcludedTags()).toEqual([])
  })
})

describe('excludedTagFor', () => {
  it('flags a contact carrying an excluded tag', async () => {
    delete process.env.DEAL_PIPELINE_EXCLUDED_TAGS
    const db = dbWithTags([{ tags: { name: 'Fornecedor' } }])
    expect(await excludedTagFor(db, 'c1')).toBe('Fornecedor')
  })

  it('matches regardless of accents and case', async () => {
    process.env.DEAL_PIPELINE_EXCLUDED_TAGS = 'Indicação'
    const db = dbWithTags([{ tags: { name: 'INDICACAO' } }])
    expect(await excludedTagFor(db, 'c1')).toBe('INDICACAO')
  })

  it('ignores a contact with only ordinary tags', async () => {
    delete process.env.DEAL_PIPELINE_EXCLUDED_TAGS
    const db = dbWithTags([{ tags: { name: 'Instagram' } }, { tags: { name: 'Loja' } }])
    expect(await excludedTagFor(db, 'c1')).toBeNull()
  })

  it('finds the excluded tag among several', async () => {
    delete process.env.DEAL_PIPELINE_EXCLUDED_TAGS
    const db = dbWithTags([{ tags: { name: 'Instagram' } }, { tags: { name: 'Outros' } }])
    expect(await excludedTagFor(db, 'c1')).toBe('Outros')
  })

  it('handles an untagged contact', async () => {
    delete process.env.DEAL_PIPELINE_EXCLUDED_TAGS
    expect(await excludedTagFor(dbWithTags([]), 'c1')).toBeNull()
  })

  it('tolerates the embedded row arriving as an array', async () => {
    // PostgREST returns an object or an array depending on how it infers
    // the relationship; both shapes must resolve.
    delete process.env.DEAL_PIPELINE_EXCLUDED_TAGS
    const db = dbWithTags([{ tags: [{ name: 'Fornecedor' }] }])
    expect(await excludedTagFor(db, 'c1')).toBe('Fornecedor')
  })

  it('skips the query entirely when the exclusion is disabled', async () => {
    process.env.DEAL_PIPELINE_EXCLUDED_TAGS = ''
    const db = dbWithTags([{ tags: { name: 'Fornecedor' } }])
    expect(await excludedTagFor(db, 'c1')).toBeNull()
  })

  it('fails open when the tag lookup errors', async () => {
    // A tag-lookup problem must not stop real leads being classified.
    // A stray card is deletable; a silently dropped customer is not
    // recoverable.
    delete process.env.DEAL_PIPELINE_EXCLUDED_TAGS
    const db = dbWithTags([], { message: 'boom' })
    expect(await excludedTagFor(db, 'c1')).toBeNull()
  })
})
