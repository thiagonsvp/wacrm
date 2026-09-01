// ============================================================
// The media × CRM join, and every rate derived from it.
//
// Pure functions on purpose: this is the part of the report that
// can be wrong in ways nobody notices (a lead attached to the
// wrong campaign still renders a plausible-looking table), so it
// is the part that gets unit tests.
// ============================================================

import {
  addCounts,
  emptyCounts,
  type AdFunnel,
  type AdIdentity,
  type AdMedia,
  type FunnelCounts,
  type PerformanceRow,
} from './types'

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const text = (v: unknown): string => String(v ?? '').trim()

/** YYYY-MM-DD out of whatever shape Windsor puts in `date`. */
export function dateKey(v: unknown): string {
  return text(v).match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ''
}

/**
 * Coerce Windsor's duck-typed rows into `AdMedia`.
 *
 * Rows without an `ad_id` are kept — a Google Ads response, or a Meta
 * response at campaign grain, still carries spend that belongs in the
 * totals. They simply can never receive leads, which the empty
 * `adId` makes explicit downstream.
 */
export function toAdMedia(row: Record<string, unknown>): AdMedia {
  return {
    date: dateKey(row.date),
    adId: text(row.ad_id),
    campaignId: text(row.campaign_id),
    campaign: text(row.campaign),
    adName: text(row.ad_name),
    adsetName: text(row.adset_name),
    imageUrl: text(row.image_url) || null,
    spend: num(row.spend),
    impressions: num(row.impressions),
    reach: num(row.reach),
    clicks: num(row.clicks),
  }
}

/** Coerce one `/api/windsor/ad-identity` row. */
export function toAdIdentity(row: Record<string, unknown>): AdIdentity {
  return {
    adId: text(row.ad_id),
    campaign: text(row.campaign),
    campaignId: text(row.campaign_id),
    adName: text(row.ad_name),
    adsetName: text(row.adset_name),
    accountName: text(row.account_name),
    imageUrl: text(row.image_url) || null,
  }
}

/** One identity per ad id, first non-empty value wins per field. */
export function indexIdentity(rows: AdIdentity[]): Map<string, AdIdentity> {
  const byAd = new Map<string, AdIdentity>()
  for (const row of rows) {
    if (!row.adId) continue
    const found = byAd.get(row.adId)
    if (!found) {
      byAd.set(row.adId, { ...row })
      continue
    }
    found.campaign ||= row.campaign
    found.campaignId ||= row.campaignId
    found.adName ||= row.adName
    found.adsetName ||= row.adsetName
    found.accountName ||= row.accountName
    found.imageUrl ??= row.imageUrl
  }
  return byAd
}

export interface MediaTotals {
  spend: number
  impressions: number
  reach: number
  clicks: number
}

/**
 * Spend per calendar day, for the trend chart.
 *
 * Windsor reports in the ad account's timezone and the CRM series is
 * built in the viewer's; for a Brazilian account those agree, and
 * where they don't the drift is a few hours at the edges of the
 * window — worth naming, not worth inventing a reconciliation for.
 */
export function spendByDay(rows: AdMedia[]): Map<string, number> {
  const byDay = new Map<string, number>()
  for (const row of rows) {
    if (!row.date) continue
    byDay.set(row.date, (byDay.get(row.date) ?? 0) + row.spend)
  }
  return byDay
}

export function mediaTotals(rows: AdMedia[]): MediaTotals {
  return rows.reduce<MediaTotals>(
    (acc, r) => ({
      spend: acc.spend + r.spend,
      impressions: acc.impressions + r.impressions,
      reach: acc.reach + r.reach,
      clicks: acc.clicks + r.clicks,
    }),
    { spend: 0, impressions: 0, reach: 0, clicks: 0 },
  )
}

/**
 * Collapse the day × ad rows Windsor returns into one entry per ad id,
 * keeping the identity fields from the first row that carries them.
 *
 * Windsor repeats campaign / ad names on every daily row, but an ad
 * that spent nothing on a given day can come back with blanks, so the
 * names are filled in on a first-non-empty basis rather than
 * last-write-wins.
 */
export function indexByAd(rows: AdMedia[]): Map<string, AdMedia> {
  const byAd = new Map<string, AdMedia>()
  for (const row of rows) {
    if (!row.adId) continue
    const found = byAd.get(row.adId)
    if (!found) {
      byAd.set(row.adId, { ...row })
      continue
    }
    found.spend += row.spend
    found.impressions += row.impressions
    found.reach += row.reach
    found.clicks += row.clicks
    found.campaign ||= row.campaign
    found.campaignId ||= row.campaignId
    found.adName ||= row.adName
    found.adsetName ||= row.adsetName
    found.imageUrl ??= row.imageUrl
  }
  return byAd
}

interface Draft {
  key: string
  name: string
  subtitle: string
  imageUrl: string | null
  spend: number
  impressions: number
  reach: number
  clicks: number
  counts: FunnelCounts
  matched: boolean
}

function draft(key: string, name: string): Draft {
  return {
    key,
    name,
    subtitle: '',
    imageUrl: null,
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    counts: emptyCounts(),
    matched: false,
  }
}

const finish = (d: Draft): PerformanceRow => ({
  key: d.key,
  name: d.name,
  subtitle: d.subtitle,
  imageUrl: d.imageUrl,
  spend: d.spend,
  impressions: d.impressions,
  reach: d.reach,
  clicks: d.clicks,
  matched: d.matched,
  ...d.counts,
})

/** Sort strongest-first: spend, then sales, then leads. */
function byWeight(a: PerformanceRow, b: PerformanceRow): number {
  return b.spend - a.spend || b.won - a.won || b.leads - a.leads
}

const UNMATCHED = '__unmatched__'
const UNMATCHED_LABEL = 'Sem correspondência no Windsor'

/** "Paused before the window / other account" annotation for a group. */
function identitySubtitle(identity: AdIdentity): string {
  return identity.accountName
    ? `Sem investimento no período · conta ${identity.accountName}`
    : 'Sem investimento no período'
}

/**
 * Group by campaign.
 *
 * Leads reach a campaign through their ad id, never through
 * `acquisition_campaign` — see the note in `types.ts`. When the ad id
 * has no media row in the window, the `identity` map (the wide,
 * id-filtered Windsor lookup) supplies the ad's REAL campaign, so the
 * lead still lands on the right row — sharing the campaign-id key with
 * the media branch, so a campaign that also spent in-window absorbs
 * the orphan leads instead of splitting into two rows. Only ids
 * Windsor has never heard of (boosted posts) fall into the explicit
 * "no match" bucket, where they stay visible and stay out of the real
 * campaigns' rates.
 */
export function groupByCampaign(
  media: AdMedia[],
  funnels: AdFunnel[],
  identity?: Map<string, AdIdentity>,
): PerformanceRow[] {
  const byAd = indexByAd(media)
  const groups = new Map<string, Draft>()

  const at = (key: string, name: string): Draft => {
    const found = groups.get(key)
    if (found) return found
    const created = draft(key, name)
    groups.set(key, created)
    return created
  }

  for (const row of media) {
    const key = row.campaignId || row.campaign || UNMATCHED
    const group = at(key, row.campaign || 'Campanha sem nome')
    group.spend += row.spend
    group.impressions += row.impressions
    group.reach += row.reach
    group.clicks += row.clicks
    group.matched = true
  }

  for (const ad of funnels) {
    const source = byAd.get(ad.adId)
    const recovered = source ? undefined : identity?.get(ad.adId)
    let group: Draft
    if (source) {
      group = at(source.campaignId || source.campaign || UNMATCHED, source.campaign || 'Campanha sem nome')
    } else if (recovered && (recovered.campaignId || recovered.campaign)) {
      group = at(recovered.campaignId || recovered.campaign, recovered.campaign || 'Campanha sem nome')
      // A campaign that also spent in-window keeps its own subtitle —
      // the annotation only describes rows that exist purely through
      // recovered identity.
      if (!group.matched) group.subtitle = identitySubtitle(recovered)
    } else {
      group = at(UNMATCHED, UNMATCHED_LABEL)
      group.subtitle = 'Anúncios que o Windsor.ai não conhece (ex.: post impulsionado)'
    }
    // AdFunnel extends FunnelCounts, so the identity fields simply ride
    // along unread — no projection needed.
    addCounts(group.counts, ad)
  }

  return [...groups.values()].map(finish).sort(byWeight)
}

/** Group by creative (one row per ad id). */
export function groupByCreative(
  media: AdMedia[],
  funnels: AdFunnel[],
  identity?: Map<string, AdIdentity>,
): PerformanceRow[] {
  const byAd = indexByAd(media)
  const groups = new Map<string, Draft>()

  for (const [adId, row] of byAd) {
    const group = draft(adId, row.adName || 'Criativo sem nome')
    group.subtitle = row.campaign
    group.imageUrl = row.imageUrl
    group.spend = row.spend
    group.impressions = row.impressions
    group.reach = row.reach
    group.clicks = row.clicks
    group.matched = true
    groups.set(adId, group)
  }

  for (const ad of funnels) {
    const found = groups.get(ad.adId)
    const recovered = found ? undefined : identity?.get(ad.adId)
    const group =
      found ??
      draft(ad.adId, recovered?.adName || ad.headline || `Anúncio ${ad.adId}`)
    if (!found) {
      group.subtitle = recovered
        ? [recovered.campaign, identitySubtitle(recovered)].filter(Boolean).join(' · ')
        : 'Sem correspondência no Windsor'
      group.imageUrl = recovered?.imageUrl ?? ad.imageUrl
      groups.set(ad.adId, group)
    }
    // The headline is the only creative label a non-matching ad has, and
    // it is what the operator recognises from WhatsApp — keep it beside
    // the Windsor ad name rather than instead of it.
    if (found && ad.headline && !group.subtitle.includes(ad.headline)) {
      group.subtitle = group.subtitle ? `${group.subtitle} · ${ad.headline}` : ad.headline
    }
    group.imageUrl ??= ad.imageUrl
    // AdFunnel extends FunnelCounts, so the identity fields simply ride
    // along unread — no projection needed.
    addCounts(group.counts, ad)
  }

  return [...groups.values()].map(finish).sort(byWeight)
}

// ------------------------------------------------------------
// Derived rates. Every one of them returns null rather than 0 when
// its denominator is empty, so the UI can print "—" instead of a
// confident-looking zero.
// ------------------------------------------------------------

const ratio = (top: number, bottom: number): number | null =>
  bottom > 0 ? top / bottom : null

export const ctr = (r: { clicks: number; impressions: number }) =>
  ratio(r.clicks, r.impressions)
export const cpc = (r: { spend: number; clicks: number }) => ratio(r.spend, r.clicks)
export const cpm = (r: { spend: number; impressions: number }) =>
  ratio(r.spend * 1000, r.impressions)
/** Cost per lead. */
export const cpl = (r: { spend: number; leads: number }) => ratio(r.spend, r.leads)
/** Cost per qualified lead — the first number that means intent, not curiosity. */
export const cpql = (r: { spend: number } & FunnelCounts) =>
  ratio(r.spend, reachedQualified(r))
/** Customer acquisition cost. */
export const cac = (r: { spend: number; won: number }) => ratio(r.spend, r.won)
export const roas = (r: { revenue: number; spend: number }) => ratio(r.revenue, r.spend)
export const ticket = (r: { revenue: number; won: number }) => ratio(r.revenue, r.won)

/**
 * Leads that got at least as far as "qualified".
 *
 * The per-stage counters are a SNAPSHOT — a lead that already bought
 * is no longer sitting in the qualified column — so any rate about
 * "how many qualified" has to add the stages downstream of it back in.
 * `lost` counts too: a deal is only lost after someone worked it.
 */
export function reachedQualified(c: FunnelCounts): number {
  return c.qualified + c.negotiating + c.won + c.lost
}

/** Leads that got at least as far as a negotiation. */
export function reachedNegotiating(c: FunnelCounts): number {
  return c.negotiating + c.won
}

export const qualificationRate = (c: FunnelCounts) => ratio(reachedQualified(c), c.leads)
export const negotiationRate = (c: FunnelCounts) =>
  ratio(reachedNegotiating(c), reachedQualified(c))
export const closeRate = (c: FunnelCounts) => ratio(c.won, reachedNegotiating(c))
export const leadToSaleRate = (c: FunnelCounts) => ratio(c.won, c.leads)
