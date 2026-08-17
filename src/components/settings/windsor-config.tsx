'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { SettingsPanelHead } from './settings-panel-head'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/use-auth'

export function WindsorConfig() {
  const { canManageMembers } = useAuth(); const [meta, setMeta] = useState(''); const [google, setGoogle] = useState(''); const [saving, setSaving] = useState(false)
  useEffect(() => { fetch('/api/windsor/config').then(r => r.json()).then(d => { setMeta(d.meta_ads_url || ''); setGoogle(d.google_ads_url || '') }) }, [])
  async function save() { setSaving(true); const r = await fetch('/api/windsor/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meta_ads_url: meta, google_ads_url: google }) }); const d = await r.json(); setSaving(false); r.ok ? toast.success('Links salvos') : toast.error(d.error || 'Não foi possível salvar') }
  return <div><SettingsPanelHead title="Relatórios de performance" description="Cadastre os links JSON do Windsor.ai para consultar Meta Ads e Google Ads." /><Card className="space-y-5 p-5"><div><Label htmlFor="windsor-meta">Link Meta Ads</Label><Input id="windsor-meta" className="mt-1" value={meta} onChange={e => setMeta(e.target.value)} placeholder="https://connectors.windsor.ai/facebook?..." disabled={!canManageMembers} /></div><div><Label htmlFor="windsor-google">Link Google Ads</Label><Input id="windsor-google" className="mt-1" value={google} onChange={e => setGoogle(e.target.value)} placeholder="https://connectors.windsor.ai/google_ads?..." disabled={!canManageMembers} /></div><p className="text-xs text-muted-foreground">Use links com os campos date, campaign, spend, impressions, clicks, ctr, cpc e cpm. A chave fica protegida no banco.</p>{canManageMembers && <Button onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar links'}</Button>}</Card></div>
}
