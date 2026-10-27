import type { SupabaseClient } from '@supabase/supabase-js'
import { findOrCreateContact } from '@/lib/api/v1/contacts'
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags'
import { isValidE164 } from '@/lib/whatsapp/phone-utils'

/**
 * Autocerto lead webhook (https://autocerto.com/Faq/integracao-de-leads-via-webhook/75/detalhes).
 *
 * Autocerto POSTs each new lead as JSON every 30 minutes, with the token we
 * gave them in `Authorization: Bearer …`. Any 2xx marks the lead delivered;
 * anything else and it is re-sent next cycle — so a lead we cannot use
 * (no phone) is acknowledged rather than bounced forever, and a lead we
 * already have is recognised by its Autocerto id and not filed twice.
 * Every field is always present; unfilled ones arrive as "".
 */
export interface AutocertoLead {
  id?: number | string
  idLoja?: number | string
  loja?: string
  nome?: string
  email?: string
  telefone?: string
  telefone2?: string
  cpf?: string
  dataLead?: string
  midia?: string
  veiculo?: string
  placa?: string
  teor?: string
}

export const AUTOCERTO_TAG = 'Autocerto'

/** Marker written into the note; how a re-sent lead is recognised. */
export function autocertoMarker(id: AutocertoLead['id']): string {
  return `[Autocerto #${String(id ?? '').trim()}]`
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())

/**
 * Brazilian number as E.164. Autocerto sends digits only and usually
 * without the country code ("11912345678"); a number that already has
 * 55 is kept as is.
 */
export function autocertoPhone(raw: unknown): string | null {
  const digits = text(raw).replace(/\D/g, '').replace(/^0+/, '')
  if (!digits) return null
  const withCountry =
    digits.length === 10 || digits.length === 11
      ? `55${digits}`
      : digits.startsWith('55') && (digits.length === 12 || digits.length === 13)
        ? digits
        : null
  if (!withCountry) return null
  const e164 = `+${withCountry}`
  return isValidE164(e164) ? e164 : null
}

/** Human-readable note with everything that has no field of its own. */
export function autocertoNote(lead: AutocertoLead): string {
  const when = text(lead.dataLead)
  const lines = [
    `${autocertoMarker(lead.id)} Lead recebido da Autocerto`,
    text(lead.veiculo) && `Veículo de interesse: ${text(lead.veiculo)}`,
    text(lead.placa) && `Placa: ${text(lead.placa)}`,
    text(lead.midia) && `Origem: ${text(lead.midia)}`,
    text(lead.loja) && `Loja: ${text(lead.loja)}`,
    text(lead.teor) && `Mensagem do cliente: ${text(lead.teor)}`,
    text(lead.cpf) && `CPF: ${text(lead.cpf)}`,
    text(lead.telefone2) && `Telefone 2: ${text(lead.telefone2)}`,
    when && `Data do lead: ${when}`,
  ]
  return lines.filter(Boolean).join('\n')
}

export type IngestResult =
  | { status: 'created' | 'updated'; contactId: string; dealId: string | null }
  | { status: 'duplicate'; contactId: string | null }
  | { status: 'skipped'; reason: string }

/**
 * File one Autocerto lead: contact (found by phone or created), the
 * "Autocerto" tag added to whatever tags it already has, a note with the
 * lead's details, and a card in the first column of the account's main
 * pipeline — unless the contact already has an open card there.
 */
export async function ingestAutocertoLead(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  lead: AutocertoLead
): Promise<IngestResult> {
  const leadId = text(lead.id)
  if (!leadId) return { status: 'skipped', reason: 'lead sem id' }

  // Re-sent lead (their retry, or ours answering slowly): already filed.
  const marker = autocertoMarker(leadId)
  const { data: seen } = await db
    .from('contact_notes')
    .select('contact_id')
    .eq('account_id', accountId)
    .like('note_text', `${marker}%`)
    .limit(1)
    .maybeSingle()
  if (seen) return { status: 'duplicate', contactId: (seen.contact_id as string) ?? null }

  const phone = autocertoPhone(lead.telefone) ?? autocertoPhone(lead.telefone2)
  if (!phone) return { status: 'skipped', reason: 'lead sem telefone válido' }

  const contact = await findOrCreateContact(db, accountId, auditUserId, {
    phone,
    name: text(lead.nome) || null,
    email: text(lead.email) || null,
  })

  // Add the tag without touching the contact's other tags.
  const { tagIdByKey } = await resolveImportTagIds(db, {
    accountId,
    userId: auditUserId,
    tagNames: [AUTOCERTO_TAG],
    canCreateTags: true,
  })
  for (const tagId of tagIdByKey.values()) {
    const { data: has } = await db
      .from('contact_tags')
      .select('id')
      .eq('contact_id', contact.id)
      .eq('tag_id', tagId)
      .limit(1)
      .maybeSingle()
    if (!has) await db.from('contact_tags').insert({ contact_id: contact.id, tag_id: tagId })
  }

  const { error: noteError } = await db.from('contact_notes').insert({
    contact_id: contact.id,
    account_id: accountId,
    user_id: auditUserId,
    note_text: autocertoNote(lead),
  })
  if (noteError) throw new Error(`note insert failed: ${noteError.message}`)

  // Card in the first column of the main (oldest) pipeline.
  let dealId: string | null = null
  const { data: pipeline } = await db
    .from('pipelines')
    .select('id')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (pipeline) {
    const { data: openDeal } = await db
      .from('deals')
      .select('id')
      .eq('account_id', accountId)
      .eq('pipeline_id', pipeline.id)
      .eq('contact_id', contact.id)
      .eq('status', 'open')
      .limit(1)
      .maybeSingle()
    if (openDeal) {
      dealId = openDeal.id as string
    } else {
      const { data: stage } = await db
        .from('pipeline_stages')
        .select('id')
        .eq('pipeline_id', pipeline.id)
        .order('position', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (stage) {
        const { data: deal, error: dealError } = await db
          .from('deals')
          .insert({
            account_id: accountId,
            user_id: auditUserId,
            pipeline_id: pipeline.id,
            stage_id: stage.id,
            contact_id: contact.id,
            title: text(lead.veiculo) || text(lead.nome) || 'Lead Autocerto',
            value: 0,
            status: 'open',
            notes: marker,
          })
          .select('id')
          .single()
        if (dealError) throw new Error(`deal insert failed: ${dealError.message}`)
        dealId = deal.id as string
      }
    }
  }

  return { status: contact.created ? 'created' : 'updated', contactId: contact.id, dealId }
}
