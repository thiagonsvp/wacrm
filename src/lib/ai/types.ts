// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI or Anthropic.
// ============================================================

export type AiProvider = 'openai' | 'anthropic'

/**
 * Account AI setup, decrypted and ready to use. Produced by
 * `loadAiConfig` — `apiKey` is the plaintext BYO provider key
 * (stored AES-256-GCM-encrypted at rest).
 */
export interface AiConfig {
  provider: AiProvider
  model: string
  apiKey: string
  systemPrompt: string | null
  isActive: boolean
  autoReplyEnabled: boolean
  autoReplyMaxPerConversation: number
  /** Where auto-reply hands a conversation off when the model bails: an
   *  agent's `auth.users.id`, or null to leave it unassigned (drop into
   *  the shared queue). */
  handoffAgentId: string | null
  /** Optional OpenAI-compatible key for embeddings. When set, the
   *  knowledge base is embedded and semantic retrieval turns on; when
   *  null, retrieval falls back to lexical full-text search. */
  embeddingsApiKey: string | null
  /** Gates the AI sales-pipeline classifier (migration 042). Independent
   *  of `autoReplyEnabled`: registering a key so the inbox can draft
   *  replies must not start writing to the deals board as a side effect,
   *  since that mutates business records (stage, value, won/lost). */
  dealPipelineEnabled: boolean
  /** What this account sells, in the operator's own words — the single
   *  biggest thing that differs between customers, so it lives in the
   *  database rather than in DEAL_PRODUCT_SCOPE. Null falls back to the
   *  env var, then to the built-in default. */
  dealProductScope: string | null
  /** Per-account instructions defining what counts as each sales outcome. */
  dealPipelineInstructions: string | null
  /** Stage ids chosen in Settings. Null falls back to matching stage
   *  names, which cannot work for a board in another language. */
  dealStageQualifiedId: string | null
  dealStageNegotiatingId: string | null
  dealStageClosedId: string | null
}

/**
 * The only fields a provider call actually needs. Narrower than
 * `AiConfig` on purpose: connectivity checks and one-off generations
 * should not have to invent values for every unrelated account setting,
 * and widening `AiConfig` should not break them.
 */
export type AiCredentials = Pick<AiConfig, 'provider' | 'model' | 'apiKey'>

/** A single conversation turn in the shape both providers accept. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Token counts for one provider call, normalized across OpenAI
 * (`prompt`/`completion`) and Anthropic (`input`/`output`). Null when
 * the provider didn't return usage. Logged to `ai_usage_log`.
 */
export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** The part of `promptTokens` the provider served from its prompt
   *  cache (OpenAI `prompt_tokens_details.cached_tokens`, Anthropic
   *  `cache_read_input_tokens`) — billed at a fraction of the full rate,
   *  so it's what separates "tokens sent" from "tokens paid for". Absent
   *  when the provider didn't report it. */
  cachedPromptTokens?: number
}

/** Raw text + usage a provider adapter returns before handoff parsing. */
export interface ProviderResult {
  text: string
  usage: AiUsage | null
}

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff sentinel stripped. */
  text: string
  /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean
  /** Provider token usage for this call, or null when unavailable. */
  usage: AiUsage | null
}

/**
 * Typed error for every AI failure mode. `status` maps cleanly to an
 * HTTP response in the draft route; `code` lets the UI/tests branch
 * (invalid_key vs rate_limited vs timeout, etc.).
 */
export class AiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'AiError'
    this.code = opts.code ?? 'ai_error'
    this.status = opts.status ?? 502
  }
}
