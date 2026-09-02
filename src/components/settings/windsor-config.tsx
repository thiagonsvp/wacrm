'use client'

import { useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { SettingsPanelHead } from './settings-panel-head'
import { useAuth } from '@/hooks/use-auth'

type AdAccount = { id: string; name?: string | null }
type Source = 'meta' | 'google'

export function WindsorConfig() {
  const { canManageMembers } = useAuth()
  const [metaAccount, setMetaAccount] = useState('')
  const [googleAccount, setGoogleAccount] = useState('')
  const [metaAccounts, setMetaAccounts] = useState<AdAccount[]>([])
  const [googleAccounts, setGoogleAccounts] = useState<AdAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState<Source | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void fetch('/api/windsor/config', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        const metaId = data.meta_ads_account_id || ''
        const googleId = data.google_ads_account_id || ''
        setMetaAccount(metaId)
        setGoogleAccount(googleId)
        if (metaId) setMetaAccounts([{ id: metaId, name: data.meta_ads_account_name }])
        if (googleId) setGoogleAccounts([{ id: googleId, name: data.google_ads_account_name }])
      })
      .finally(() => setLoading(false))
  }, [])

  async function loadAccounts(source: Source) {
    setLoadingAccounts(source)
    try {
      const response = await fetch(`/api/windsor/accounts?source=${source}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      if (source === 'meta') setMetaAccounts(data.accounts || [])
      else setGoogleAccounts(data.accounts || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível buscar as contas.')
    } finally {
      setLoadingAccounts(null)
    }
  }

  async function save() {
    setSaving(true)
    const meta = metaAccounts.find((account) => account.id === metaAccount)
    const google = googleAccounts.find((account) => account.id === googleAccount)
    try {
      const response = await fetch('/api/windsor/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meta_ads_account_id: metaAccount,
          meta_ads_account_name: meta?.name || '',
          google_ads_account_id: googleAccount,
          google_ads_account_name: google?.name || '',
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      toast.success('Contas do dashboard salvas para esta empresa.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  const disabled = !canManageMembers || loading
  return (
    <div>
      <SettingsPanelHead
        title="Contas do dashboard"
        description="Selecione quais contas de anúncios pertencem a esta empresa. A chave e a URL são administradas uma única vez na configuração global."
      />
      <Card className="space-y-5 p-5">
        <SourceAccount
          title="Meta Ads"
          accounts={metaAccounts}
          selected={metaAccount}
          onSelect={setMetaAccount}
          onLoad={() => void loadAccounts('meta')}
          loading={loadingAccounts === 'meta'}
          disabled={disabled}
        />
        <SourceAccount
          title="Google Ads"
          accounts={googleAccounts}
          selected={googleAccount}
          onSelect={setGoogleAccount}
          onLoad={() => void loadAccounts('google')}
          loading={loadingAccounts === 'google'}
          disabled={disabled}
        />
        <p className="text-muted-foreground text-xs">
          Deixe uma fonte sem conta selecionada para ocultá-la em Performance de anúncios.
        </p>
        {canManageMembers ? (
          <Button onClick={() => void save()} disabled={saving || loading}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {saving ? 'Salvando...' : 'Salvar contas'}
          </Button>
        ) : null}
      </Card>
    </div>
  )
}

function SourceAccount({
  title,
  accounts,
  selected,
  onSelect,
  onLoad,
  loading,
  disabled,
}: {
  title: string
  accounts: AdAccount[]
  selected: string
  onSelect: (value: string) => void
  onLoad: () => void
  loading: boolean
  disabled: boolean
}) {
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">{title}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1">
          <Label>Conta desta empresa</Label>
          <select
            value={selected}
            onChange={(event) => onSelect(event.target.value)}
            disabled={disabled || !accounts.length}
            className="border-input mt-1 h-9 w-full rounded-md border bg-transparent px-3 text-sm"
          >
            <option value="" className="bg-white text-slate-950">
              Não exibir esta fonte
            </option>
            {accounts.map((account) => (
              <option
                key={account.id}
                value={account.id}
                className="bg-white text-slate-950"
              >
                {account.name || account.id} ({account.id})
              </option>
            ))}
          </select>
        </div>
        <Button type="button" variant="outline" onClick={onLoad} disabled={disabled || loading}>
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Buscar contas
        </Button>
      </div>
    </section>
  )
}
