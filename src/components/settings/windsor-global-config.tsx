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
  const [openAiKey, setOpenAiKey] = useState('')
  const [openAiKeyConfigured, setOpenAiKeyConfigured] = useState(false)
  const [model, setModel] = useState('gpt-4.1-mini')
  const [dashboardUrl, setDashboardUrl] = useState('')
  const [dashboardUrlConfigured, setDashboardUrlConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void fetch('/api/admin/global-integrations', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        setOpenAiKeyConfigured(data.openai_key_configured === true)
        setDashboardUrlConfigured(data.dashboard_url_configured === true)
        setModel(data.openai_model || 'gpt-4.1-mini')
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Falha ao carregar.'))
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    try {
      const response = await fetch('/api/admin/global-integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          openai_api_key: openAiKey,
          openai_model: model,
          dashboard_url: dashboardUrl,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      if (openAiKey) setOpenAiKeyConfigured(true)
      if (dashboardUrl) setDashboardUrlConfigured(true)
      setOpenAiKey('')
      setDashboardUrl('')
      toast.success('Integrações globais salvas para todas as empresas.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <SettingsPanelHead
        title="Integrações globais"
        description="Uma única chave e modelo OpenAI e uma única URL Windsor atendem todas as empresas. Cada empresa escolhe apenas suas contas de anúncios."
      />
      <Card className="space-y-6 p-5">
        <section className="space-y-4">
          <h3 className="font-medium">OpenAI</h3>
          <div className="space-y-2">
            <Label htmlFor="global-openai-key">Chave da API OpenAI</Label>
            <div className="relative">
              <KeyRound className="text-muted-foreground absolute top-2.5 left-3 h-4 w-4" />
              <Input
                id="global-openai-key"
                type="password"
                className="pl-9"
                value={openAiKey}
                onChange={(event) => setOpenAiKey(event.target.value)}
                placeholder={openAiKeyConfigured ? 'Chave configurada — preencha somente para trocar' : 'sk-...'}
                disabled={loading || saving}
                autoComplete="new-password"
              />
            </div>
            <p className="text-muted-foreground text-xs">A chave é criptografada, nunca é exibida novamente e também é usada na base de conhecimento.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="global-openai-model">Modelo OpenAI</Label>
            <Input
              id="global-openai-model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="gpt-4.1-mini"
              disabled={loading || saving}
            />
          </div>
        </section>

        <section className="space-y-4 border-t pt-5">
          <h3 className="font-medium">Dashboard de anúncios (Windsor)</h3>
          <div className="space-y-2">
            <Label htmlFor="windsor-dashboard-url">URL completa do conector</Label>
            <Input
              id="windsor-dashboard-url"
              type="password"
              value={dashboardUrl}
              onChange={(event) => setDashboardUrl(event.target.value)}
              placeholder={dashboardUrlConfigured ? 'URL configurada — preencha somente para trocar' : 'https://connectors.windsor.ai/...?...&api_key=...'}
              disabled={loading || saving}
              autoComplete="new-password"
            />
            <p className="text-muted-foreground text-xs">Cole a URL completa, incluindo o parâmetro api_key. Ela é criptografada e não é exibida novamente.</p>
          </div>
        </section>

        <Button onClick={() => void save()} disabled={loading || saving || !model.trim()}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {saving ? 'Salvando...' : 'Salvar integrações globais'}
        </Button>
      </Card>
    </div>
  )
}
