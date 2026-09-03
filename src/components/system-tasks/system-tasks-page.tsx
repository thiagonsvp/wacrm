'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Clock3,
  GripVertical,
  LayoutGrid,
  List,
  Loader2,
  MessageSquare,
  Plus,
  Save,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  TASK_EFFORTS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  type SystemTask,
  type SystemTaskAccount,
  type SystemTaskComment,
  type SystemTaskEffort,
  type SystemTaskHistory,
  type SystemTaskPriority,
  type SystemTaskStatus,
  type SystemTaskType,
} from '@/lib/system-tasks/types'

const STATUS_LABEL: Record<SystemTaskStatus, string> = {
  backlog: 'Ideias / Backlog',
  planned: 'Planejada',
  in_progress: 'Em desenvolvimento',
  validation: 'Em validação',
  completed: 'Concluída',
  cancelled: 'Cancelada',
}
const STATUS_COLOR: Record<SystemTaskStatus, string> = {
  backlog: 'bg-slate-400', planned: 'bg-blue-500', in_progress: 'bg-amber-500',
  validation: 'bg-violet-500', completed: 'bg-emerald-500', cancelled: 'bg-rose-500',
}
const PRIORITY_LABEL: Record<SystemTaskPriority, string> = {
  low: 'Baixa', medium: 'Média', high: 'Alta', urgent: 'Urgente',
}
const PRIORITY_CLASS: Record<SystemTaskPriority, string> = {
  low: 'border-slate-500/30 bg-slate-500/10 text-slate-500',
  medium: 'border-blue-500/30 bg-blue-500/10 text-blue-500',
  high: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
  urgent: 'border-red-500/30 bg-red-500/10 text-red-500',
}
const TYPE_LABEL: Record<SystemTaskType, string> = {
  improvement: 'Melhoria', bug: 'Correção', feature: 'Nova funcionalidade', maintenance: 'Manutenção',
}
const EFFORT_LABEL: Record<SystemTaskEffort, string> = {
  xs: 'Muito pequeno', s: 'Pequeno', m: 'Médio', l: 'Grande', xl: 'Muito grande',
}

type FormState = {
  title: string; description: string; acceptance_criteria: string
  status: SystemTaskStatus; priority: SystemTaskPriority; task_type: SystemTaskType
  module: string; account_id: string; due_date: string; effort: SystemTaskEffort | ''
}
const EMPTY_FORM: FormState = {
  title: '', description: '', acceptance_criteria: '', status: 'backlog', priority: 'medium',
  task_type: 'improvement', module: '', account_id: '', due_date: '', effort: '',
}

async function json(response: Response) {
  const value = await response.json().catch(() => null)
  if (!response.ok) throw new Error(value?.error ?? 'Não foi possível concluir a operação.')
  return value
}

function formFromTask(task: SystemTask): FormState {
  return {
    title: task.title, description: task.description ?? '', acceptance_criteria: task.acceptance_criteria ?? '',
    status: task.status, priority: task.priority, task_type: task.task_type, module: task.module ?? '',
    account_id: task.account_id ?? '', due_date: task.due_date ?? '', effort: task.effort ?? '',
  }
}

function isOverdue(task: SystemTask) {
  return !!task.due_date && !['completed', 'cancelled'].includes(task.status) && task.due_date < new Date().toISOString().slice(0, 10)
}

export function SystemTasksPage() {
  const [tasks, setTasks] = useState<SystemTask[]>([])
  const [accounts, setAccounts] = useState<SystemTaskAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editing, setEditing] = useState<SystemTask | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [comments, setComments] = useState<SystemTaskComment[]>([])
  const [history, setHistory] = useState<SystemTaskHistory[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [comment, setComment] = useState('')
  const [commenting, setCommenting] = useState(false)
  const [view, setView] = useState<'board' | 'list'>('board')
  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState('all')
  const [type, setType] = useState('all')
  const [account, setAccount] = useState('all')

  const loadTasks = useCallback(async () => {
    setLoading(true)
    try {
      const data = await json(await fetch('/api/admin/system-tasks', { cache: 'no-store' }))
      setTasks(data.tasks ?? [])
      setAccounts(data.accounts ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao carregar tarefas.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadTasks() }, [loadTasks])

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('pt-BR')
    return tasks.filter((task) => {
      if (priority !== 'all' && task.priority !== priority) return false
      if (type !== 'all' && task.task_type !== type) return false
      if (account !== 'all' && (account === 'global' ? task.account_id : task.account_id !== account)) return false
      return !needle || [task.title, task.description, task.module, task.account_name].some((value) => value?.toLocaleLowerCase('pt-BR').includes(needle))
    })
  }, [tasks, search, priority, type, account])

  const metrics = useMemo(() => ({
    pending: tasks.filter((task) => !['completed', 'cancelled'].includes(task.status)).length,
    doing: tasks.filter((task) => task.status === 'in_progress').length,
    overdue: tasks.filter(isOverdue).length,
    done: tasks.filter((task) => task.status === 'completed').length,
  }), [tasks])

  function newTask(status: SystemTaskStatus = 'backlog') {
    setEditing(null)
    setForm({ ...EMPTY_FORM, status })
    setComments([])
    setHistory([])
    setSheetOpen(true)
  }

  async function editTask(task: SystemTask) {
    setEditing(task)
    setForm(formFromTask(task))
    setComments([])
    setHistory([])
    setSheetOpen(true)
    setDetailLoading(true)
    try {
      const data = await json(await fetch(`/api/admin/system-tasks/${task.id}`, { cache: 'no-store' }))
      setComments(data.comments ?? [])
      setHistory(data.history ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao carregar detalhes.')
    } finally {
      setDetailLoading(false)
    }
  }

  async function saveTask() {
    if (!form.title.trim()) return toast.error('Informe o título da tarefa.')
    setSaving(true)
    try {
      const response = await fetch(editing ? `/api/admin/system-tasks/${editing.id}` : '/api/admin/system-tasks', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await json(response)
      const accountName = accounts.find((item) => item.id === data.task.account_id)?.name ?? null
      const saved = { ...data.task, account_name: accountName } as SystemTask
      setTasks((current) => editing ? current.map((task) => task.id === saved.id ? saved : task) : [...current, saved])
      setEditing(saved)
      setSheetOpen(false)
      toast.success(editing ? 'Tarefa atualizada.' : 'Tarefa criada.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao salvar tarefa.')
    } finally {
      setSaving(false)
    }
  }

  async function moveTask(id: string, status: SystemTaskStatus) {
    const original = tasks.find((task) => task.id === id)
    if (!original || original.status === status) return
    setTasks((current) => current.map((task) => task.id === id ? { ...task, status } : task))
    try {
      const data = await json(await fetch(`/api/admin/system-tasks/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      }))
      setTasks((current) => current.map((task) => task.id === id ? { ...task, ...data.task } : task))
    } catch (error) {
      setTasks((current) => current.map((task) => task.id === id ? original : task))
      toast.error(error instanceof Error ? error.message : 'Não foi possível mover a tarefa.')
    }
  }

  async function addComment() {
    if (!editing || !comment.trim()) return
    setCommenting(true)
    try {
      await json(await fetch(`/api/admin/system-tasks/${editing.id}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: comment }),
      }))
      setComment('')
      const detail = await json(await fetch(`/api/admin/system-tasks/${editing.id}`, { cache: 'no-store' }))
      setComments(detail.comments ?? [])
      setHistory(detail.history ?? [])
      toast.success('Comentário adicionado.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao comentar.')
    } finally {
      setCommenting(false)
    }
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor))
  const activeTask = activeId ? tasks.find((task) => task.id === activeId) ?? null : null
  function dragStart(event: DragStartEvent) { setActiveId(String(event.active.id)) }
  function dragEnd(event: DragEndEvent) {
    setActiveId(null)
    if (!event.over) return
    const status = String(event.over.id) as SystemTaskStatus
    if (TASK_STATUSES.includes(status)) void moveTask(String(event.active.id), status)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><ClipboardList className="text-primary h-6 w-6" />Controle de Tarefas</h1>
          <p className="text-muted-foreground mt-1 text-sm">Planeje melhorias, correções e atualizações do sistema em um único lugar.</p>
        </div>
        <Button onClick={() => newTask()}><Plus className="mr-2 h-4 w-4" />Nova tarefa</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Pendentes" value={metrics.pending} icon={ClipboardList} />
        <Metric label="Em desenvolvimento" value={metrics.doing} icon={Clock3} />
        <Metric label="Atrasadas" value={metrics.overdue} icon={AlertTriangle} danger={metrics.overdue > 0} />
        <Metric label="Concluídas" value={metrics.done} icon={CheckCircle2} />
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1"><Search className="text-muted-foreground absolute top-2.5 left-3 h-4 w-4" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por título, descrição, módulo ou empresa" className="pl-9" /></div>
          <div className="grid gap-2 sm:grid-cols-3 xl:flex">
            <FilterSelect value={priority} onChange={setPriority} label="Todas as prioridades" options={TASK_PRIORITIES.map((value) => ({ value, label: PRIORITY_LABEL[value] }))} />
            <FilterSelect value={type} onChange={setType} label="Todos os tipos" options={TASK_TYPES.map((value) => ({ value, label: TYPE_LABEL[value] }))} />
            <FilterSelect value={account} onChange={setAccount} label="Todas as empresas" options={[{ value: 'global', label: 'Global' }, ...accounts.map((item) => ({ value: item.id, label: item.name }))]} />
          </div>
          <div className="bg-muted flex rounded-lg p-1">
            <Button size="sm" variant={view === 'board' ? 'secondary' : 'ghost'} onClick={() => setView('board')}><LayoutGrid className="mr-1.5 h-4 w-4" />Quadro</Button>
            <Button size="sm" variant={view === 'list' ? 'secondary' : 'ghost'} onClick={() => setView('list')}><List className="mr-1.5 h-4 w-4" />Lista</Button>
          </div>
        </div>
      </Card>

      {loading ? <div className="text-muted-foreground flex justify-center py-20"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Carregando tarefas...</div> : view === 'board' ? (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={dragStart} onDragEnd={dragEnd} onDragCancel={() => setActiveId(null)}>
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4">
            {TASK_STATUSES.map((status) => <TaskColumn key={status} status={status} tasks={filtered.filter((task) => task.status === status)} onAdd={() => newTask(status)} onEdit={(task) => void editTask(task)} />)}
          </div>
          <DragOverlay>{activeTask ? <TaskCard task={activeTask} overlay /> : null}</DragOverlay>
        </DndContext>
      ) : <TaskList tasks={filtered} onEdit={(task) => void editTask(task)} />}

      <TaskSheet open={sheetOpen} onOpenChange={setSheetOpen} editing={editing} form={form} setForm={setForm} accounts={accounts} saving={saving} onSave={() => void saveTask()} comments={comments} history={history} detailLoading={detailLoading} comment={comment} setComment={setComment} commenting={commenting} onComment={() => void addComment()} />
    </div>
  )
}

function Metric({ label, value, icon: Icon, danger = false }: { label: string; value: number; icon: typeof ClipboardList; danger?: boolean }) {
  return <Card className="flex-row items-center p-4"><div className={cn('bg-primary/10 text-primary rounded-lg p-2', danger && 'bg-red-500/10 text-red-500')}><Icon className="h-5 w-5" /></div><div><p className="text-2xl font-bold">{value}</p><p className="text-muted-foreground text-xs">{label}</p></div></Card>
}

function FilterSelect({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: { value: string; label: string }[] }) {
  return <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="border-input bg-background h-9 min-w-44 rounded-lg border px-3 text-sm"><option className="bg-white text-slate-950" value="all">{label}</option>{options.map((option) => <option className="bg-white text-slate-950" key={option.value} value={option.value}>{option.label}</option>)}</select>
}

function TaskColumn({ status, tasks, onAdd, onEdit }: { status: SystemTaskStatus; tasks: SystemTask[]; onAdd: () => void; onEdit: (task: SystemTask) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return <section className={cn('bg-muted/25 flex w-[85vw] max-w-[310px] shrink-0 snap-start flex-col rounded-xl border p-3 transition-colors sm:w-[300px]', isOver && 'border-primary bg-primary/5')}>
    <div className="mb-3 flex items-center gap-2"><span className={cn('h-2.5 w-2.5 rounded-full', STATUS_COLOR[status])} /><h2 className="font-semibold">{STATUS_LABEL[status]}</h2><Badge variant="secondary" className="ml-auto">{tasks.length}</Badge></div>
    <div ref={setNodeRef} className="flex min-h-28 flex-1 flex-col gap-2">{tasks.map((task) => <DraggableTask key={task.id} task={task} onEdit={onEdit} />)}{!tasks.length && <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-xs">Arraste uma tarefa para cá</p>}</div>
    <Button variant="ghost" size="sm" className="mt-2 w-full justify-start text-muted-foreground" onClick={onAdd}><Plus className="mr-1 h-3.5 w-3.5" />Adicionar tarefa</Button>
  </section>
}

function DraggableTask({ task, onEdit }: { task: SystemTask; onEdit: (task: SystemTask) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })
  return <div ref={setNodeRef} className={cn(isDragging && 'opacity-30')}><TaskCard task={task} onEdit={onEdit} dragProps={{ ...attributes, ...listeners }} /></div>
}

function TaskCard({ task, onEdit, dragProps, overlay = false }: { task: SystemTask; onEdit?: (task: SystemTask) => void; dragProps?: Record<string, unknown>; overlay?: boolean }) {
  return <Card className={cn('gap-3 p-3', overlay && 'w-[290px] rotate-1 shadow-xl')}>
    <div className="flex items-start gap-2"><button type="button" onClick={() => onEdit?.(task)} className="min-w-0 flex-1 text-left"><p className="line-clamp-2 font-medium leading-snug">{task.title}</p></button>{dragProps && <button type="button" aria-label="Arrastar tarefa" className="text-muted-foreground cursor-grab touch-none p-1 active:cursor-grabbing" {...dragProps}><GripVertical className="h-4 w-4" /></button>}</div>
    <div className="flex flex-wrap gap-1.5"><Badge variant="outline" className={PRIORITY_CLASS[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge><Badge variant="secondary">{TYPE_LABEL[task.task_type]}</Badge>{task.effort && <Badge variant="outline">{task.effort.toUpperCase()}</Badge>}</div>
    {(task.module || task.account_name) && <p className="text-muted-foreground truncate text-xs">{[task.module, task.account_name].filter(Boolean).join(' · ')}</p>}
    {task.due_date && <p className={cn('text-muted-foreground flex items-center gap-1 text-xs', isOverdue(task) && 'font-medium text-red-500')}><CalendarDays className="h-3.5 w-3.5" />{new Date(`${task.due_date}T12:00:00`).toLocaleDateString('pt-BR')}</p>}
  </Card>
}

function TaskList({ tasks, onEdit }: { tasks: SystemTask[]; onEdit: (task: SystemTask) => void }) {
  return <Card className="overflow-x-auto p-0"><table className="w-full min-w-[760px] text-sm"><thead className="bg-muted/50 text-muted-foreground"><tr><th className="p-3 text-left">Tarefa</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Prioridade</th><th className="p-3 text-left">Tipo</th><th className="p-3 text-left">Empresa</th><th className="p-3 text-left">Prazo</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.id} onClick={() => onEdit(task)} className="hover:bg-muted/40 cursor-pointer border-t"><td className="p-3"><p className="font-medium">{task.title}</p><p className="text-muted-foreground text-xs">{task.module || 'Sem módulo'}</p></td><td className="p-3"><span className="flex items-center gap-2"><span className={cn('h-2 w-2 rounded-full', STATUS_COLOR[task.status])} />{STATUS_LABEL[task.status]}</span></td><td className="p-3">{PRIORITY_LABEL[task.priority]}</td><td className="p-3">{TYPE_LABEL[task.task_type]}</td><td className="p-3">{task.account_name || 'Global'}</td><td className={cn('p-3', isOverdue(task) && 'font-medium text-red-500')}>{task.due_date ? new Date(`${task.due_date}T12:00:00`).toLocaleDateString('pt-BR') : '—'}</td></tr>)}{!tasks.length && <tr><td colSpan={6} className="text-muted-foreground p-10 text-center">Nenhuma tarefa encontrada.</td></tr>}</tbody></table></Card>
}

function TaskSheet({ open, onOpenChange, editing, form, setForm, accounts, saving, onSave, comments, history, detailLoading, comment, setComment, commenting, onComment }: { open: boolean; onOpenChange: (open: boolean) => void; editing: SystemTask | null; form: FormState; setForm: React.Dispatch<React.SetStateAction<FormState>>; accounts: SystemTaskAccount[]; saving: boolean; onSave: () => void; comments: SystemTaskComment[]; history: SystemTaskHistory[]; detailLoading: boolean; comment: string; setComment: (value: string) => void; commenting: boolean; onComment: () => void }) {
  const field = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }))
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="w-full overflow-hidden sm:max-w-2xl">
    <SheetHeader className="border-b pr-12"><SheetTitle>{editing ? 'Editar tarefa' : 'Nova tarefa'}</SheetTitle><SheetDescription>{editing ? 'Atualize o planejamento e acompanhe o histórico.' : 'Registre uma melhoria, correção ou atualização.'}</SheetDescription></SheetHeader>
    <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
      <div className="space-y-2"><Label htmlFor="task-title">Título</Label><Input id="task-title" value={form.title} onChange={(e) => field('title', e.target.value)} maxLength={120} placeholder="Ex.: Melhorar relatório de conversões" /></div>
      <div className="grid gap-4 sm:grid-cols-2"><FormSelect label="Status" value={form.status} onChange={(v) => field('status', v as SystemTaskStatus)} options={TASK_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] }))} /><FormSelect label="Prioridade" value={form.priority} onChange={(v) => field('priority', v as SystemTaskPriority)} options={TASK_PRIORITIES.map((value) => ({ value, label: PRIORITY_LABEL[value] }))} /><FormSelect label="Tipo" value={form.task_type} onChange={(v) => field('task_type', v as SystemTaskType)} options={TASK_TYPES.map((value) => ({ value, label: TYPE_LABEL[value] }))} /><FormSelect label="Esforço" value={form.effort} onChange={(v) => field('effort', v as SystemTaskEffort | '')} empty="Não estimado" options={TASK_EFFORTS.map((value) => ({ value, label: EFFORT_LABEL[value] }))} /></div>
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="task-module">Módulo</Label><Input id="task-module" value={form.module} onChange={(e) => field('module', e.target.value)} maxLength={80} placeholder="Pipeline, Dashboard, WhatsApp..." /></div><div className="space-y-2"><Label htmlFor="task-due">Prazo</Label><Input id="task-due" type="date" value={form.due_date} onChange={(e) => field('due_date', e.target.value)} /></div></div>
      <FormSelect label="Empresa relacionada" value={form.account_id} onChange={(v) => field('account_id', v)} empty="Global — todas as empresas" options={accounts.map((item) => ({ value: item.id, label: item.name }))} />
      <div className="space-y-2"><Label htmlFor="task-description">Descrição</Label><Textarea id="task-description" value={form.description} onChange={(e) => field('description', e.target.value)} className="min-h-28 resize-y" placeholder="Contexto, problema e resultado esperado..." /></div>
      <div className="space-y-2"><Label htmlFor="task-acceptance">Critérios de aceite</Label><Textarea id="task-acceptance" value={form.acceptance_criteria} onChange={(e) => field('acceptance_criteria', e.target.value)} className="min-h-24 resize-y" placeholder="Como saberemos que a tarefa está concluída?" /></div>
      {editing && <div className="space-y-5 border-t pt-5"><div><h3 className="flex items-center gap-2 font-semibold"><MessageSquare className="h-4 w-4" />Comentários</h3><div className="mt-3 flex gap-2"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-16" placeholder="Registre uma decisão ou atualização..." /><Button onClick={onComment} disabled={commenting || !comment.trim()}>{commenting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Adicionar'}</Button></div><div className="mt-3 space-y-2">{detailLoading ? <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" /> : comments.length ? comments.map((item) => <div key={item.id} className="bg-muted/40 rounded-lg p-3"><p className="whitespace-pre-wrap text-sm">{item.body}</p><p className="text-muted-foreground mt-1 text-xs">{item.author_name || 'Administrador'} · {new Date(item.created_at).toLocaleString('pt-BR')}</p></div>) : <p className="text-muted-foreground text-xs">Nenhum comentário ainda.</p>}</div></div><div><h3 className="flex items-center gap-2 font-semibold"><Clock3 className="h-4 w-4" />Histórico</h3><div className="mt-3 space-y-2">{history.map((item) => <div key={item.id} className="flex gap-2 text-xs"><CircleDot className="text-primary mt-0.5 h-3.5 w-3.5 shrink-0" /><p><span className="font-medium">{item.author_name || 'Administrador'}</span> {historyText(item)} <span className="text-muted-foreground">· {new Date(item.created_at).toLocaleString('pt-BR')}</span></p></div>)}</div></div></div>}
    </div>
    <SheetFooter className="border-t"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={onSave} disabled={saving || !form.title.trim()}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{saving ? 'Salvando...' : 'Salvar tarefa'}</Button></SheetFooter>
  </SheetContent></Sheet>
}

function FormSelect({ label, value, onChange, options, empty }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; empty?: string }) {
  return <div className="space-y-2"><Label>{label}</Label><select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="border-input bg-background h-9 w-full rounded-lg border px-3 text-sm">{empty !== undefined && <option className="bg-white text-slate-950" value="">{empty}</option>}{options.map((option) => <option className="bg-white text-slate-950" key={option.value} value={option.value}>{option.label}</option>)}</select></div>
}

function historyText(item: SystemTaskHistory) {
  if (item.action === 'created') return 'criou a tarefa.'
  if (item.action === 'commented') return 'adicionou um comentário.'
  if (item.field === 'status') return `moveu de “${STATUS_LABEL[item.old_value as SystemTaskStatus] ?? item.old_value}” para “${STATUS_LABEL[item.new_value as SystemTaskStatus] ?? item.new_value}”.`
  const fields: Record<string, string> = { title: 'o título', description: 'a descrição', acceptance_criteria: 'os critérios de aceite', priority: 'a prioridade', task_type: 'o tipo', module: 'o módulo', account_id: 'a empresa', due_date: 'o prazo', effort: 'o esforço' }
  return `alterou ${fields[item.field ?? ''] ?? item.field ?? 'a tarefa'}.`
}
