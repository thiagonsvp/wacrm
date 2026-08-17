'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CalendarDays, Eye, MousePointerClick, RefreshCw, Wallet } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'

type Row = Record<string, unknown>
type CRMLead = { created_at: string; acquisition_source: string | null; acquisition_campaign: string | null; acquisition_ad_text: string | null; acquisition_ad_image_url: string | null }
type Aggregate = { name: string; spend: number; impressions: number; clicks: number; conversions: number; leads: number; reach: number; ctr: number; cpc: number; cpm: number; image?: string }
const n = (v: unknown) => Number(v || 0)
const text = (v: unknown) => String(v || '-').trim()
const money = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
const integer = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })

function responseRows(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[]
  if (!value || typeof value !== 'object') return []
  const object = value as Record<string, unknown>
  for (const key of ['data', 'rows', 'results', 'result', 'records']) {
    const found = responseRows(object[key])
    if (found.length) return found
  }
  return []
}

function aggregate(rows: Row[], key: string): Aggregate[] {
  const map = new Map<string, Aggregate>()
  for (const row of rows) {
    const name = text(row[key])
    const current = map.get(name) || { name, spend: 0, impressions: 0, clicks: 0, conversions: 0, leads: 0, reach: 0, ctr: 0, cpc: 0, cpm: 0, image: text(row.image_url) !== '-' ? text(row.image_url) : undefined }
    current.spend += n(row.spend); current.impressions += n(row.impressions); current.clicks += n(row.clicks); current.conversions += n(row.conversions || row.purchases || row.leads); current.reach += n(row.reach)
    current.ctr = current.impressions ? current.clicks / current.impressions * 100 : 0; current.cpc = current.clicks ? current.spend / current.clicks : 0; current.cpm = current.impressions ? current.spend / current.impressions * 1000 : 0
    map.set(name, current)
  }
  return [...map.values()].sort((a, b) => b.spend - a.spend)
}

export default function PerformancePage() {
  const today = new Date(); const prior = new Date(today); prior.setDate(today.getDate() - 29)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const [source, setSource] = useState('meta'); const [from, setFrom] = useState(iso(prior)); const [to, setTo] = useState(iso(today)); const [rows, setRows] = useState<Row[]>([]); const [leads, setLeads] = useState<CRMLead[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState('')
  const load = useCallback(async () => { setLoading(true); setError(''); try { const db = createClient(); const end = new Date(`${to}T23:59:59.999`).toISOString(); const ads = await fetch(`/api/windsor/performance?source=${source}&from=${from}&to=${to}`, { cache: 'no-store' }); const d = await ads.json(); if (!ads.ok) throw new Error(d.error || 'Não foi possível carregar os dados do Windsor.ai.'); setRows(Array.isArray(d) ? d : d.data || d.rows || []); const crm = await db.from('contacts').select('created_at, acquisition_source, acquisition_campaign, acquisition_ad_text, acquisition_ad_image_url').gte('created_at', `${from}T00:00:00.000Z`).lte('created_at', end); if (crm.error) { console.warn('[performance] CRM leads unavailable:', crm.error.message); setLeads([]) } else { setLeads((crm.data || []) as CRMLead[]) } } catch (e) { setRows([]); setLeads([]); setError(e instanceof Error ? e.message : 'Não foi possível carregar os dados.') } finally { setLoading(false) } }, [source, from, to])
  useEffect(() => { void load() }, [load])
  const visibleRows = useMemo(() => { const dated = rows.filter(r => { const value = text(r.date); const match = value.match(/\d{4}-\d{2}-\d{2}/); return !match || (match[0] >= from && match[0] <= to) }); return dated.length ? dated : rows }, [rows, from, to])
  const totals = useMemo(() => visibleRows.reduce<{ spend: number; impressions: number; reach: number; clicks: number; conversions: number }>((a, r) => ({ spend: a.spend + n(r.spend), impressions: a.impressions + n(r.impressions), reach: a.reach + n(r.reach), clicks: a.clicks + n(r.clicks), conversions: a.conversions + n(r.conversions || r.purchases || r.leads) }), { spend: 0, impressions: 0, reach: 0, clicks: 0, conversions: 0 }), [visibleRows])
  const ctr = totals.impressions ? totals.clicks / totals.impressions * 100 : 0; const cpc = totals.clicks ? totals.spend / totals.clicks : 0; const cpm = totals.impressions ? totals.spend / totals.impressions * 1000 : 0
  const campaigns = useMemo(() => { const result = aggregate(visibleRows, 'campaign'); for (const lead of leads) { const match = result.find(c => c.name.toLowerCase() === text(lead.acquisition_campaign).toLowerCase()); if (match) match.leads += 1 }; return result }, [visibleRows, leads]); const creatives = useMemo(() => aggregate(visibleRows, 'ad_name'), [visibleRows]); const daily = useMemo(() => { const map = new Map<string, { name: string; spend: number; clicks: number; impressions: number; leads: number }>(); for (const row of visibleRows) { const key = text(row.date); const item = map.get(key) || { name: key, spend: 0, clicks: 0, impressions: 0, leads: 0 }; item.spend += n(row.spend); item.clicks += n(row.clicks); item.impressions += n(row.impressions); map.set(key, item) }; for (const lead of leads) { const key = lead.created_at.slice(0, 10); const item = map.get(key) || { name: key, spend: 0, clicks: 0, impressions: 0, leads: 0 }; item.leads += 1; map.set(key, item) }; return [...map.values()].sort((a, b) => a.name.localeCompare(b.name)) }, [visibleRows, leads])
  const attributedLeads = leads.filter(l => l.acquisition_source || l.acquisition_campaign).length
  return <div className="space-y-5"><header className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-bold">Performance de anúncios</h1><p className="mt-1 text-sm text-muted-foreground">Visão consolidada de mídia e leads captados no CRM</p></div><div className="flex flex-wrap items-center gap-2"><Button variant={source === 'meta' ? 'default' : 'outline'} onClick={() => setSource('meta')}>Meta Ads</Button><Button variant={source === 'google' ? 'default' : 'outline'} onClick={() => setSource('google')}>Google Ads</Button><Button variant="outline" onClick={() => void load}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button></div></header><Card className="flex flex-wrap items-center gap-3 p-3"><CalendarDays className="h-4 w-4 text-muted-foreground" /><span className="text-xs font-medium text-muted-foreground">Período</span><Input aria-label="Data inicial" type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 w-40" /><span className="text-xs text-muted-foreground">até</span><Input aria-label="Data final" type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 w-40" /><Button size="sm" onClick={() => void load}>Aplicar</Button></Card>{error && <Card className="p-4 text-sm text-amber-500">{error}</Card>}<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Investimento" value={money(totals.spend)} icon={Wallet} /><Metric label="Impressões" value={integer(totals.impressions)} icon={Eye} /><Metric label="Cliques" value={integer(totals.clicks)} icon={MousePointerClick} /><Metric label="CTR" value={`${ctr.toFixed(2)}%`} icon={MousePointerClick} /><Metric label="Leads no CRM" value={integer(leads.length)} icon={MousePointerClick} /></div><div className="grid gap-4 sm:grid-cols-4"><Metric label="Leads atribuídos" value={integer(attributedLeads)} /><Metric label="CPC médio" value={money(cpc)} /><Metric label="CPM médio" value={money(cpm)} /><Metric label="Custo por lead" value={money(attributedLeads ? totals.spend / attributedLeads : 0)} /></div><Card className="p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Investimento e leads por dia</h2><p className="text-xs text-muted-foreground">Leads criados no CRM no período selecionado</p></div></div>{loading ? <div className="h-64 animate-pulse rounded bg-muted" /> : <ResponsiveContainer width="100%" height={280}><AreaChart data={daily}><defs><linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} /><stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" opacity={0.15} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis yAxisId="left" tick={{ fontSize: 11 }} /><YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} /><Tooltip /><Area yAxisId="left" type="monotone" dataKey="spend" name="Investimento" stroke="hsl(var(--primary))" fill="url(#spendFill)" /><Area yAxisId="right" type="monotone" dataKey="leads" name="Leads CRM" stroke="#22c55e" fill="none" /></AreaChart></ResponsiveContainer>}</Card><div className="grid gap-4 lg:grid-cols-2"><Ranking title="Principais campanhas" rows={campaigns} /><Ranking title="Principais criativos" rows={creatives} showImage /></div></div>
}
function Metric({ label, value, icon: Icon }: { label: string; value: string; icon?: typeof Wallet }) { return <Card className="p-4"><div className="flex items-center gap-2 text-sm text-muted-foreground">{Icon && <Icon className="h-4 w-4" />}{label}</div><p className="mt-2 text-2xl font-semibold">{value}</p></Card> }
function Ranking({ title, rows, showImage }: { title: string; rows: Aggregate[]; showImage?: boolean }) { return <Card className="overflow-hidden"><div className="border-b p-5"><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">Ordenados por investimento</p></div><div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="p-3">{showImage ? 'Criativo' : 'Campanha'}</th><th className="p-3 text-right">Investimento</th><th className="p-3 text-right">Leads CRM</th><th className="p-3 text-right">Cliques</th><th className="p-3 text-right">CTR</th><th className="p-3 text-right">CPC</th></tr></thead><tbody>{rows.slice(0, 10).map(r => <tr key={r.name} className="border-b last:border-0"><td className="max-w-56 p-3"><div className="flex items-center gap-2">{showImage && r.image && <img src={r.image} alt="" className="h-8 w-8 rounded object-cover" />}{r.name}</div></td><td className="p-3 text-right">{money(r.spend)}</td><td className="p-3 text-right">{integer(r.leads)}</td><td className="p-3 text-right">{integer(r.clicks)}</td><td className="p-3 text-right">{r.ctr.toFixed(2)}%</td><td className="p-3 text-right">{money(r.cpc)}</td></tr>)}</tbody></table>{rows.length === 0 && <p className="p-5 text-sm text-muted-foreground">Nenhum dado no período selecionado.</p>}</div></Card>}

