// ============================================================
// GET /api/performance/funnel?from&to&tz
//
// The CRM half of the ads report: for every ad id that produced a
// lead in the window, where those leads ended up on the sales board.
//
// It runs on the server rather than in the browser for three
// reasons. It has to read `ai_configs` to learn which board columns
// the operator pinned as qualified / negotiating / closed — a table
// the browser client has no business selecting from. It reuses the
// exact stage resolution the AI classifier writes with
// (`stage-map.ts`), so the report can never disagree with the board
// about what "Negociação" means. And it keeps the tag-exclusion rule
// in one place instead of forking it per page.
//
// COHORT SEMANTICS. Leads are bucketed by the day the LEAD arrived,
// and a lead carries its outcome back to that day however long the
// sale took. A deal closed in September for a lead that clicked the
// ad in August is August's sale — that is the only reading under
// which "spend on day X" and "sales from day X" belong on the same
// row. It also means the most recent days always look weaker than
// they will eventually be.
// ============================================================

import { NextResponse } from 'next/server';
import { requireModule, toErrorResponse } from '@/lib/auth/account';
import { dealPipelineExcludedTags } from '@/lib/ai/deal-pipeline';
import { selectAiConfigRow } from '@/lib/ai/config';
import {
  matchStageSlots,
  mapConfiguredStages,
  type PipelineStageMap,
  type StageRow,
} from '@/lib/deals/stage-map';
import {
  emptyCounts,
  type AdFunnel,
  type FunnelBucket,
  type FunnelCounts,
  type FunnelDay,
  type FunnelPayload,
  type OriginSlice,
} from '@/lib/performance/types';

interface ContactRow {
  id: string;
  created_at: string;
  acquisition_source: string | null;
  acquisition_source_id: string | null;
  acquisition_campaign: string | null;
  acquisition_ad_image_url: string | null;
  contact_tags?: {
    tags?: { name?: string | null } | { name?: string | null }[] | null;
  }[];
}

interface DealRow {
  contact_id: string | null;
  stage_id: string | null;
  status: string | null;
  value: number | null;
  updated_at: string | null;
  created_at: string | null;
}

/**
 * Compare two tag names the way a human would — "Fornecedor",
 * "fornecedor" and "FORNECEDÔR" are one tag.
 *
 * `sensitivity: 'base'` folds case and accents in one step, which is
 * exactly what `dealPipelineExcludedTags()` already did to its side
 * of the comparison, and it keeps a combining-mark character range
 * out of this source file.
 */
const sameTag = (a: string, b: string) =>
  a.trim().localeCompare(b.trim(), 'pt-BR', { sensitivity: 'base' }) === 0;

/**
 * YYYY-MM-DD for an instant, in the viewer's zone.
 *
 * `en-CA` is the shortest way to an ISO-shaped date out of `Intl`, and
 * it is the zone conversion that matters: a lead that arrives at 22:00
 * in São Paulo is 01:00 UTC the next day, so slicing the stored
 * timestamp would file roughly an evening's worth of leads under
 * tomorrow and misalign the whole series against ad spend.
 */
function dayKeyIn(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone });
}

/** Every YYYY-MM-DD from `from` to `to`, so quiet days keep their slot. */
function dayRange(from: string, to: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cursor <= end && days.length < 400) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Reject a timezone the runtime doesn't know rather than throwing mid-loop. */
function safeTimeZone(value: string | null): string {
  if (!value) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value });
    return value;
  } catch {
    return 'UTC';
  }
}

/**
 * Pick the one deal that describes a contact's outcome.
 *
 * A contact can carry several cards (a card created before a tag
 * moved them, a revived lost deal). Won beats open beats lost — a
 * customer who bought is a customer regardless of what else is on
 * their record — and within a rank the furthest / freshest card wins.
 */
function bestDeal(
  deals: DealRow[],
  positionOf: (id: string | null) => number
): DealRow {
  const rank = (d: DealRow) =>
    d.status === 'won' ? 3 : d.status === 'lost' ? 1 : 2;
  return deals.reduce((best, d) => {
    const byRank = rank(d) - rank(best);
    if (byRank !== 0) return byRank > 0 ? d : best;
    const byStage = positionOf(d.stage_id) - positionOf(best.stage_id);
    if (byStage !== 0) return byStage > 0 ? d : best;
    return (d.updated_at ?? d.created_at ?? '') >
      (best.updated_at ?? best.created_at ?? '')
      ? d
      : best;
  });
}

/**
 * Where a card sits, by stage POSITION rather than stage id.
 *
 * Boards carry columns this report knows nothing about ("Aguardando
 * pagamento", "Pós-venda"). Comparing positions puts those on the
 * right side of the funnel instead of dropping them into "early",
 * which an id equality check would do.
 */
function bucketOf(
  deal: DealRow,
  stages: PipelineStageMap,
  position: number
): FunnelBucket {
  if (deal.status === 'won') return 'won';
  if (deal.status === 'lost') return 'lost';
  if (stages.disqualified && deal.stage_id === stages.disqualified.id)
    return 'disqualified';
  if (position >= stages.negotiating.position) return 'negotiating';
  if (position >= stages.qualified.position) return 'qualified';
  return 'early';
}

function applyBucket(
  counts: FunnelCounts,
  bucket: FunnelBucket,
  value: number
): void {
  counts.leads += 1;
  switch (bucket) {
    case 'none':
      counts.noDeal += 1;
      return;
    case 'early':
      counts.early += 1;
      counts.openValue += value;
      return;
    case 'qualified':
      counts.qualified += 1;
      counts.openValue += value;
      return;
    case 'negotiating':
      counts.negotiating += 1;
      counts.openValue += value;
      return;
    case 'won':
      counts.won += 1;
      counts.revenue += value;
      return;
    case 'lost':
      counts.lost += 1;
      return;
    case 'disqualified':
      counts.disqualified += 1;
      return;
  }
}

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireModule('performance');
    const params = new URL(request.url).searchParams;
    const from = params.get('from') ?? '';
    const to = params.get('to') ?? '';
    if (!ISO_DAY.test(from) || !ISO_DAY.test(to) || from > to) {
      return NextResponse.json(
        { error: 'Informe um período válido.' },
        { status: 400 }
      );
    }
    const timeZone = safeTimeZone(params.get('tz'));

    // Widen the SQL window by a day on each side and narrow it back in
    // JS with the viewer's zone. Any zone is at most 14h off UTC, so a
    // day of slack on each end is guaranteed to contain the real
    // boundary — and it keeps the filter a plain indexable comparison
    // instead of a per-row timezone conversion in Postgres.
    const days = dayRange(from, to);
    const inWindow = new Set(days);
    const lowerBound = new Date(`${from}T00:00:00.000Z`);
    lowerBound.setUTCDate(lowerBound.getUTCDate() - 1);
    const upperBound = new Date(`${to}T23:59:59.999Z`);
    upperBound.setUTCDate(upperBound.getUTCDate() + 1);

    const [account, contactsRes, pipelinesRes] = await Promise.all([
      supabase
        .from('accounts')
        .select('default_currency')
        .eq('id', accountId)
        .maybeSingle(),
      supabase
        .from('contacts')
        .select(
          'id, created_at, acquisition_source, acquisition_source_id, acquisition_campaign, acquisition_ad_image_url, contact_tags(tags(name))'
        )
        .eq('account_id', accountId)
        .gte('created_at', lowerBound.toISOString())
        .lte('created_at', upperBound.toISOString()),
      // Two plain queries instead of `pipeline_stages(pipelines!inner(...))`.
      // An embed makes PostgREST resolve the FK from its schema cache, and
      // a stale cache turns that into a hard PGRST200 — the failure mode
      // issue #294 already cost this codebase once.
      supabase.from('pipelines').select('id').eq('account_id', accountId),
    ]);

    if (contactsRes.error) throw contactsRes.error;
    if (pipelinesRes.error) throw pipelinesRes.error;

    const pipelineIds = (pipelinesRes.data ?? []).map((p) => p.id as string);
    const stagesRes = pipelineIds.length
      ? await supabase
          .from('pipeline_stages')
          .select('id, name, position, pipeline_id')
          .in('pipeline_id', pipelineIds)
          .order('position', { ascending: true })
      : null;
    if (stagesRes?.error) throw stagesRes.error;

    const contacts = (contactsRes.data ?? []) as unknown as ContactRow[];
    const allStages = (stagesRes?.data ?? []) as unknown as StageRow[];

    // Resolve the three board columns exactly the way the AI classifier
    // does: operator-pinned ids first, name matching second. Reading
    // `ai_configs` can legitimately fail for a low-privilege member —
    // that degrades to name matching, not to an error page.
    const configRes = await selectAiConfigRow(
      supabase,
      accountId,
      'deal_stage_qualified_id, deal_stage_negotiating_id, deal_stage_closed_id'
    );
    if (configRes.error) {
      console.warn(
        '[performance/funnel] ai_configs unavailable:',
        configRes.error.message
      );
    }
    const configured = {
      qualified:
        (configRes.data?.deal_stage_qualified_id as string | null) ?? null,
      negotiating:
        (configRes.data?.deal_stage_negotiating_id as string | null) ?? null,
      closed: (configRes.data?.deal_stage_closed_id as string | null) ?? null,
    };

    let stageMap: PipelineStageMap | null = mapConfiguredStages(
      configured,
      allStages
    );
    if (!stageMap) {
      for (const pipelineId of pipelineIds) {
        const slots = matchStageSlots(
          allStages.filter((s) => s.pipeline_id === pipelineId)
        );
        if (slots) {
          stageMap = { pipelineId, ...slots };
          break;
        }
      }
    }

    const stageById = new Map(allStages.map((s) => [s.id, s]));
    const positionOf = (id: string | null) =>
      id ? (stageById.get(id)?.position ?? -1) : -1;

    // Keep the leads whose day-key lands inside the window once the
    // viewer's zone is applied, and drop the ones the sales board
    // ignores by tag (suppliers, staff) so their leads don't dilute
    // every rate on the page.
    const excludedTags = dealPipelineExcludedTags();
    const isExcluded = (c: ContactRow) =>
      (c.contact_tags ?? []).some((join) => {
        const tags = Array.isArray(join.tags)
          ? join.tags
          : join.tags
            ? [join.tags]
            : [];
        return tags.some(
          (t) =>
            t?.name &&
            excludedTags.some((excluded) => sameTag(t.name as string, excluded))
        );
      });

    let excludedContacts = 0;
    const leads: { row: ContactRow; day: string }[] = [];
    for (const contact of contacts) {
      const day = dayKeyIn(contact.created_at, timeZone);
      if (!inWindow.has(day)) continue;
      if (isExcluded(contact)) {
        excludedContacts += 1;
        continue;
      }
      leads.push({ row: contact, day });
    }

    // A deal for one of these leads cannot predate the lead, so the
    // earliest lead in the window bounds the deal query too. Without
    // that bound this pulls the account's entire deal history.
    const dealsRes = leads.length
      ? await supabase
          .from('deals')
          .select('contact_id, stage_id, status, value, updated_at, created_at')
          .eq('account_id', accountId)
          .gte('created_at', lowerBound.toISOString())
      : null;
    if (dealsRes?.error) throw dealsRes.error;

    const dealsByContact = new Map<string, DealRow[]>();
    for (const deal of (dealsRes?.data ?? []) as unknown as DealRow[]) {
      if (!deal.contact_id) continue;
      const list = dealsByContact.get(deal.contact_id);
      if (list) list.push(deal);
      else dealsByContact.set(deal.contact_id, [deal]);
    }

    const ads = new Map<string, AdFunnel>();
    const daily = new Map<string, FunnelDay>(
      days.map((day) => [day, { day, ...emptyCounts() }])
    );
    const origins = new Map<string, number>();
    const organic = emptyCounts();
    const totals = emptyCounts();

    for (const { row, day } of leads) {
      const cards = dealsByContact.get(row.id) ?? [];
      let bucket: FunnelBucket = 'none';
      let value = 0;
      if (cards.length && stageMap) {
        const deal = bestDeal(cards, positionOf);
        bucket = bucketOf(deal, stageMap, positionOf(deal.stage_id));
        value = Number(deal.value ?? 0);
      } else if (cards.length) {
        // A board this report can't read still has cards on it. Counting
        // them as "no deal" would be a lie; `early` says "worked, stage
        // unknown" and keeps them out of every funnel rate.
        bucket = 'early';
        value = Number(bestDeal(cards, positionOf).value ?? 0);
      }

      applyBucket(totals, bucket, value);
      const dayRow = daily.get(day);
      if (dayRow) applyBucket(dayRow, bucket, value);

      const origin =
        row.acquisition_source ??
        (row.acquisition_source_id ? 'Meta Ads' : 'Não informado');
      origins.set(origin, (origins.get(origin) ?? 0) + 1);

      const adId = row.acquisition_source_id?.trim();
      if (!adId) {
        applyBucket(organic, bucket, value);
        continue;
      }
      let ad = ads.get(adId);
      if (!ad) {
        ad = {
          adId,
          headline: row.acquisition_campaign?.trim() || null,
          imageUrl: row.acquisition_ad_image_url ?? null,
          ...emptyCounts(),
        };
        ads.set(adId, ad);
      }
      ad.headline ??= row.acquisition_campaign?.trim() || null;
      ad.imageUrl ??= row.acquisition_ad_image_url ?? null;
      applyBucket(ad, bucket, value);
    }

    const payload: FunnelPayload = {
      currency: 'BRL',
      stageNames: stageMap
        ? {
            qualified:
              stageById.get(stageMap.qualified.id)?.name ?? 'Qualificado',
            negotiating:
              stageById.get(stageMap.negotiating.id)?.name ?? 'Negociação',
            closed: stageById.get(stageMap.closed.id)?.name ?? 'Finalizado',
            disqualified: stageMap.disqualified
              ? (stageById.get(stageMap.disqualified.id)?.name ?? null)
              : null,
          }
        : null,
      ads: [...ads.values()].sort((a, b) => b.leads - a.leads),
      organic,
      totals,
      daily: days.map((day) => daily.get(day) as FunnelDay),
      origins: [...origins.entries()]
        .map(([name, leads]): OriginSlice => ({ name, leads }))
        .sort((a, b) => b.leads - a.leads),
      excludedContacts,
    };

    return NextResponse.json(payload);
  } catch (err) {
    console.error('[performance/funnel]', err);
    return toErrorResponse(err);
  }
}
