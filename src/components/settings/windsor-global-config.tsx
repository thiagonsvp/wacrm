'use client'

import { useEffect, useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SettingsPanelHead } from './settings-panel-head'

export function WindsorGlobalConfig() {
  const [apiKey, setApiKey] = useState('')
  const [keyConfigured, setKeyConfigured] = useState(false)
  const [dashboardUrl, setDashboardUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void fetch('/api/windsor/global-config', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        setKeyConfigured(data.api_key_configured === true)
        setDashboardUrl(data.dashboard_url || '')
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Falha ao carregar.'))
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    try {
      const response = await fetch('/api/windsor/global-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, dashboard_url: dashboardUrl }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setApiKey('')
      setKeyConfigured(true)
      toast.success('Configuração global salva para todas as empresas.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <SettingsPanelHead
        title="Integração global do dashboard"
        description="Uma única chave e uma única URL atendem todas as empresas. As contas de anúncios continuam sendo escolhidas em cada empresa."
      />
      <Card className="space-y-5 p-5">
        <div className="space-y-2">
          <Label htmlFor="windsor-global-key">Chave da API Windsor</Label>
          <div className="relative">
            <KeyRound className="text-muted-foreground absolute top-2.5 left-3 h-4 w-4" />
            <Input
              id="windsor-global-key"
              type="password"
              className="pl-9"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={keyConfigured ? 'Chave configurada — preencha somente para trocar' : 'Informe a chave da API'}
              disabled={loading || saving}
              autoComplete="new-password"
            />
          </div>
          <p className="text-muted-foreground text-xs">A chave é criptografada e nunca é exibida novamente.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="windsor-dashboard-url">URL do dashboard</Label>
          <Input
            id="windsor-dashboard-url"
            type="url"
            value={dashboardUrl}
            onChange={(event) => setDashboardUrl(event.target.value)}
            placeholder="https://connectors.windsor.ai/all"
            disabled={loading || saving}
          />
        </div>
        <Button onClick={() => void save()} disabled={loading || saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {saving ? 'Salvando...' : 'Salvar configuração global'}
        </Button>
      </Card>
    </div>
  )
}
