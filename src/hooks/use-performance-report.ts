'use client'

import { useEffect, useMemo, useState } from 'react'
import { buildTrend } from '@/components/performance/trend-charts'
import {
  groupByCampaign,
  groupByCreative,
  indexByAd,
  indexIdentity,
  mediaTotals,
  spendByDay,
  toAdIdentity,
  toAdMedia,
} from '@/lib/performance/merge'
import {
  emptyCounts,
  type AdIdentity,
  type AdMedia,
  type FunnelPayload,
} from '@/lib/performance/types'

export type AdSource = 'meta' | 'google'

export const emptyFunnel = (): FunnelPayload => ({
  currency: 'BRL',
  stageNames: null,
  ads: [],
  organic: emptyCounts(),
  totals: emptyCounts(),
  daily: [],
  origins: [],
  excludedContacts: 0,
})

/**
 * Everything the ads report shows, loaded once and shared by the
 * Performance page and its export view so the two can never disagree.
 *
 * The CRM funnel and the Windsor media are fetched and settled
 * INDEPENDENTLY: the funnel answers in about a second while Windsor can
 * take 20s+, and making everything wait for the slower one left the page
 * on skeletons. Loading flags are derived ("what we asked for" vs "what
 * came back"), so none can get stuck on.
 */
export function usePerformanceReport({
  source,
  from,
  to,
  nonce = 0,
  fresh = false,
  onSources,
}: {
  source: AdSource
  from: string
  to: string
  /** Bump to re-run the same query. */
  nonce?: number
  /** Bypass the server's Windsor cache for this request. */
  fresh?: boolean
  /** Called once with the sources configured for this company. */
  onSources?: (sources: AdSource[]) => void
}) {
  const [availableSources, setAvailableSources] = useState<AdSource[] | null>(null)
  const [media, setMedia] = useState<AdMedia[]>([])
  const [funnel, setFunnel] = useState<FunnelPayload>(emptyFunnel)
  const [identity, setIdentity] = useState<AdIdentity[]>([])
  const [mediaError, setMediaError] = useState('')
  const [crmError, setCrmError] = useState('')

  useEffect(() => {
    let current = true
    void fetch('/api/windsor/config', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (!current) return
        const sources = (Array.isArray(data.configured_sources)
          ? data.configured_sources
          : []) as AdSource[]
        setAvailableSources(sources)
        onSources?.(sources)
      })
      .catch(() => {
        if (current) setAvailableSources([])
      })
    return () => {
      current = false
    }
    // onSources is a one-shot notification; re-running on a new closure
    // would refetch the config for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const crmKey = `${from}|${to}|${nonce}`
  const mediaKey = `${availableSources?.join(',') ?? 'loading'}|${source}|${from}|${to}|${nonce}`
  const [crmSettled, setCrmSettled] = useState<string | null>(null)
  const [mediaSettled, setMediaSettled] = useState<string | null>(null)
  const crmLoading = crmSettled !== crmKey
  const mediaLoading = availableSources === null || mediaSettled !== mediaKey

  useEffect(() => {
    let current = true
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    void (async () => {
      let payload: unknown = null
      let ok = false
      try {
        const res = await fetch(
          `/api/performance/funnel?from=${from}&to=${to}&tz=${encodeURIComponent(tz)}`,
          { cache: 'no-store' },
        )
        ok = res.ok
        payload = await res.json().catch(() => null)
      } catch {
        ok = false
      }
      if (!current) return
      if (ok) {
        setFunnel(payload as FunnelPayload)
        setCrmError('')
      } else {
        setFunnel(emptyFunnel())
        setCrmError(
          (payload as { error?: string } | null)?.error ||
            'Não foi possível carregar os leads do CRM.',
        )
      }
      setCrmSettled(crmKey)
    })()
    return () => {
      current = false
    }
  }, [from, to, crmKey])

  useEffect(() => {
    if (availableSources === null) return
    let current = true
    void (async () => {
      let rows: AdMedia[] = []
      let error = ''
      if (!availableSources.includes(source)) {
        error = 'Nenhuma conta de anúncios foi selecionada para esta empresa.'
      } else {
        try {
          const res = await fetch(
            `/api/windsor/performance?source=${source}&from=${from}&to=${to}${fresh ? '&fresh=1' : ''}`,
            { cache: 'no-store' },
          )
          const payload = await res.json().catch(() => null)
          if (res.ok && Array.isArray(payload)) rows = payload.map(toAdMedia)
          else error = payload?.error || 'Não foi possível consultar o Windsor.ai.'
        } catch {
          error = 'Não foi possível consultar o Windsor.ai.'
        }
      }
      if (!current) return
      setMedia(rows)
      setMediaError(error)
      setMediaSettled(mediaKey)
    })()
    return () => {
      current = false
    }
    // `fresh` only matters for the request it was set for; it is read,
    // not a reason to re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, from, to, mediaKey, availableSources])

  // Second pass, once both halves are in: leads whose ad id got no media
  // row in the window. A wide, id-filtered Windsor lookup recovers those
  // ads' campaign and creative names (paused ads, ads in a sibling ad
  // account), so they group under their real campaign instead of a "no
  // match" bucket. Identity only — its spend never enters the totals.
  const orphanIds = useMemo(() => {
    if (crmLoading || mediaLoading || mediaError) return ''
    const known = indexByAd(media)
    return [...new Set(funnel.ads.map((ad) => ad.adId).filter((id) => !known.has(id)))]
      .sort()
      .join(',')
  }, [crmLoading, mediaLoading, mediaError, media, funnel.ads])

  useEffect(() => {
    let current = true
    void (async () => {
      let rows: AdIdentity[] = []
      if (orphanIds) {
        try {
          const res = await fetch(`/api/windsor/ad-identity?source=${source}&ids=${orphanIds}`, {
            cache: 'no-store',
          })
          const payload = await res.json().catch(() => null)
          if (res.ok && Array.isArray(payload)) rows = payload.map(toAdIdentity)
        } catch {
          // Best effort: leads keep their WhatsApp-headline names.
        }
      }
      if (current) setIdentity(rows)
    })()
    return () => {
      current = false
    }
  }, [orphanIds, source])

  const totals = useMemo(() => mediaTotals(media), [media])
  const identityByAd = useMemo(() => indexIdentity(identity), [identity])
  const campaigns = useMemo(
    () => groupByCampaign(media, funnel.ads, identityByAd),
    [media, funnel.ads, identityByAd],
  )
  const creatives = useMemo(
    () => groupByCreative(media, funnel.ads, identityByAd),
    [media, funnel.ads, identityByAd],
  )
  const dailySpend = useMemo(() => spendByDay(media), [media])
  const trend = useMemo(() => buildTrend(funnel.daily, dailySpend), [funnel.daily, dailySpend])

  return {
    availableSources,
    funnel,
    mediaError,
    crmError,
    crmLoading,
    mediaLoading,
    loading: crmLoading || mediaLoading,
    totals,
    counts: funnel.totals,
    currency: funnel.currency,
    stageNames: funnel.stageNames,
    campaigns,
    creatives,
    trend,
  }
}
