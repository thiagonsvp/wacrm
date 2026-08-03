import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { generateReply } from './generate'
import { logAiUsage } from './usage'
import {
  buildDealSignalPrompt,
  dealProductScope,
  parseDealSignal,
  rejectUpgradeTopUp,
  renderTranscript,
} from './deal-signal'
import { resolvePipelineStages, type PipelineStageMap } from '@/lib/deals/stage-map'
import {
  planTransition,
  type CurrentDeal,
  type DealSignal,
  type DealStatus,
  type TransitionPlan,
} from '@/lib/deals/transition'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { dispatchDealConversions } from '@/lib/meta/dispatch'
import type { AiConfig } from './types'

// ------------------------------------------------------------
// AI-driven sales pipeline.
//
// Runs on inbound customer messages: reads the thread with the account's
// BYO LLM key, then positions the contact's deal card on the board. The
// model only reports what it read (lib/ai/deal-signal.ts); every write is
// decided by the deterministic planner (lib/deals/transition.ts).
//
// Mirrors the auto-reply contract: owns its try/catch and NEVER throws —
// a slow or failing provider must not disturb the inbound webhook.
// ------------------------------------------------------------

const DEFAULT_COOLDOWN_MS = 3 * 60_000

/**
 * Minimum gap between two classifications of the same conversation.
 * Override with `AI_DEAL_PIPELINE_COOLDOWN_MS` (0 disables the gap).
 *
 * Customers routinely send "oi" / "boa tarde" / "tem iPhone 15?" as three
 * messages in ten seconds; without this each one would buy a separate
 * provider call for the same state.
 */
export function dealPipelineCooldownMs(): number {
  const raw = Number(process.env.AI_DEAL_PIPELINE_COOLDOWN_MS)
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_COOLDOWN_MS
}

const DEFAULT_EXCLUDED_TAGS = ['Fornecedor', 'Outros']

/** Fold accents and case, so "Fornecedor" matches however it was typed. */
function normalizeTag(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Tags that keep a contact off the sales board entirely.
 *
 * Not every WhatsApp thread is a customer. Suppliers, partners and the
 * shop's own staff all message the same number, and the classifier reads
 * those threads exactly as it reads a lead — it saw an internal chat
 * about an iPhone and recorded a closed sale. Three such cards were
 * sitting in Finalizado marked "won", inflating reported revenue by
 * R$12.399.
 *
 * Tagging is how the operator already separates these people, so the tag
 * is the natural signal. Override with `DEAL_PIPELINE_EXCLUDED_TAGS`
 * (comma-separated); set it empty to disable the exclusion.
 */
export function dealPipelineExcludedTags(): string[] {
  const raw = process.env.DEAL_PIPELINE_EXCLUDED_TAGS
  const list = raw == null ? DEFAULT_EXCLUDED_TAGS : raw.split(',')
  return list.map(normalizeTag).filter(Boolean)
}

/**
 * The excluded tag this contact carries, or null. Runs before the
 * provider call, so an excluded contact costs nothing.
 */
export async function excludedTagFor(
  db: SupabaseClient,
  contactId: string,
): Promise<string | null> {
  const excluded = dealPipelineExcludedTags()
  if (excluded.length === 0) return null

  const { data, error } = await db
    .from('contact_tags')
    .select('tags(name)')
    .eq('contact_id', contactId)
  if (error) {
    // Fail open: a tag lookup problem must not stop real leads being
    // classified. Worst case an excluded contact gets a card, which the
    // operator can delete — the reverse would silently drop customers.
    console.error('[ai deal pipeline] tag lookup failed:', error)
    return null
  }

  for (const row of (data ?? []) as { tags: { name: string } | { name: string }[] | null }[]) {
    const tags = Array.isArray(row.tags) ? row.tags : row.tags ? [row.tags] : []
    for (const t of tags) {
      if (t?.name && excluded.includes(normalizeTag(t.name))) return t.name
    }
  }
  return null
}

interface DispatchArgs {
  accountId: string
  conversationId: string
  contactId: string
  /** Audit column on a created deal (mirrors the auto-reply's sender-of-record). */
  configOwnerUserId: string
  /** Used as the card title when the model could not be identified. */
  contactName?: string | null
}

/**
 * Claim the right to classify this conversation now.
 *
 * One conditional UPDATE, so two inbound messages arriving together can
 * never both spend a provider call on the same thread: whoever's UPDATE
 * matches the cooldown predicate wins and the other gets no row back.
 * Same fail-safe direction as the auto-reply slot claim — we mark the
 * attempt *before* the call, so a crash mid-analysis costs one skipped
 * classification rather than a retry loop on the owner's key.
 */
async function claimAnalysisSlot(
  db: SupabaseClient,
  conversationId: string,
): Promise<boolean> {
  const cooldownMs = dealPipelineCooldownMs()
  const cutoff = new Date(Date.now() - cooldownMs).toISOString()

  const { data, error } = await db
    .from('conversations')
    .update({ ai_deal_analyzed_at: new Date().toISOString() })
    .eq('id', conversationId)
    .or(`ai_deal_analyzed_at.is.null,ai_deal_analyzed_at.lt.${cutoff}`)
    .select('id')

  if (error) {
    // Almost always "column ai_deal_analyzed_at does not exist" — i.e.
    // migration 042 hasn't been applied to this project yet. Log it
    // loudly: a silent return makes "the pipeline never moves" impossible
    // to diagnose from the outside.
    console.error('[ai deal pipeline] could not claim analysis slot:', error)
    return false
  }
  return (data?.length ?? 0) > 0
}

interface DealRow {
  id: string
  title: string
  value: number | null
  status: DealStatus
  stage_id: string
  conversation_id: string | null
  pipeline_stages: { position: number } | { position: number }[] | null
}

function stagePositionOf(row: DealRow): number {
  const s = row.pipeline_stages
  if (!s) return -1
  return Array.isArray(s) ? (s[0]?.position ?? -1) : s.position
}

/**
 * The card this conversation should drive, or null.
 *
 * Matched on conversation OR contact: the owner has cards they created by
 * hand before this feature existed (some with no `conversation_id` at
 * all), and classifying into a second card for the same contact would
 * silently duplicate their funnel. An exact conversation match wins;
 * otherwise the most recent card for the contact does.
 */
async function loadCurrentDeal(
  db: SupabaseClient,
  args: { accountId: string; conversationId: string; contactId: string },
): Promise<CurrentDeal | null> {
  const { data, error } = await db
    .from('deals')
    .select(
      'id, title, value, status, stage_id, conversation_id, pipeline_stages(position)',
    )
    .eq('account_id', args.accountId)
    .or(`conversation_id.eq.${args.conversationId},contact_id.eq.${args.contactId}`)
    .order('created_at', { ascending: false })

  if (error) throw error
  const rows = (data ?? []) as unknown as DealRow[]
  if (rows.length === 0) return null

  const row = rows.find((r) => r.conversation_id === args.conversationId) ?? rows[0]
  return {
    id: row.id,
    stagePosition: stagePositionOf(row),
    status: row.status,
    title: row.title,
    value: row.value,
  }
}

export interface AppliedPlan {
  /** The deal that was written — needed to attribute a conversion. */
  dealId: string
  description: string
  /** Deal state after the write, for the ad-platform dispatch. */
  status: DealStatus
  value: number | null
  currency: string | null
}

/** Apply a plan. Returns what was written, or null when nothing changed. */
export async function applyPlan(
  db: SupabaseClient,
  plan: TransitionPlan,
  ctx: {
    accountId: string
    conversationId: string
    contactId: string
    configOwnerUserId: string
    stages: PipelineStageMap
  },
): Promise<AppliedPlan | null> {
  if (plan.action === 'none') return null

  if (plan.action === 'create') {
    const { data: account } = await db
      .from('accounts')
      .select('default_currency')
      .eq('id', ctx.accountId)
      .maybeSingle()
    const currency = (account?.default_currency as string | undefined) ?? 'USD'

    const { data: created, error } = await db
      .from('deals')
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.configOwnerUserId,
        pipeline_id: ctx.stages.pipelineId,
        stage_id: plan.stageId,
        contact_id: ctx.contactId,
        conversation_id: ctx.conversationId,
        title: plan.title,
        value: plan.value,
        currency,
        status: plan.status,
        notes: 'Card criado automaticamente pela análise de IA da conversa.',
      })
      .select('id')
      .single()
    if (error) throw error
    return {
      dealId: created.id,
      description: `created "${plan.title}" (${plan.status}, ${plan.value})`,
      status: plan.status,
      value: plan.value,
      currency,
    }
  }

  const { data: updated, error } = await db
    .from('deals')
    .update({ ...plan.changes, updated_at: new Date().toISOString() })
    .eq('id', plan.dealId)
    .select('id, status, value, currency')
    .single()
  if (error) throw error
  return {
    dealId: plan.dealId,
    description: `updated ${plan.dealId}: ${JSON.stringify(plan.changes)}`,
    status: updated.status as DealStatus,
    value: updated.value as number | null,
    currency: updated.currency as string | null,
  }
}

export interface PipelineRunResult {
  /** What the model read, or null when its output was unusable. */
  signal: DealSignal | null
  /** What that means for the board, or null when there was no signal. */
  plan: TransitionPlan | null
  /** Human-readable description of the write, or null when nothing changed. */
  applied: string | null
}

/**
 * Classify one conversation and position its card. The single
 * implementation shared by the inbound dispatcher and the backfill
 * script, so a dry run can never describe behaviour that differs from
 * what production actually does.
 *
 * Assumes the caller has already checked eligibility (config loaded,
 * stages resolved, cooldown claimed). Pass `apply: false` to classify and
 * plan without writing.
 *
 * Throws on provider/DB failure — `dispatchInboundToDealPipeline` is the
 * never-throws boundary for the webhook path.
 */
export async function runDealPipelineForConversation(
  db: SupabaseClient,
  args: {
    config: AiConfig
    stages: PipelineStageMap
    accountId: string
    conversationId: string
    contactId: string
    configOwnerUserId: string
    contactName?: string | null
    apply?: boolean
  },
): Promise<PipelineRunResult> {
  const { config, stages, accountId, conversationId, contactId } = args
  const apply = args.apply !== false

  // Checked here rather than in the dispatcher so the backfill script
  // honours it too — the two must never disagree about who belongs on
  // the board.
  const excluded = await excludedTagFor(db, contactId)
  if (excluded) {
    console.log(
      `[ai deal pipeline] conversation ${conversationId}: skipped — contact is tagged "${excluded}"`,
    )
    return { signal: null, plan: null, applied: null }
  }

  const messages = await buildConversationContext(db, conversationId)
  if (!messages.some((m) => m.role === 'user')) {
    return { signal: null, plan: null, applied: null }
  }

  const transcript = renderTranscript(messages)

  const systemPrompt = buildDealSignalPrompt({
    // Per-account first: what the shop sells is the single biggest thing
    // that differs between customers, and an env var cannot vary by
    // account. Falls back to the env default for deployments that never
    // filled it in.
    productScope: config.dealProductScope?.trim() || dealProductScope(),
    businessContext: config.systemPrompt,
  })

  // Single flattened document, not chat turns — see renderTranscript.
  const { text, usage } = await generateReply({
    config,
    systemPrompt,
    messages: [{ role: 'user', content: transcript }],
  })

  // Fire-and-forget: logAiUsage swallows its own errors, so this floating
  // promise cannot reject. Logged regardless of what the model said — the
  // provider call happened either way.
  void logAiUsage(db, {
    accountId,
    conversationId,
    mode: 'deal_pipeline',
    provider: config.provider,
    model: config.model,
    usage,
  })

  const parsed: DealSignal | null = parseDealSignal(text)
  // Cross-check the price against the thread before it can reach the
  // board: an upgrade top-up read as the device price understates the
  // deal and would be reported to Meta as revenue.
  const signal = parsed ? rejectUpgradeTopUp(parsed, transcript) : null
  if (!signal) {
    console.warn(
      `[ai deal pipeline] unusable model output for conversation ${conversationId}:`,
      text.slice(0, 200),
    )
    return { signal: null, plan: null, applied: null }
  }

  const current = await loadCurrentDeal(db, { accountId, conversationId, contactId })
  const plan = planTransition({
    signal,
    current,
    stages,
    fallbackTitle: args.contactName?.trim() || 'Lead sem nome',
  })

  if (!apply) return { signal, plan, applied: null }

  const written = await applyPlan(db, plan, {
    accountId,
    conversationId,
    contactId,
    configOwnerUserId: args.configOwnerUserId,
    stages,
  })

  if (written) {
    // Report the outcome to Meta so ads that click to WhatsApp can
    // optimise for real sales. Owns its errors — a failing ad-platform
    // call must never undo a deal write that already succeeded.
    await dispatchDealConversions(db, {
      accountId,
      dealId: written.dealId,
      contactId,
      // Any card this pipeline writes is at least a qualified lead: it
      // is only ever created from a "qualified" signal or better.
      qualified: true,
      won: written.status === 'won',
      value: written.value,
      currency: written.currency,
    })
  }

  return { signal, plan, applied: written?.description ?? null }
}

/**
 * Classify a conversation and move its deal card accordingly.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off for the account, or the deal pipeline not opted in
 *   - this conversation was classified within the cooldown
 *   - the account is over its classification rate limit
 *   - the board has no Lead Qualificado / Negociação / Finalizado stages
 *   - the thread has no customer message to read
 *   - the model returned nothing usable
 */
export async function dispatchInboundToDealPipeline(
  args: DispatchArgs,
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.dealPipelineEnabled) return

    // Claim before any expensive work so concurrent inbounds collapse to
    // one call for this thread.
    if (!(await claimAnalysisSlot(db, conversationId))) return

    const acctLimit = checkRateLimit(
      `ai-deal-pipeline:${accountId}`,
      RATE_LIMITS.aiDealPipelineAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai deal pipeline] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    const stages = await resolvePipelineStages(db, accountId, {
      qualified: config.dealStageQualifiedId,
      negotiating: config.dealStageNegotiatingId,
      closed: config.dealStageClosedId,
    })
    if (!stages) return

    const { signal, plan, applied } = await runDealPipelineForConversation(db, {
      config,
      stages,
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      contactName: args.contactName,
    })
    if (!signal || !plan) return

    console.log(
      `[ai deal pipeline] conversation ${conversationId}: outcome=${signal.outcome} ` +
        `model=${signal.model ?? '-'} price=${signal.price ?? '-'} → ` +
        (applied ?? `no change (${plan.action === 'none' ? plan.reason : plan.action})`),
    )
  } catch (err) {
    console.error('[ai deal pipeline] dispatch failed:', err)
  }
}
