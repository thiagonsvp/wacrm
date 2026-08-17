'use client'

import { useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SettingsPanelHead } from './settings-panel-head'
import { useAuth } from '@/hooks/use-auth'

type AdAccount = { id: string; name?: string | null }
type Source = 'meta' | 'google'

export function WindsorConfig() {
  const { canManageMembers } = useAuth()
  const [metaUrl, setMetaUrl] = useState(''); const [googleUrl, setGoogleUrl] = useState('')
  const [metaAccount, setMetaAccount] = useState(''); const [googleAccount, setGoogleAccount] = useState('')
  const [metaAccounts, setMetaAccounts] = useState<AdAccount[]>([]); const [googleAccounts, setGoogleAccounts] = useState<AdAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState<Source | null>(null); const [saving, setSaving] = useState(false)

  useEffect(() => { void fetch('/api/windsor/config').then(r => r.json()).then(d => { setMetaUrl(d.meta_ads_url || ''); setGoogleUrl(d.google_ads_url || ''); setMetaAccount(d.meta_ads_account_id || ''); setGoogleAccount(d.google_ads_account_id || '') }) }, [])
  async function loadAccounts(source: Source) {
    setLoadingAccounts(source)
    try { const r = await fetch(`/api/windsor/accounts?source=${source}`); const d = await r.json(); if (!r.ok) throw new Error(d.error); if (source === 'meta') setMetaAccounts(d.accounts || []); else setGoogleAccounts(d.accounts || []) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível buscar as contas.') }
    finally { setLoadingAccounts(null) }
  }
  async function save() {
    setSaving(true)
    const meta = metaAccounts.find(a => a.id === metaAccount); const google = googleAccounts.find(a => a.id === googleAccount)
    try { const r = await fetch('/api/windsor/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meta_ads_url: metaUrl, google_ads_url: googleUrl, meta_ads_account_id: metaAccount, meta_ads_account_name: meta?.name || '', google_ads_account_id: googleAccount, google_ads_account_name: google?.name || '' }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); toast.success('Configuração Windsor salva para esta empresa.') }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.') }
    finally { setSaving(false) }
  }
  const disabled = !canManageMembers
  return <div><SettingsPanelHead title="Windsor.ai" description="Defina, para esta empresa do CRM, qual conta de anúncios será usada nos relatórios." />
    <Card className="space-y-5 p-5"><SourceConfig title="Meta Ads" url={metaUrl} onUrl={setMetaUrl} accounts={metaAccounts} selected={metaAccount} onSelect={setMetaAccount} onLoad={() => void loadAccounts('meta')} loading={loadingAccounts === 'meta'} disabled={disabled} placeholder="https://connectors.windsor.ai/facebook?..." />
      <SourceConfig title="Google Ads" url={googleUrl} onUrl={setGoogleUrl} accounts={googleAccounts} selected={googleAccount} onSelect={setGoogleAccount} onLoad={() => void loadAccounts('google')} loading={loadingAccounts === 'google'} disabled={disabled} placeholder="https://connectors.windsor.ai/google_ads?..." />
      <p className="text-xs text-muted-foreground">Após informar o link, salve e use “Buscar contas” para escolher a conta da empresa. Cada empresa do CRM mantém sua própria seleção.</p>
      {canManageMembers && <Button onClick={() => void save()} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{saving ? 'Salvando...' : 'Salvar configuração'}</Button>}</Card>
  </div>
}

function SourceConfig({ title, url, onUrl, accounts, selected, onSelect, onLoad, loading, disabled, placeholder }: { title: string; url: string; onUrl: (v: string) => void; accounts: AdAccount[]; selected: string; onSelect: (v: string) => void; onLoad: () => void; loading: boolean; disabled: boolean; placeholder: string }) {
  return <section className="space-y-3 rounded-lg border p-4"><h3 className="font-medium">{title}</h3><div><Label>{`Link ${title}`}</Label><Input className="mt-1" value={url} onChange={e => onUrl(e.target.value)} placeholder={placeholder} disabled={disabled} /></div><div className="flex flex-wrap items-end gap-2"><div className="min-w-64 flex-1"><Label>Conta desta empresa</Label><select value={selected} onChange={e => onSelect(e.target.value)} disabled={disabled || !accounts.length} className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"><option value="">Selecione uma conta</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name || account.id} ({account.id})</option>)}</select></div><Button type="button" variant="outline" onClick={onLoad} disabled={disabled || loading || !url}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Buscar contas</Button></div></section>
}
