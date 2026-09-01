'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, Plus, QrCode, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface PublicInstance {
  id: string
  name: string
  status: string
  owner?: string
  profileName?: string
}

interface ListResponse {
  configured: boolean
  instances: PublicInstance[]
  boundInstanceId: string | null
  otherServer?: boolean
  unowned?: PublicInstance[]
  accounts?: { id: string; name: string }[]
}

type Confirmation =
  | { kind: 'delete' | 'disconnect'; id: string }
  | { kind: 'replace'; id: string; message: string }

export function UazapiInstances() {
  const t = useTranslations('Settings.uazapi')
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ListResponse | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [assignTo, setAssignTo] = useState<Record<string, string>>({})
  const [qrFor, setQrFor] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [paircode, setPaircode] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirmation | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/whatsapp/uazapi/instances')
      setData(response.ok ? ((await response.json()) as ListResponse) : null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
  }, [])
  useEffect(() => stopPolling, [stopPolling])

  async function create() {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const response = await fetch('/api/whatsapp/uazapi/instances', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      })
      if (!response.ok) return toast.error(t('genericError'))
      setNewName('')
      await load()
    } finally { setCreating(false) }
  }

  async function connect(id: string) {
    setBusyId(id)
    try {
      const response = await fetch(`/api/whatsapp/uazapi/instances/${id}/connect`, { method: 'POST' })
      const body = await response.json()
      if (!response.ok) return toast.error(response.status === 403 ? t('forbidden') : t('genericError'))
      if (body.connected) {
        toast.success(t('connectedToast'))
        await load()
        return
      }
      setQrFor(id)
      setQr(body.base64 ?? null)
      setPaircode(body.paircode ?? null)
      stopPolling()
      pollRef.current = setInterval(async () => {
        const status = await fetch(`/api/whatsapp/uazapi/instances/${id}/status`)
        const statusBody = await status.json()
        if (statusBody.connected) {
          stopPolling()
          setQrFor(null)
          setQr(null)
          setPaircode(null)
          toast.success(t('connectedToast'))
          void load()
        }
      }, 3000)
    } finally { setBusyId(null) }
  }

  async function bind(id: string, replaceExisting = false) {
    setBusyId(id)
    try {
      const response = await fetch(`/api/whatsapp/uazapi/instances/${id}/bind`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replace_existing: replaceExisting }),
      })
      const body = await response.json()
      if (response.status === 409 && body.requires_confirmation) {
        setConfirm({
          kind: 'replace', id,
          message: body.error === 'replace_meta'
            ? t('replaceMeta')
            : t('replaceUazapi', { current: body.current_instance ?? '', next: body.new_instance ?? '' }),
        })
        return
      }
      if (response.status === 409 && body.error === 'instance_claimed') return toast.error(t('instanceClaimed'))
      if (!response.ok) return toast.error(response.status === 403 ? t('forbidden') : t('genericError'))
      await load()
    } finally { setBusyId(null) }
  }

  async function rename(id: string, current: string) {
    const name = window.prompt(t('renameTitle'), current)?.trim()
    if (!name || name === current) return
    setBusyId(id)
    try {
      const response = await fetch(`/api/whatsapp/uazapi/instances/${id}/name`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      })
      if (!response.ok) return toast.error(t('genericError'))
      await load()
    } finally { setBusyId(null) }
  }

  async function assign(id: string) {
    const accountId = assignTo[id]
    if (!accountId) return
    setBusyId(id)
    try {
      const response = await fetch(`/api/whatsapp/uazapi/instances/${id}/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId }),
      })
      if (!response.ok) return toast.error(t('genericError'))
      await load()
    } finally { setBusyId(null) }
  }

  async function unassign(id: string) {
    setBusyId(id)
    try {
      const response = await fetch(`/api/whatsapp/uazapi/instances/${id}/assign`, { method: 'DELETE' })
      if (!response.ok) return toast.error(t('genericError'))
      await load()
    } finally { setBusyId(null) }
  }

  async function runConfirmed() {
    if (!confirm) return
    const pending = confirm
    setConfirm(null)
    if (pending.kind === 'replace') return bind(pending.id, true)
    setBusyId(pending.id)
    try {
      const response = await fetch(
        pending.kind === 'delete'
          ? `/api/whatsapp/uazapi/instances/${pending.id}`
          : `/api/whatsapp/uazapi/instances/${pending.id}/disconnect`,
        { method: pending.kind === 'delete' ? 'DELETE' : 'POST' },
      )
      if (!response.ok) return toast.error(t('genericError'))
      await load()
    } finally { setBusyId(null) }
  }

  if (loading) return <Card><CardContent className="flex py-8"><Loader2 className="size-4 animate-spin" /></CardContent></Card>
  if (!data?.configured) return (
    <Alert><AlertTitle>{t('notConfigured')}</AlertTitle><AlertDescription>{t('notConfiguredHint')}</AlertDescription></Alert>
  )

  const isSuper = data.accounts !== undefined

  return (
    <>
      {data.otherServer && <Alert><AlertDescription>{t('otherServer')}</AlertDescription></Alert>}
      <Card>
        <CardHeader><CardTitle>{t('title')}</CardTitle><CardDescription>{t('description')}</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={t('namePlaceholder')} />
            <Button onClick={create} disabled={creating || !newName.trim()}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {creating ? t('creating') : t('newInstance')}
            </Button>
          </div>
          {data.instances.length === 0 ? <p className="text-sm text-muted-foreground">{t('empty')}</p> : (
            <ul className="divide-y divide-border">
              {data.instances.map((instance) => (
                <li key={instance.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="flex items-center gap-2 font-medium">
                    {instance.status === 'connected' ? <CheckCircle2 className="size-4 text-primary" /> : <span className="size-2 rounded-full bg-muted-foreground" />}
                    {instance.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {instance.status === 'connected' ? t('connected') : t('disconnected')}
                    {instance.owner ? ` · ${instance.owner}` : ''}{instance.profileName ? ` · ${instance.profileName}` : ''}
                  </span>
                  {data.boundInstanceId === instance.id && <Badge>{t('bound')}</Badge>}
                  <span className="ml-auto flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={busyId === instance.id} onClick={() => connect(instance.id)}><QrCode />{t('qr')}</Button>
                    {data.boundInstanceId !== instance.id && <Button size="sm" variant="outline" disabled={busyId === instance.id} onClick={() => bind(instance.id)}>{t('bind')}</Button>}
                    <Button size="sm" variant="outline" disabled={busyId === instance.id} onClick={() => rename(instance.id, instance.name)}>{t('rename')}</Button>
                    <Button size="sm" variant="outline" disabled={busyId === instance.id} onClick={() => setConfirm({ kind: 'disconnect', id: instance.id })}>{t('disconnect')}</Button>
                    {isSuper && <Button size="sm" variant="outline" disabled={busyId === instance.id} onClick={() => unassign(instance.id)}>{t('unassign')}</Button>}
                    <Button size="sm" variant="destructive" disabled={busyId === instance.id} onClick={() => setConfirm({ kind: 'delete', id: instance.id })}><Trash2 /><span className="sr-only">{t('delete')}</span></Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {isSuper && (data.unowned?.length ?? 0) > 0 && (
        <Card>
          <CardHeader><CardTitle>{t('unownedTitle')}</CardTitle><CardDescription>{t('unownedHint')}</CardDescription></CardHeader>
          <CardContent><ul className="divide-y divide-border">
            {data.unowned!.map((instance) => (
              <li key={instance.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="font-medium">{instance.name}</span>
                <span className="text-xs text-muted-foreground">{instance.status === 'connected' ? t('connected') : t('disconnected')}{instance.owner ? ` · ${instance.owner}` : ''}</span>
                <span className="ml-auto flex items-center gap-2">
                  <select value={assignTo[instance.id] ?? ''} onChange={(event) => setAssignTo((previous) => ({ ...previous, [instance.id]: event.target.value }))} className="h-8 rounded-lg border border-border bg-background px-2 text-sm">
                    <option value="">{t('selectCompany')}</option>
                    {(data.accounts ?? []).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                  </select>
                  <Button size="sm" disabled={busyId === instance.id || !assignTo[instance.id]} onClick={() => assign(instance.id)}>{t('assign')}</Button>
                </span>
              </li>
            ))}
          </ul></CardContent>
        </Card>
      )}

      <Dialog open={!!qrFor} onOpenChange={(open) => { if (!open) { stopPolling(); setQrFor(null) } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('qrTitle')}</DialogTitle><DialogDescription>{t('qrHint')}</DialogDescription></DialogHeader>
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt={t('qrTitle')} className="mx-auto size-64 rounded border bg-white p-2" />
          )}
          {paircode && <p className="text-center text-sm text-muted-foreground">{t('paircode')} <span className="font-mono text-foreground">{paircode}</span></p>}
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirm} onOpenChange={(open) => { if (!open) setConfirm(null) }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{confirm?.kind === 'delete' ? t('deleteTitle') : confirm?.kind === 'disconnect' ? t('disconnectTitle') : t('replaceTitle')}</DialogTitle>
            <DialogDescription>
              {confirm?.kind === 'delete'
                ? t('deleteBody')
                : confirm?.kind === 'disconnect'
                  ? t('disconnectBody')
                  : confirm?.kind === 'replace'
                    ? confirm.message
                    : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>{t('cancel')}</Button>
            <Button variant={confirm?.kind === 'delete' ? 'destructive' : 'default'} onClick={runConfirmed}>{t('confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
