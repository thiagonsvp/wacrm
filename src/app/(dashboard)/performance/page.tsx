'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CalendarDays, Eye, MousePointerClick, RefreshCw, Users, Wallet } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'

type Row = Record<string, unknown>
type Lead = { created_at: string; acquisition_source: string | null; acquisition_campaign: string | null }
type Summary = { name: string; spend: number; impressions: number; clicks: number; leads: number }
const number = (v: unknown) => Number(v || 0)
const label = (v: unknown) => String(v || '-').trim()
const money = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const quantity = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
const dateKey = (v: unknown) => label(v).match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ''

function byName(rows: Row[], field: string, leads: Lead[] = []): Summary[] {
  const data = new Map<string, Summary>()
  for (const row of rows) {
    const name = label(row[field]); const item = data.get(name) ?? { name, spend: 0, impressions: 0, clicks: 0, leads: 0 }
    item.spend += number(row.spend); item.impressions += number(row.impressions); item.clicks += number(row.clicks); data.set(name, item)
  }
  for (const lead of leads) {
    const item = data.get(label(lead.acquisition_campaign))
    if (item) item.leads += 1
  }
  return [...data.values()].sort((a, b) => b.spend - a.spend)
}

export default function PerformancePage() {
  const now = new Date(); const start = new Date(now); start.setDate(now.getDate() - 29)
  const iso = (date: Date) => date.toISOString().slice(0, 10)
  const [source, setSource] = useState<'meta' | 'google'>('meta')
  const [from, setFrom] = useState(iso(start)); const [to, setTo] = useState(iso(now))
  const [rows, setRows] = useState<Row[]>([]); const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(false); const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const db = createClient()
      const [ads, crm] = await Promise.all([
        fetch(`/api/windsor/performance?source=${source}&from=${from}&to=${to}`, { cache: 'no-store' }),
        db.from('contacts').select('created_at, acquisition_source, acquisition_campaign').gte('created_at', `${from}T00:00:00.000Z`).lte('created_at', `${to}T23:59:59.999Z`),
      ])
      const payload = await ads.json()
      if (!ads.ok) throw new Error(payload.error || 'Não foi possível consultar o Windsor.ai.')
      setRows(Array.isArray(payload) ? payload : [])
      if (crm.error) console.warn('[performance] CRM leads unavailable', crm.error.message)
      setLeads((crm.data ?? []) as Lead[])
    } catch (err) { setRows([]); setLeads([]); setError(err instanceof Error ? err.message : 'Não foi possível carregar os dados.') }
    finally { setLoading(false) }
  }, [source, from, to])

  useEffect(() => { void load() }, [load])
  const totals = useMemo(() => rows.reduce<{ spend: number; impressions: number; clicks: number; reach: number }>((a, r) => ({ spend: a.spend + number(r.spend), impressions: a.impressions + number(r.impressions), clicks: a.clicks + number(r.clicks), reach: a.reach + number(r.reach) }), { spend: 0, impressions: 0, clicks: 0, reach: 0 }), [rows])
  const ctr = totals.impressions ? totals.clicks / totals.impressions * 100 : 0
  const cpc = totals.clicks ? totals.spend / totals.clicks : 0
  const cpl = leads.length ? totals.spend / leads.length : 0
  const campaigns = useMemo(() => byName(rows, 'campaign', leads), [rows, leads])
  const creatives = useMemo(() => byName(rows, 'ad_name'), [rows])
  const daily = useMemo(() => {
    const map = new Map<string, Summary>()
    for (const row of rows) { const name = dateKey(row.date); if (!name) continue; const item = map.get(name) ?? { name, spend: 0, impressions: 0, clicks: 0, leads: 0 }; item.spend += number(row.spend); item.impressions += number(row.impressions); item.clicks += number(row.clicks); map.set(name, item) }
    for (const lead of leads) { const name = lead.created_at.slice(0, 10); const item = map.get(name) ?? { name, spend: 0, impressions: 0, clicks: 0, leads: 0 }; item.leads += 1; map.set(name, item) }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [rows, leads])

  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="text-2xl font-bold">Performance de anúncios</h1><p className="mt-1 text-sm text-muted-foreground">Mídia do Windsor.ai e leads captados no CRM</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={source === 'meta' ? 'default' : 'outline'} onClick={() => setSource('meta')}>Meta Ads</Button>
        <Button size="sm" variant={source === 'google' ? 'default' : 'outline'} onClick={() => setSource('google')}>Google Ads</Button>
        <span className="ml-1 flex items-center gap-1 text-muted-foreground"><CalendarDays className="h-4 w-4" /><Input aria-label="Data inicial" type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-8 w-36" /><span className="text-xs">até</span><Input aria-label="Data final" type="date" value={to} onChange={e => setTo(e.target.value)} className="h-8 w-36" /></span>
        <Button size="sm" onClick={() => void load}>Aplicar</Button><Button size="sm" variant="outline" onClick={() => void load}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Atualizar</Button>
      </div>
    </header>
    {error && <Card className="p-4 text-sm text-amber-500">{error}</Card>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Metric icon={Wallet} label="Investimento" value={money(totals.spend)} /><Metric icon={Eye} label="Impressões" value={quantity(totals.impressions)} /><Metric icon={MousePointerClick} label="Cliques" value={quantity(totals.clicks)} /><Metric icon={MousePointerClick} label="CTR" value={`${ctr.toFixed(2)}%`} /><Metric icon={Users} label="Leads no CRM" value={quantity(leads.length)} /></div>
    <div className="grid gap-4 sm:grid-cols-3"><Metric label="Alcance" value={quantity(totals.reach)} /><Metric label="CPC médio" value={money(cpc)} /><Metric label="Custo por lead" value={money(cpl)} /></div>
    <Card className="p-5"><div><h2 className="font-semibold">Investimento e leads por dia</h2><p className="text-xs text-muted-foreground">Período selecionado</p></div>{loading ? <div className="mt-4 h-72 animate-pulse rounded bg-muted" /> : <ResponsiveContainer width="100%" height={280}><AreaChart data={daily}><CartesianGrid strokeDasharray="3 3" opacity={0.15} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis yAxisId="spend" tick={{ fontSize: 11 }} /><YAxis yAxisId="leads" orientation="right" tick={{ fontSize: 11 }} /><Tooltip formatter={(value, name) => name === 'Investimento' ? money(Number(value)) : value} /><Area yAxisId="spend" type="monotone" dataKey="spend" name="Investimento" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / .2)" /><Area yAxisId="leads" type="monotone" dataKey="leads" name="Leads CRM" stroke="#22c55e" fill="none" /></AreaChart></ResponsiveContainer>}</Card>
    <div className="grid gap-4 xl:grid-cols-2"><Rank title="Principais campanhas" rows={campaigns} leads /><Rank title="Principais criativos" rows={creatives} /></div>
  </div>
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon?: typeof Wallet }) { return <Card className="p-4"><div className="flex items-center gap-2 text-sm text-muted-foreground">{Icon && <Icon className="h-4 w-4" />}{label}</div><p className="mt-2 text-2xl font-semibold">{value}</p></Card> }
function Rank({ title, rows, leads = false }: { title: string; rows: Summary[]; leads?: boolean }) { return <Card className="overflow-hidden"><div className="border-b px-5 py-4"><h2 className="font-semibold">{title}</h2><p className="text-xs text-muted-foreground">Ordenados por investimento</p></div><div className="overflow-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="p-3">Nome</th><th className="p-3 text-right">Investimento</th>{leads && <th className="p-3 text-right">Leads</th>}<th className="p-3 text-right">Cliques</th><th className="p-3 text-right">CTR</th></tr></thead><tbody>{rows.slice(0, 10).map(row => <tr key={row.name} className="border-t"><td className="max-w-64 truncate p-3">{row.name}</td><td className="p-3 text-right">{money(row.spend)}</td>{leads && <td className="p-3 text-right">{quantity(row.leads)}</td>}<td className="p-3 text-right">{quantity(row.clicks)}</td><td className="p-3 text-right">{row.impressions ? `${(row.clicks / row.impressions * 100).toFixed(2)}%` : '—'}</td></tr>)}</tbody></table>{!rows.length && <p className="p-5 text-sm text-muted-foreground">Nenhum dado retornado pelo Windsor.ai neste período.</p>}</div></Card>}
