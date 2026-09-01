// ============================================================
// Shared shapes for the ads-performance report.
//
// The report answers one question: for every campaign and every
// creative, what did the money buy — not clicks, but qualified
// leads, live negotiations and closed sales.
//
// That means joining two systems that name things differently:
//
//   Windsor.ai  → the media side, one row per date × ad, carrying
//                 the REAL Marketing-API campaign name and ad name.
//   contacts    → the CRM side, one row per lead, carrying whatever
//                 the WhatsApp referral payload gave us.
//
// The only field both sides agree on is the AD ID:
// `contacts.acquisition_source_id` is Meta's `referral.source_id`,
// which is the ad id, and Windsor exposes the same value as
// `ad_id`. Everything else about a lead's origin is creative copy:
// `acquisition_campaign` is the ad HEADLINE ("Converse conosco"),
// not the campaign name ("[SM] [Vendas] [WHATSAPP] [ABO]"), so
// matching on it — which is what this report used to do — matches
// nothing and reports zero leads on every campaign.
// ============================================================

/** How a lead's card sits on the sales board right now. */
export type FunnelBucket =
  /** No deal card at all — nobody worked the lead yet. */
  | 'none'
  /** A card exists, but in a stage before "qualified". */
  | 'early'
  | 'qualified'
  | 'negotiating'
  | 'won'
  | 'lost'
  | 'disqualified'

/** Per-lead counters, shared by every grouping level (ad, campaign, total). */
export interface FunnelCounts {
  leads: number
  noDeal: number
  early: number
  qualified: number
  negotiating: number
  won: number
  lost: number
  disqualified: number
  /** Sum of `deals.value` on won cards — realised revenue. */
  revenue: number
  /** Sum of `deals.value` on cards still open — the live pipeline. */
  openValue: number
}

export function emptyCounts(): FunnelCounts {
  return {
    leads: 0,
    noDeal: 0,
    early: 0,
    qualified: 0,
    negotiating: 0,
    won: 0,
    lost: 0,
    disqualified: 0,
    revenue: 0,
    openValue: 0,
  }
}

export function addCounts(target: FunnelCounts, source: FunnelCounts): void {
  target.leads += source.leads
  target.noDeal += source.noDeal
  target.early += source.early
  target.qualified += source.qualified
  target.negotiating += source.negotiating
  target.won += source.won
  target.lost += source.lost
  target.disqualified += source.disqualified
  target.revenue += source.revenue
  target.openValue += source.openValue
}

/** The CRM funnel for one ad id, as returned by /api/performance/funnel. */
export interface AdFunnel extends FunnelCounts {
  /** `contacts.acquisition_source_id` — Meta's ad id. The join key. */
  adId: string
  /** The ad's headline as WhatsApp delivered it. Display only. */
  headline: string | null
  /** Creative thumbnail captured from the referral payload. */
  imageUrl: string | null
}

/** One day of the lead cohort, keyed by the day the LEAD arrived. */
export interface FunnelDay extends FunnelCounts {
  /** YYYY-MM-DD in the viewer's timezone. */
  day: string
}

export interface OriginSlice {
  /** 'Instagram' | 'Facebook' | 'Não informado' */
  name: string
  leads: number
}

export interface FunnelPayload {
  /** Account default currency, for every money format on the page. */
  currency: string
  /**
   * The board columns this report read as "qualified" / "negotiating" /
   * "closed", so the operator can tell whether it looked at the right
   * ones. Null when no board matched — the funnel columns then stay
   * empty rather than guessing.
   */
  stageNames: {
    qualified: string
    negotiating: string
    closed: string
    disqualified: string | null
  } | null
  /** Per-ad funnel, only for leads that carried an ad id. */
  ads: AdFunnel[]
  /** Leads with no ad attribution at all (organic, direct, saved number). */
  organic: FunnelCounts
  /** Every lead in the period, attributed or not. */
  totals: FunnelCounts
  daily: FunnelDay[]
  origins: OriginSlice[]
  /** Contacts skipped because they carry an excluded tag (Fornecedor / Outros). */
  excludedContacts: number
}

// ------------------------------------------------------------
// Media side
// ------------------------------------------------------------

/** One Windsor.ai row, already coerced out of `Record<string, unknown>`. */
export interface AdMedia {
  /** YYYY-MM-DD, in the ad account's reporting timezone. */
  date: string
  adId: string
  campaignId: string
  campaign: string
  adName: string
  adsetName: string
  imageUrl: string | null
  spend: number
  impressions: number
  reach: number
  clicks: number
}

/**
 * Identity of an ad the windowed media query did NOT return, recovered
 * by a second, wider Windsor lookup (`/api/windsor/ad-identity`).
 *
 * Three real situations produce leads whose ad id has no media row:
 * the ad lives in a DIFFERENT ad account than the one pinned in
 * Configurações (the whole Smart Especializada dataset — pinned to
 * "Smart 2026", ads actually in "Victor Hugo Ramos"); the ad was
 * paused before the selected window, so the date-filtered query never
 * sees it; or the ad is a boosted post Windsor doesn't track at all.
 * The first two are recoverable: an unfiltered, year-wide, id-filtered
 * query returns the ad's names, and the lead can then be grouped under
 * its REAL campaign instead of a "no match" bucket. Spend from that
 * wide query is deliberately NOT carried — money from outside the
 * window (or another client's account) must never enter the totals.
 */
export interface AdIdentity {
  adId: string
  campaign: string
  campaignId: string
  adName: string
  adsetName: string
  /** Which Meta ad account the ad actually lives in. */
  accountName: string
  imageUrl: string | null
}

/** A campaign or creative row after the media × CRM join. */
export interface PerformanceRow extends FunnelCounts {
  key: string
  name: string
  /** Ad set for a creative row, campaign for a campaign row. */
  subtitle: string
  imageUrl: string | null
  spend: number
  impressions: number
  reach: number
  clicks: number
  /**
   * False when the CRM produced leads for an ad id Windsor never
   * reported. Those rows are kept and flagged rather than dropped —
   * silently losing attributed leads is how a report starts lying.
   */
  matched: boolean
}
