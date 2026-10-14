"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  type Edge as RfEdge,
  type Node as RfNode,
  type NodeChange,
  type NodeProps,
  type OnNodeDrag,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { useAuth } from "@/hooks/use-auth"
import {
  ArrowLeft,
  Plus,
  Trash2,
  MessageSquare,
  FileText,
  Tag,
  TagIcon,
  UserCheck,
  PencilLine,
  Briefcase,
  Hourglass,
  GitBranch,
  LayoutGrid,
  Webhook,
  CircleSlash,
  Zap,
  Loader2,
  ArrowDown,
  ArrowUp,
  MousePointerClick,
  List,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type {
  AccountMember,
  AutomationStepType,
  AutomationTriggerType,
  CustomField,
  InteractiveMessagePayload,
  KeywordMatchTriggerConfig,
  MessageTemplate,
  Tag as TagRecord,
} from "@/types"
import {
  InteractiveBuilder,
  blankButtonsPayload,
  blankListPayload,
} from "@/components/interactive/interactive-builder"
import { interactivePayloadPreviewText } from "@/lib/whatsapp/interactive"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  flattenSteps,
  layoutAll,
  nodeSize,
  resolvePositions,
  TRIGGER_NODE_ID,
  withPositions,
  type CanvasPos,
  type ParentScope,
  type StepPath,
} from "@/lib/automations/canvas"

// ------------------------------------------------------------
// Types (builder-local — mirror the flattened rows we POST)
// ------------------------------------------------------------

export interface BuilderStep {
  /** Client id; the API assigns real UUIDs server-side. */
  cid: string
  step_type: AutomationStepType
  step_config: Record<string, unknown>
  /** Canvas position (top-left). Null = never placed; laid out on load. */
  pos?: CanvasPos | null
  branches?: { yes: BuilderStep[]; no: BuilderStep[] }
}

export interface BuilderInitial {
  id?: string
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: Record<string, unknown>
  is_active: boolean
  steps: BuilderStep[]
  trigger_position?: CanvasPos | null
}

// ------------------------------------------------------------
// Step metadata — one source of truth for icon + label + border color
// ------------------------------------------------------------

interface StepMeta {
  label: string
  icon: typeof Zap
  /** Left-border accent color per spec. */
  border: string
}

const STEP_META: Record<AutomationStepType, StepMeta> = {
  send_message: { label: "send_message", icon: MessageSquare, border: "border-l-primary" },
  send_buttons: { label: "send_buttons", icon: MousePointerClick, border: "border-l-primary" },
  send_list: { label: "send_list", icon: List, border: "border-l-primary" },
  send_template: { label: "send_template", icon: FileText, border: "border-l-primary" },
  add_tag: { label: "add_tag", icon: Tag, border: "border-l-primary" },
  remove_tag: { label: "remove_tag", icon: TagIcon, border: "border-l-primary" },
  assign_conversation: { label: "assign_conversation", icon: UserCheck, border: "border-l-primary" },
  update_contact_field: { label: "update_contact_field", icon: PencilLine, border: "border-l-primary" },
  create_deal: { label: "create_deal", icon: Briefcase, border: "border-l-primary" },
  wait: { label: "wait", icon: Hourglass, border: "border-l-border" },
  condition: { label: "condition", icon: GitBranch, border: "border-l-amber-500" },
  send_webhook: { label: "send_webhook", icon: Webhook, border: "border-l-primary" },
  close_conversation: { label: "close_conversation", icon: CircleSlash, border: "border-l-primary" },
}

const ADDABLE_STEPS: AutomationStepType[] = [
  "send_message",
  "send_buttons",
  "send_list",
  "send_template",
  "add_tag",
  "remove_tag",
  "assign_conversation",
  "update_contact_field",
  "create_deal",
  "wait",
  "condition",
  "send_webhook",
  "close_conversation",
]

const TRIGGER_OPTIONS: { value: AutomationTriggerType }[] = [
  { value: "new_message_received" },
  { value: "first_inbound_message" },
  { value: "keyword_match" },
  { value: "interactive_reply" },
  { value: "new_contact_created" },
  { value: "conversation_assigned" },
  { value: "tag_added" },
  { value: "time_based" },
]

function cid(): string {
  return (
    "c_" +
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  )
}

// The send_buttons / send_list step_config IS an InteractiveMessagePayload,
// but step_config is typed generically as Record<string, unknown>. These two
// helpers hold the single unavoidable structural cast in one place so a
// payload-shape change has one seam to update instead of four scattered
// `as unknown as` sites.
function toStepConfig(p: InteractiveMessagePayload): Record<string, unknown> {
  return p as unknown as Record<string, unknown>
}
function asInteractive(cfg: Record<string, unknown>): InteractiveMessagePayload {
  return cfg as unknown as InteractiveMessagePayload
}

function blankConfig(type: AutomationStepType): Record<string, unknown> {
  switch (type) {
    case "send_message":
      return { text: "" }
    case "send_buttons":
      return toStepConfig(blankButtonsPayload())
    case "send_list":
      return toStepConfig(blankListPayload())
    case "send_template":
      return { template_name: "", language: "en_US" }
    case "add_tag":
    case "remove_tag":
      return { tag_id: "" }
    case "assign_conversation":
      return { mode: "round_robin" }
    case "update_contact_field":
      return { field: "name", value: "" }
    case "create_deal":
      return { pipeline_id: "", stage_id: "", title: "", value: 0 }
    case "wait":
      return { amount: 1, unit: "hours" }
    case "condition":
      return { subject: "tag_presence", operand: "", value: "" }
    case "send_webhook":
      return { url: "", headers: {}, body_template: "" }
    case "close_conversation":
      return {}
    default:
      return {}
  }
}

// ------------------------------------------------------------
// Account resources (tags, members, approved templates, pipelines)
//
// Loaded once at the builder root and shared via context so the
// tag / agent / template pickers below can offer existing resources
// by name instead of asking the user to paste raw UUIDs. Every picker
// falls back to a raw input when its list is empty (fresh account or
// an older deployment), so an automation is always authorable.
// ------------------------------------------------------------

interface AutomationResources {
  tags: TagRecord[]
  members: AccountMember[]
  templates: MessageTemplate[]
  customFields: CustomField[]
  pipelines: PipelineOption[]
  stages: PipelineStageOption[]
}

interface PipelineOption {
  id: string
  name: string
}

interface PipelineStageOption {
  id: string
  name: string
  pipeline_id: string
  position: number
}

const ResourcesContext = createContext<AutomationResources>({
  tags: [],
  members: [],
  templates: [],
  customFields: [],
  pipelines: [],
  stages: [],
})

function useResources(): AutomationResources {
  return useContext(ResourcesContext)
}

function ResourcesProvider({ children }: { children: ReactNode }) {
  const { accountId } = useAuth()
  const [tags, setTags] = useState<TagRecord[]>([])
  const [members, setMembers] = useState<AccountMember[]>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [customFields, setCustomFields] = useState<CustomField[]>([])
  const [pipelines, setPipelines] = useState<PipelineOption[]>([])
  const [stages, setStages] = useState<PipelineStageOption[]>([])

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    // Tags, templates and custom fields come straight from the DB — RLS
    // scopes them to the caller's account. Only APPROVED templates can
    // actually be sent (anything else 400s at send time), matching the
    // broadcast picker.
    void (async () => {
      const [tagsRes, templatesRes, customFieldsRes, pipelinesRes, stagesRes] =
        await Promise.all([
          supabase.from("tags").select("*").order("name"),
          supabase
            .from("message_templates")
            .select("*")
            .eq("status", "APPROVED")
            .order("name"),
          supabase.from("custom_fields").select("*").order("field_name"),
          supabase.from("pipelines").select("id, name").eq("account_id", accountId).order("name"),
          supabase
            .from("pipeline_stages")
            .select("id, name, pipeline_id, position")
            .order("position"),
        ])
      if (cancelled) return
      setTags((tagsRes.data as TagRecord[] | null) ?? [])
      setTemplates((templatesRes.data as MessageTemplate[] | null) ?? [])
      setCustomFields((customFieldsRes.data as CustomField[] | null) ?? [])
      setPipelines((pipelinesRes.data as PipelineOption[] | null) ?? [])
      setStages((stagesRes.data as PipelineStageOption[] | null) ?? [])
    })()

    // Members go through the API so we inherit its email-visibility
    // rules (agents/viewers don't see emails). Unreachable on older
    // deployments → pickers fall back to a raw agent-id input.
    void (async () => {
      try {
        const res = await fetch("/api/account/members", { cache: "no-store" })
        if (!res.ok) return
        const json = (await res.json()) as { members?: AccountMember[] }
        if (!cancelled) setMembers(json.members ?? [])
      } catch {
        // Members endpoint absent — caller falls back to raw input.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [accountId])

  return (
    <ResourcesContext.Provider
      value={{ tags, members, templates, customFields, pipelines, stages }}
    >
      {children}
    </ResourcesContext.Provider>
  )
}

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"

/** Tag dropdown by name + color, storing the tag's id. Falls back to a
 *  raw id input when no tags exist yet. */
function TagSelect({
  value,
  onChange,
  t,
}: {
  value: string
  onChange: (v: string) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { tags } = useResources()
  if (tags.length === 0) {
    return (
      <Input
        placeholder={t("tags.placeholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted text-foreground"
      />
    )
  }
  const selected = tags.find((t) => t.id === value)
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-3 w-3 shrink-0 rounded-full border border-border"
        style={{ backgroundColor: selected?.color ?? "transparent" }}
        aria-hidden
      />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT_CLASS}
      >
        <option value="">{t("tags.select")}</option>
        {tags.map((tg) => (
          <option key={tg.id} value={tg.id}>
            {tg.name}
          </option>
        ))}
        {/* Preserve a saved tag that's since been deleted so editing an
            existing automation doesn't silently drop it. */}
        {value && !selected && (
          <option value={value}>{t("tags.unknown", { id: value })}</option>
        )}
      </select>
    </div>
  )
}

/** Contact-field dropdown for "Update Contact Field": built-in columns plus
 *  any account custom fields (stored as `custom:<id>`). A saved custom field
 *  that's since been deleted is preserved as a labelled option so editing an
 *  existing automation doesn't silently drop it. */
function ContactFieldSelect({
  value,
  onChange,
  t,
}: {
  value: string
  onChange: (v: string) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { customFields } = useResources()
  const customValue = value.startsWith("custom:") ? value : ""
  const knownCustom =
    customValue && customFields.some((f) => `custom:${f.id}` === customValue)
  return (
    <select
      value={value || "name"}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT_CLASS}
    >
      <option value="name">{t("fields.name")}</option>
      <option value="email">{t("fields.email")}</option>
      <option value="company">{t("fields.company")}</option>
      {customFields.length > 0 && (
        <optgroup label={t("fields.customFields")}>
          {customFields.map((f) => (
            <option key={f.id} value={`custom:${f.id}`}>
              {f.field_name}
            </option>
          ))}
        </optgroup>
      )}
      {customValue && !knownCustom && (
        <option value={customValue}>{t("fields.unknown", { id: customValue })}</option>
      )}
    </select>
  )
}

/** Agent dropdown by name, storing the member's user_id. Falls back to
 *  a raw id input when the member list is unavailable. */
function AgentSelect({
  value,
  onChange,
  t,
}: {
  value: string
  onChange: (v: string) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { members } = useResources()
  if (members.length === 0) {
    return (
      <Input
        placeholder={t("agents.placeholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted text-foreground"
      />
    )
  }
  const selected = members.find((m) => m.user_id === value)
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT_CLASS}
    >
      <option value="">{t("agents.select")}</option>
      {members.map((m) => (
        <option key={m.user_id} value={m.user_id}>
          {m.full_name || m.email || m.user_id}
        </option>
      ))}
      {value && !selected && (
        <option value={value}>{t("agents.unknown", { id: value })}</option>
      )}
    </select>
  )
}

/** Pipeline + stage picker for Create Deal. The automation stores ids because
 *  the engine writes directly to deals, but authors should choose by name. */
function DealPipelineFields({
  pipelineId,
  stageId,
  onChange,
  t,
}: {
  pipelineId: string
  stageId: string
  onChange: (patch: { pipeline_id: string; stage_id: string }) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { pipelines, stages } = useResources()

  if (pipelines.length === 0) {
    return (
      <>
        <FieldBlock label={t("pipelines.pipelineIdLabel")}>
          <Input
            value={pipelineId}
            onChange={(e) =>
              onChange({ pipeline_id: e.target.value, stage_id: stageId })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
        <FieldBlock label={t("pipelines.stageIdLabel")}>
          <Input
            value={stageId}
            onChange={(e) =>
              onChange({ pipeline_id: pipelineId, stage_id: e.target.value })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      </>
    )
  }

  const selectedPipeline = pipelines.find((p) => p.id === pipelineId)
  const stageOptions = stages.filter((s) => s.pipeline_id === pipelineId)
  const selectedStage = stageOptions.find((s) => s.id === stageId)

  return (
    <>
      <FieldBlock label={t("pipelines.pipelineLabel")}>
        <select
          value={pipelineId}
          onChange={(e) => {
            const nextPipelineId = e.target.value
            const firstStage = stages.find(
              (s) => s.pipeline_id === nextPipelineId
            )
            onChange({
              pipeline_id: nextPipelineId,
              stage_id: firstStage?.id ?? "",
            })
          }}
          className={SELECT_CLASS}
        >
          <option value="">{t("pipelines.selectPipeline")}</option>
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {pipelineId && !selectedPipeline && (
            <option value={pipelineId}>{t("pipelines.unknownPipeline", { id: pipelineId })}</option>
          )}
        </select>
      </FieldBlock>
      <FieldBlock label={t("pipelines.stageLabel")}>
        <select
          value={stageId}
          onChange={(e) =>
            onChange({ pipeline_id: pipelineId, stage_id: e.target.value })
          }
          className={SELECT_CLASS}
          disabled={!pipelineId || stageOptions.length === 0}
        >
          <option value="">
            {pipelineId ? t("pipelines.selectStage") : t("pipelines.selectPipelineFirst")}
          </option>
          {stageOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          {stageId && pipelineId && !selectedStage && (
            <option value={stageId}>{t("pipelines.unknownStage", { id: stageId })}</option>
          )}
        </select>
      </FieldBlock>
    </>
  )
}

/** Template dropdown showing approved templates by name + language,
 *  storing both template_name and language. Falls back to manual name +
 *  language inputs when no approved templates are synced yet. */
function SendTemplateFields({
  templateName,
  language,
  onChange,
  t,
}: {
  templateName: string
  language: string
  onChange: (patch: { template_name: string; language: string }) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { templates } = useResources()

  if (templates.length === 0) {
    return (
      <>
        <FieldBlock label={t("templates.templateNameLabel")}>
          <Input
            value={templateName}
            onChange={(e) =>
              onChange({ template_name: e.target.value, language })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
        <FieldBlock label={t("templates.languageLabel")}>
          <Input
            value={language}
            onChange={(e) =>
              onChange({ template_name: templateName, language: e.target.value })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      </>
    )
  }

  // Encode name + language in the option value so two templates that
  // share a name across languages stay distinct.
  const toValue = (name: string, lang: string) => `${name}::${lang}`
  const current = templateName ? toValue(templateName, language) : ""
  const hasMatch = templates.some(
    (t) => toValue(t.name, t.language ?? "en_US") === current,
  )

  return (
    <FieldBlock label={t("templates.templateLabel")}>
      <select
        value={current}
        onChange={(e) => {
          const [name, lang] = e.target.value.split("::")
          onChange({ template_name: name ?? "", language: lang ?? "" })
        }}
        className={SELECT_CLASS}
      >
        <option value="">{t("templates.select")}</option>
        {templates.map((tmpl) => {
          const lang = tmpl.language ?? "en_US"
          return (
            <option key={tmpl.id} value={toValue(tmpl.name, lang)}>
              {tmpl.name} ({lang})
            </option>
          )
        })}
        {current && !hasMatch && (
          <option value={current}>
            {t("templates.unknown", { name: templateName, lang: language || t("templates.unknownLang") })}
          </option>
        )}
      </select>
    </FieldBlock>
  )
}

// ------------------------------------------------------------
// Main builder component
// ------------------------------------------------------------

export function AutomationBuilder({ initial }: { initial: BuilderInitial }) {
  const router = useRouter()
  const t = useTranslations("Automations.builder")
  const isEditing = !!initial.id
  const [state, setState] = useState<BuilderInitial>(initial)
  const [saving, setSaving] = useState(false)
  // Canvas node whose editor is open in the side sheet (a step cid or
  // TRIGGER_NODE_ID).
  const [selectedId, setSelectedId] = useState<string | null>(null)

  function patchTop<K extends keyof BuilderInitial>(key: K, value: BuilderInitial[K]) {
    setState((s) => ({ ...s, [key]: value }))
  }

  // --- Step tree mutations (immutable) ---

  function updateStep(path: StepPath, updater: (s: BuilderStep) => BuilderStep) {
    setState((s) => ({ ...s, steps: mapAtPath(s.steps, path, updater) }))
  }

  // Stable: canvas nodes hold it in their data.
  const addStepAt = useCallback(
    (parent: ParentScope, index: number, type: AutomationStepType) => {
      const node: BuilderStep = {
        cid: cid(),
        step_type: type,
        step_config: blankConfig(type),
        branches: type === "condition" ? { yes: [], no: [] } : undefined,
      }
      setState((s) => ({ ...s, steps: insertAt(s.steps, parent, index, node) }))
      setSelectedId(node.cid)
    },
    [],
  )

  function deleteStepAt(path: StepPath) {
    setState((s) => ({ ...s, steps: removeAt(s.steps, path) }))
    setSelectedId(null)
  }

  function moveStepAt(path: StepPath, direction: -1 | 1) {
    setState((s) => ({ ...s, steps: moveAt(s.steps, path, direction) }))
  }

  // Stable so the canvas can call it from an effect without looping.
  const setPositions = useCallback((positions: Map<string, CanvasPos>) => {
    setState((s) => ({
      ...s,
      steps: withPositions(s.steps, positions),
      trigger_position: positions.get(TRIGGER_NODE_ID) ?? s.trigger_position ?? null,
    }))
  }, [])

  async function save() {
    setSaving(true)
    try {
      const payload = {
        name: state.name || "Untitled automation",
        description: state.description || null,
        trigger_type: state.trigger_type,
        trigger_config: state.trigger_config,
        is_active: state.is_active,
        steps: toApiSteps(state.steps),
        canvas_trigger_position: state.trigger_position ?? null,
      }

      const res = isEditing
        ? await fetch(`/api/automations/${initial.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/automations`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })

      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // If the server blocked activation with validation issues,
        // surface the first concrete problem so the user can fix it
        // without opening DevTools for the full array.
        const firstIssue: { path?: string; message?: string } | undefined =
          body?.issues?.[0]
        if (firstIssue?.message) {
          toast.error(firstIssue.message, {
            description: firstIssue.path ? `at ${firstIssue.path}` : undefined,
          })
        } else {
          toast.error(body?.error ?? t("toasts.saveFailed"))
        }
        return
      }
      toast.success(isEditing ? t("toasts.saved") : t("toasts.created"))
      if (!isEditing && body?.automation?.id) {
        router.replace(`/automations/${body.automation.id}/edit`)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* Top bar. At sub-sm widths the "Active" label is hidden and the
          switch moves to the right of the save button, so the name input
          gets maximum width. */}
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-card/80 px-3 py-3 sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={() => router.push("/automations")}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t("backToAutomations")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <input
          value={state.name}
          onChange={(e) => patchTop("name", e.target.value)}
          placeholder={t("untitled")}
          className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:bg-muted focus:outline-none sm:text-base"
        />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden sm:inline">{t("active")}</span>
          <Switch
            checked={state.is_active}
            onCheckedChange={(v) => patchTop("is_active", !!v)}
            aria-label={t("activeAria")}
          />
        </div>
        <Button
          onClick={save}
          disabled={saving}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isEditing ? t("save") : t("saveDraft")}
        </Button>
      </header>

      <div className="relative min-h-0 flex-1">
        <ResourcesProvider>
          <AutomationCanvas
            state={state}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onPositions={setPositions}
            addStepAt={addStepAt}
          />
          <NodeSheet
            state={state}
            selectedId={selectedId}
            onClose={() => setSelectedId(null)}
            onTriggerTypeChange={(v) => patchTop("trigger_type", v)}
            onTriggerConfigChange={(c) => patchTop("trigger_config", c)}
            updateStep={updateStep}
            deleteStepAt={deleteStepAt}
            moveStepAt={moveStepAt}
          />
        </ResourcesProvider>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Trigger editor (shown in the side sheet)
// ------------------------------------------------------------

function TriggerEditor({
  type,
  config,
  onTypeChange,
  onConfigChange,
  t,
}: {
  type: AutomationTriggerType
  config: Record<string, unknown>
  onTypeChange: (t: AutomationTriggerType) => void
  onConfigChange: (c: Record<string, unknown>) => void
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("triggerType")}
        </label>
        <select
          value={type}
          onChange={(e) => onTypeChange(e.target.value as AutomationTriggerType)}
          className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
        >
          {TRIGGER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(`triggers.${o.value}.label`)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t(`triggers.${type}.hint`)}
        </p>
      </div>
      {type === "keyword_match" && (
        <KeywordMatchConfig
          config={config as unknown as KeywordMatchTriggerConfig}
          onChange={onConfigChange}
          t={t}
        />
      )}
      {type === "interactive_reply" && (
        <InteractiveReplyConfig config={config} onChange={onConfigChange} t={t} />
      )}
      {type === "tag_added" && (
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("config.tagLabel")}
          </label>
          <TagSelect
            value={(config.tag_id as string) ?? ""}
            onChange={(v) => onConfigChange({ ...config, tag_id: v })}
            t={t}
          />
        </div>
      )}
      {type === "time_based" && (
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("schedule")}
          </label>
          <Input
            placeholder="Expressão cron ou HH:mm"
            value={(config.schedule as string) ?? ""}
            onChange={(e) => onConfigChange({ ...config, schedule: e.target.value })}
            className="bg-muted text-foreground"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("scheduleHint")}
          </p>
        </div>
      )}
    </div>
  )
}

function KeywordMatchConfig({
  config,
  onChange,
  t,
}: {
  config: KeywordMatchTriggerConfig
  onChange: (c: Record<string, unknown>) => void
  t: ReturnType<typeof useTranslations>
}) {
  const keywords = config?.keywords ?? []
  // Keep a local draft string so the comma and trailing space aren't
  // stripped on every keystroke (which made multi-word, comma-separated
  // entry like "SEO, search engine optimization" impossible to type).
  // We only parse into the keywords array on blur, then re-display the
  // cleaned, rejoined form. Seeded once on mount; this component remounts
  // when the trigger type changes, so the seed stays in sync.
  const [draft, setDraft] = useState(keywords.join(", "))

  // Persist the default the <select> displays. The dropdown falls back to
  // "contains" for display, but leaving it untouched would otherwise omit
  // match_type from the saved config — and activation validation then
  // rejected it (trigger.match_type). Seed once on mount; the component
  // remounts when the trigger type changes, matching the keywords draft.
  useEffect(() => {
    if (config?.match_type == null) {
      onChange({ ...config, match_type: "contains" })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function commit() {
    const parsed = draft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    setDraft(parsed.join(", "))
    onChange({ ...config, keywords: parsed })
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("keywords")}
        </label>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
            }
          }}
          placeholder={t("keywordsHint")}
          className="bg-muted text-foreground"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("config.matchType")}
        </label>
        <select
          value={config?.match_type ?? "contains"}
          onChange={(e) => onChange({ ...config, match_type: e.target.value as "exact" | "contains" })}
          className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:outline-none"
        >
          <option value="contains">{t("config.matchContains")}</option>
          <option value="exact">{t("config.matchExact")}</option>
        </select>
      </div>
    </div>
  )
}

function InteractiveReplyConfig({
  config,
  onChange,
  t,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
  t: ReturnType<typeof useTranslations>
}) {
  const ids = (config?.reply_ids as string[] | undefined) ?? []
  // Same local-draft-then-commit pattern as KeywordMatchConfig so
  // commas + spaces survive keystrokes.
  const [draft, setDraft] = useState(ids.join(", "))

  function commit() {
    const parsed = draft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    setDraft(parsed.join(", "))
    onChange({ ...config, reply_ids: parsed })
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {t("replyIds")}
      </label>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          }
        }}
        placeholder={t("replyIdsHint")}
        className="bg-muted font-mono text-foreground"
      />
      <p className="mt-1 text-[11px] text-muted-foreground">{t("replyIdsHelp")}</p>
    </div>
  )
}

// ------------------------------------------------------------
// Canvas (React Flow): draggable nodes, pan/zoom, auto-arrange.
//
// The tree in `state.steps` stays the source of truth — nodes and edges
// are derived from it on every render (src/lib/automations/canvas.ts),
// and the only thing the canvas writes back is each node's position.
// ------------------------------------------------------------

interface AutoNodeData extends Record<string, unknown> {
  isTrigger: boolean
  isCondition: boolean
  category: string
  title: string
  preview: string
  icon: typeof Zap
  accent: string
  yesLabel: string
  noLabel: string
  /** Insert after this node (or at the start, for the trigger). */
  onAdd?: (type: AutomationStepType) => void
  onAddYes?: (type: AutomationStepType) => void
  onAddNo?: (type: AutomationStepType) => void
}

type AutoRfNode = RfNode<AutoNodeData, "auto">

const NODE_TYPES = { auto: AutomationNodeCard }

function AutomationCanvas({
  state,
  selectedId,
  onSelect,
  onPositions,
  addStepAt,
}: {
  state: BuilderInitial
  selectedId: string | null
  onSelect: (id: string) => void
  onPositions: (positions: Map<string, CanvasPos>) => void
  addStepAt: (parent: ParentScope, index: number, type: AutomationStepType) => void
}) {
  const t = useTranslations("Automations.builder")
  const { nodes, edges } = useMemo(() => flattenSteps(state.steps), [state.steps])
  const resolved = useMemo(
    () => resolvePositions(nodes, edges, state.trigger_position),
    [nodes, edges, state.trigger_position],
  )

  // Write generated positions (first open, or a newly added node) back to
  // state so they are saved and a later drag doesn't snap anything back.
  // Once written, resolvePositions finds them all placed and stops.
  useEffect(() => {
    if (resolved.generated) onPositions(resolved.positions)
  }, [resolved, onPositions])

  const derivedNodes = useMemo<AutoRfNode[]>(() => {
    const yesLabel = t("branches.yes")
    const noLabel = t("branches.no")
    const trigger: AutoRfNode = {
      id: TRIGGER_NODE_ID,
      type: "auto",
      position: resolved.positions.get(TRIGGER_NODE_ID) ?? { x: 0, y: 0 },
      selected: selectedId === TRIGGER_NODE_ID,
      data: {
        isTrigger: true,
        isCondition: false,
        category: t("trigger"),
        title: t(`triggers.${state.trigger_type}.label`),
        preview: "",
        icon: Zap,
        accent: "border-l-blue-500",
        yesLabel,
        noLabel,
        onAdd: (tp) => addStepAt({ kind: "root" }, 0, tp),
      },
    }
    const steps = nodes.map<AutoRfNode>((n) => {
      const meta = STEP_META[n.step.step_type as AutomationStepType]
      const isCondition = n.step.step_type === "condition"
      return {
        id: n.id,
        type: "auto",
        position: resolved.positions.get(n.id) ?? { x: 0, y: 0 },
        selected: selectedId === n.id,
        data: {
          isTrigger: false,
          isCondition,
          category: isCondition
            ? "Condição"
            : n.step.step_type === "wait"
              ? "Espera"
              : "Ação",
          title: t(`steps.${meta.label}`),
          preview: previewFor(n.step as BuilderStep),
          icon: meta.icon,
          accent: meta.border,
          yesLabel,
          noLabel,
          onAdd: isCondition
            ? undefined
            : (tp) => addStepAt(n.scope, n.index + 1, tp),
          onAddYes: isCondition
            ? (tp) => addStepAt({ kind: "branch", parentCid: n.id, branch: "yes" }, 0, tp)
            : undefined,
          onAddNo: isCondition
            ? (tp) => addStepAt({ kind: "branch", parentCid: n.id, branch: "no" }, 0, tp)
            : undefined,
        },
      }
    })
    return [trigger, ...steps]
  }, [nodes, resolved, selectedId, state.trigger_type, t, addStepAt])

  // React Flow needs to own node positions while a drag is in flight;
  // the committed position goes back to the tree on drag stop.
  const [rfNodes, setRfNodes] = useState<AutoRfNode[]>(derivedNodes)
  useEffect(() => {
    setRfNodes(derivedNodes)
  }, [derivedNodes])

  const rfEdges = useMemo<RfEdge[]>(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        type: "smoothstep",
        label:
          e.sourceHandle === "yes"
            ? t("branches.yes")
            : e.sourceHandle === "no"
              ? t("branches.no")
              : undefined,
        labelStyle: { fill: "var(--muted-foreground)", fontSize: 11 },
        labelBgStyle: { fill: "var(--card)" },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
        style: { stroke: "var(--border)", strokeWidth: 1.5 },
      })),
    [edges, t],
  )

  const handleNodesChange = useCallback((changes: NodeChange<AutoRfNode>[]) => {
    setRfNodes((cur) => applyNodeChanges(changes, cur))
  }, [])

  const handleDragStop = useCallback<OnNodeDrag<AutoRfNode>>(
    (_e, node) => {
      onPositions(new Map([[node.id, node.position]]))
    },
    [onPositions],
  )

  function arrange() {
    onPositions(layoutAll(nodes, edges))
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={NODE_TYPES}
        onNodesChange={handleNodesChange}
        onNodeDragStop={handleDragStop}
        onNodeClick={(_e, node) => onSelect(node.id)}
        nodesConnectable={false}
        // The tree is edited through the sheet and the "+" buttons, not
        // by keyboard-deleting canvas elements.
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--border)" />
        <Controls
          className="!border-border !bg-card [&_button]:!border-border [&_button]:!bg-card [&_button:hover]:!bg-muted [&_button_svg]:!fill-foreground !overflow-hidden !rounded-xl !border !shadow-[0_6px_20px_-8px_rgba(0,0,0,0.5)]"
          showInteractive={false}
        />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) =>
            (n.data as AutoNodeData).isTrigger
              ? "#3b82f6"
              : (n.data as AutoNodeData).isCondition
                ? "#f59e0b"
                : "#7c3aed"
          }
          nodeStrokeWidth={0}
          nodeBorderRadius={3}
          maskColor="color-mix(in oklch, var(--background) 70%, transparent)"
          className="!border-border !bg-card !rounded-xl !border !shadow-[0_6px_20px_-8px_rgba(0,0,0,0.5)]"
        />
        <Panel position="top-left" className="!top-4 !left-4">
          <Button variant="outline" size="sm" onClick={arrange} className="bg-card">
            <LayoutGrid className="h-4 w-4" />
            {t("arrange")}
          </Button>
        </Panel>
      </ReactFlow>
    </div>
  )
}

function AutomationNodeCard({ data, selected }: NodeProps<AutoRfNode>) {
  const Icon = data.icon
  const size = nodeSize(data.isTrigger ? null : data.isCondition ? "condition" : "step")
  return (
    <div style={{ width: size.width }} className="relative">
      {!data.isTrigger && (
        <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-border" />
      )}
      <div
        style={{ minHeight: size.height }}
        className={cn(
          "flex items-center gap-3 rounded-lg border border-border border-l-4 bg-card px-4 py-3 shadow-lg transition-shadow",
          data.accent,
          selected && "ring-2 ring-primary/60",
        )}
      >
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
            data.isTrigger ? "bg-blue-500/10 text-blue-400" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "text-[11px] uppercase tracking-wide",
              data.isTrigger ? "text-blue-300" : "text-muted-foreground",
            )}
          >
            {data.category}
          </div>
          <div className="truncate text-sm font-medium text-foreground">{data.title}</div>
          {data.preview && (
            <div className="truncate text-[11px] text-muted-foreground">{data.preview}</div>
          )}
        </div>
      </div>

      {data.isCondition ? (
        <>
          <Handle
            id="yes"
            type="source"
            position={Position.Bottom}
            style={{ left: "25%" }}
            className="!h-2 !w-2 !border-0 !bg-primary"
          />
          <Handle
            id="no"
            type="source"
            position={Position.Bottom}
            style={{ left: "75%" }}
            className="!h-2 !w-2 !border-0 !bg-rose-400"
          />
          <div className="absolute -bottom-5 left-[25%] -translate-x-1/2">
            <NodeAddButton onPick={data.onAddYes!} label={data.yesLabel} tone="yes" />
          </div>
          <div className="absolute -bottom-5 left-[75%] -translate-x-1/2">
            <NodeAddButton onPick={data.onAddNo!} label={data.noLabel} tone="no" />
          </div>
        </>
      ) : (
        <>
          <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-border" />
          {data.onAdd && (
            <div className="absolute -bottom-5 left-1/2 -translate-x-1/2">
              <NodeAddButton onPick={data.onAdd} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function NodeAddButton({
  onPick,
  label,
  tone,
}: {
  onPick: (t: AutomationStepType) => void
  label?: string
  tone?: "yes" | "no"
}) {
  const t = useTranslations("Automations.builder")
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        // nodrag/nopan: let the click reach the menu instead of starting a
        // canvas drag; stopPropagation keeps it from also opening the
        // node's editor sheet.
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "nodrag nopan flex h-6 items-center justify-center gap-1 rounded-full border border-dashed border-border bg-background px-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary data-[popup-open]:border-primary data-[popup-open]:text-primary",
          tone === "yes" && "text-primary",
          tone === "no" && "text-rose-400",
        )}
        aria-label={label ? `${t("addStep")} (${label})` : t("addStep")}
      >
        <Plus className="h-3.5 w-3.5" />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="max-h-80 min-w-56 overflow-y-auto border-border bg-popover">
        {ADDABLE_STEPS.map((tp) => {
          const Icon = STEP_META[tp].icon
          return (
            <DropdownMenuItem key={tp} onClick={() => onPick(tp)}>
              <Icon className="h-4 w-4" />
              {t(`steps.${STEP_META[tp].label}`)}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function NodeSheet({
  state,
  selectedId,
  onClose,
  onTriggerTypeChange,
  onTriggerConfigChange,
  updateStep,
  deleteStepAt,
  moveStepAt,
}: {
  state: BuilderInitial
  selectedId: string | null
  onClose: () => void
  onTriggerTypeChange: (t: AutomationTriggerType) => void
  onTriggerConfigChange: (c: Record<string, unknown>) => void
  updateStep: (path: StepPath, updater: (s: BuilderStep) => BuilderStep) => void
  deleteStepAt: (path: StepPath) => void
  moveStepAt: (path: StepPath, direction: -1 | 1) => void
}) {
  const t = useTranslations("Automations.builder")
  const isTrigger = selectedId === TRIGGER_NODE_ID
  const info = useMemo(
    () =>
      selectedId && !isTrigger
        ? flattenSteps(state.steps).nodes.find((n) => n.id === selectedId) ?? null
        : null,
    [selectedId, isTrigger, state.steps],
  )
  const open = isTrigger || !!info

  // Sibling count for enabling the move buttons.
  const siblings = info
    ? info.scope.kind === "root"
      ? state.steps.length
      : flattenSteps(state.steps).nodes.find((n) => n.id === (info.scope as { parentCid: string }).parentCid)
          ?.step.branches?.[(info.scope as { branch: "yes" | "no" }).branch].length ?? 0
    : 0

  const step = info?.step as BuilderStep | undefined
  const meta = step ? STEP_META[step.step_type] : null

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="border-border bg-popover flex w-full flex-col gap-0 border-l p-0 sm:max-w-md"
      >
        <SheetHeader className="border-border border-b px-5 py-4">
          <SheetTitle className="text-sm font-semibold">
            {isTrigger ? t("trigger") : meta ? t(`steps.${meta.label}`) : ""}
          </SheetTitle>
          <SheetDescription className="text-muted-foreground text-xs">
            {isTrigger ? t(`triggers.${state.trigger_type}.hint`) : step ? previewFor(step) : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          {isTrigger ? (
            <TriggerEditor
              type={state.trigger_type}
              config={state.trigger_config}
              onTypeChange={onTriggerTypeChange}
              onConfigChange={onTriggerConfigChange}
              t={t}
            />
          ) : info && step ? (
            <StepEditor step={step} onChange={(next) => updateStep(info.path, () => next)} />
          ) : null}
        </div>

        {info && (
          <div className="border-border flex items-center justify-between gap-2 border-t px-5 py-3">
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                disabled={info.index === 0}
                aria-label="Mover para cima"
                onClick={() => moveStepAt(info.path, -1)}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={info.index >= siblings - 1}
                aria-label="Mover para baixo"
                onClick={() => moveStepAt(info.path, 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="destructive" size="sm" onClick={() => deleteStepAt(info.path)}>
              <Trash2 className="h-3.5 w-3.5" />
              {t("delete")}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ------------------------------------------------------------
// Per-step config editor
// ------------------------------------------------------------

function StepEditor({
  step,
  onChange,
}: {
  step: BuilderStep
  onChange: (s: BuilderStep) => void
}) {
  const t = useTranslations("Automations.builder")
  const cfg = step.step_config
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...step, step_config: { ...cfg, ...patch } })

  switch (step.step_type) {
    case "send_message":
      return (
        <FieldBlock label={t("config.messageText")}>
          <Textarea
            value={(cfg.text as string) ?? ""}
            onChange={(e) => set({ text: e.target.value })}
            placeholder={t("config.placeholderMessageText")}
            className="min-h-24 bg-muted text-foreground"
          />
        </FieldBlock>
      )
    case "send_buttons":
    case "send_list":
      // The whole step_config IS the interactive payload; the shared
      // builder edits it in place (and enforces Meta's limits + preview).
      return (
        <InteractiveBuilder
          value={asInteractive(cfg)}
          onChange={(payload) =>
            onChange({ ...step, step_config: toStepConfig(payload) })
          }
        />
      )
    case "send_template":
      return (
        <SendTemplateFields
          templateName={(cfg.template_name as string) ?? ""}
          language={(cfg.language as string) ?? ""}
          onChange={(patch) => set(patch)}
          t={t}
        />
      )
    case "add_tag":
    case "remove_tag":
      return (
        <FieldBlock label={t("config.tagLabel")}>
          <TagSelect
            value={(cfg.tag_id as string) ?? ""}
            onChange={(v) => set({ tag_id: v })}
            t={t}
          />
        </FieldBlock>
      )
    case "assign_conversation":
      return (
        <>
          <FieldBlock label={t("config.modeLabel")}>
            <select
              value={(cfg.mode as string) ?? "round_robin"}
              onChange={(e) => set({ mode: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="round_robin">{t("config.modes.round_robin")}</option>
              <option value="specific">{t("config.modes.specific")}</option>
            </select>
          </FieldBlock>
          {cfg.mode === "specific" && (
            <FieldBlock label={t("config.agentLabel")}>
              <AgentSelect
                value={(cfg.agent_id as string) ?? ""}
                onChange={(v) => set({ agent_id: v })}
                t={t}
              />
            </FieldBlock>
          )}
        </>
      )
    case "update_contact_field":
      return (
        <>
          <FieldBlock label={t("config.fieldLabel")}>
            <ContactFieldSelect
              value={(cfg.field as string) ?? "name"}
              onChange={(v) => set({ field: v })}
              t={t}
            />
          </FieldBlock>
          <FieldBlock label={t("config.valueLabel")}>
            <Input
              value={(cfg.value as string) ?? ""}
              onChange={(e) => set({ value: e.target.value })}
              placeholder={t("config.placeholderValue")}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
        </>
      )
    case "create_deal":
      return (
        <>
          <DealPipelineFields
            pipelineId={(cfg.pipeline_id as string) ?? ""}
            stageId={(cfg.stage_id as string) ?? ""}
            onChange={(patch) => set(patch)}
            t={t}
          />
          <FieldBlock label={t("config.titleLabel")}>
            <Input
              value={(cfg.title as string) ?? ""}
              onChange={(e) => set({ title: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("config.valueLabel")}>
            <Input
              type="number"
              value={(cfg.value as number) ?? 0}
              onChange={(e) => set({ value: Number(e.target.value) })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
        </>
      )
    case "wait":
      return (
        <div className="grid grid-cols-2 gap-2">
          <FieldBlock label={t("config.amountLabel")}>
            <Input
              type="number"
              min={1}
              value={(cfg.amount as number) ?? 1}
              onChange={(e) => set({ amount: Math.max(1, Number(e.target.value)) })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("config.unitLabel")}>
            <select
              value={(cfg.unit as string) ?? "hours"}
              onChange={(e) => set({ unit: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="minutes">{t("config.units.minutes")}</option>
              <option value="hours">{t("config.units.hours")}</option>
              <option value="days">{t("config.units.days")}</option>
            </select>
          </FieldBlock>
        </div>
      )
    case "condition":
      return (
        <>
          <FieldBlock label={t("config.subjectLabel")}>
            <select
              value={(cfg.subject as string) ?? "tag_presence"}
              onChange={(e) => set({ subject: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="tag_presence">{t("config.subjects.tag_presence")}</option>
              <option value="contact_field">{t("config.subjects.contact_field")}</option>
              <option value="message_content">{t("config.subjects.message_content")}</option>
              <option value="time_of_day">{t("config.subjects.time_of_day")}</option>
            </select>
          </FieldBlock>
          {/* The engine reads `operand` differently per subject (a tag id,
              a contact column, an "HH:mm-HH:mm" window) and ignores it
              for message_content, which only matches on `value`. */}
          {(cfg.subject ?? "tag_presence") === "tag_presence" && (
            <FieldBlock label={t("config.tagLabel")}>
              <TagSelect
                value={(cfg.operand as string) ?? ""}
                onChange={(v) => set({ operand: v })}
                t={t}
              />
            </FieldBlock>
          )}
          {(cfg.subject === "contact_field" || cfg.subject === "time_of_day") && (
            <FieldBlock label={t("config.operandLabel")}>
              <Input
                placeholder={
                  cfg.subject === "time_of_day"
                    ? t("config.placeholderTime")
                    : t("config.placeholderContact")
                }
                value={(cfg.operand as string) ?? ""}
                onChange={(e) => set({ operand: e.target.value })}
                className="bg-muted text-foreground"
              />
            </FieldBlock>
          )}
          {cfg.subject === "contact_field" && (
            <FieldBlock label={t("config.valueLabel")}>
              <Input
                value={(cfg.value as string) ?? ""}
                onChange={(e) => set({ value: e.target.value })}
                className="bg-muted text-foreground"
              />
            </FieldBlock>
          )}
          {cfg.subject === "message_content" && (
            <FieldBlock label={t("config.containsLabel")}>
              <Input
                value={(cfg.value as string) ?? ""}
                onChange={(e) => set({ value: e.target.value })}
                placeholder={t("config.containsPlaceholder")}
                className="bg-muted text-foreground"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("config.containsHint")}
              </p>
            </FieldBlock>
          )}
        </>
      )
    case "send_webhook":
      return (
        <>
          <FieldBlock label={t("config.urlLabel")}>
            <Input
              value={(cfg.url as string) ?? ""}
              onChange={(e) => set({ url: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("config.bodyTemplateLabel")}>
            <Textarea
              value={(cfg.body_template as string) ?? ""}
              onChange={(e) => set({ body_template: e.target.value })}
              className="min-h-20 bg-muted font-mono text-xs text-foreground"
            />
          </FieldBlock>
        </>
      )
    case "close_conversation":
      return (
        <p className="text-xs text-muted-foreground">
          {t("config.closeConversationHint", { defaultValue: "Define o status da conversa como \"fechada\". Nenhuma configuração é necessária." })}
        </p>
      )
    default:
      return null
  }
}

function FieldBlock({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-2 last:mb-0">
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

function previewFor(step: BuilderStep): string {
  switch (step.step_type) {
    case "send_message":
      return (step.step_config.text as string) || "nenhum texto ainda"
    case "send_buttons":
    case "send_list":
      return interactivePayloadPreviewText(asInteractive(step.step_config)) || "nenhum conteúdo ainda"
    case "send_template":
      return (step.step_config.template_name as string) || "pick a template"
    case "wait":
      return `${step.step_config.amount ?? "?"} ${step.step_config.unit ?? ""}`
    case "condition":
      return `when ${step.step_config.subject ?? "?"}`
    case "send_webhook":
      return (step.step_config.url as string) || "nenhuma URL"
    default:
      return ""
  }
}

// ------------------------------------------------------------
// Tree mutation helpers
// ------------------------------------------------------------

function insertAt(
  steps: BuilderStep[],
  parent: ParentScope,
  index: number,
  node: BuilderStep,
): BuilderStep[] {
  if (parent.kind === "root") {
    const copy = [...steps]
    copy.splice(index, 0, node)
    return copy
  }
  // The target condition may itself sit inside a branch, so search the
  // whole tree rather than only the top level.
  return steps.map((s) => {
    if (!s.branches) return s
    if (s.cid !== parent.parentCid) {
      return {
        ...s,
        branches: {
          yes: insertAt(s.branches.yes, parent, index, node),
          no: insertAt(s.branches.no, parent, index, node),
        },
      }
    }
    const list = [...s.branches[parent.branch]]
    list.splice(index, 0, node)
    return { ...s, branches: { ...s.branches, [parent.branch]: list } }
  })
}

function mapAtPath(
  steps: BuilderStep[],
  path: StepPath,
  updater: (s: BuilderStep) => BuilderStep,
): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)

  if (head.kind === "root") {
    return steps.map((s, i) => {
      if (i !== head.index) return s
      return rest.length === 0
        ? updater(s)
        : { ...s, branches: walkBranches(s.branches, rest, updater) }
    })
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const updated = bucket.map((child, i) => {
      if (i !== head.index) return child
      return rest.length === 0
        ? updater(child)
        : { ...child, branches: walkBranches(child.branches, rest, updater) }
    })
    return { ...s, branches: { ...s.branches, [head.branch]: updated } }
  })
}

function walkBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
  updater: (s: BuilderStep) => BuilderStep,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const bucket = branches[head.branch]
  const rest = path.slice(1)
  const updated = bucket.map((child, i) => {
    if (i !== head.index) return child
    return rest.length === 0
      ? updater(child)
      : { ...child, branches: walkBranches(child.branches, rest, updater) }
  })
  return { ...branches, [head.branch]: updated }
}

function removeAt(steps: BuilderStep[], path: StepPath): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)
  if (head.kind === "root") {
    if (rest.length === 0) return steps.filter((_, i) => i !== head.index)
    return steps.map((s, i) =>
      i !== head.index ? s : { ...s, branches: removeFromBranches(s.branches, rest) },
    )
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const next =
      rest.length === 0
        ? bucket.filter((_, i) => i !== head.index)
        : bucket.map((child, i) =>
            i !== head.index
              ? child
              : { ...child, branches: removeFromBranches(child.branches, rest) },
          )
    return { ...s, branches: { ...s.branches, [head.branch]: next } }
  })
}

function removeFromBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const rest = path.slice(1)
  const bucket = branches[head.branch]
  const next =
    rest.length === 0
      ? bucket.filter((_, i) => i !== head.index)
      : bucket.map((child, i) =>
          i !== head.index
            ? child
            : { ...child, branches: removeFromBranches(child.branches, rest) },
        )
  return { ...branches, [head.branch]: next }
}

function moveAt(
  steps: BuilderStep[],
  path: StepPath,
  direction: -1 | 1,
): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)
  const swap = <T,>(arr: T[], i: number) => {
    const j = i + direction
    if (j < 0 || j >= arr.length) return arr
    const copy = [...arr]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    return copy
  }
  if (head.kind === "root") {
    if (rest.length === 0) return swap(steps, head.index)
    return steps.map((s, i) =>
      i !== head.index ? s : { ...s, branches: moveInBranches(s.branches, rest, direction) },
    )
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const next = rest.length === 0 ? swap(bucket, head.index) : bucket
    return { ...s, branches: { ...s.branches, [head.branch]: next } }
  })
}

function moveInBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
  direction: -1 | 1,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const rest = path.slice(1)
  const bucket = branches[head.branch]
  const swap = <T,>(arr: T[], i: number) => {
    const j = i + direction
    if (j < 0 || j >= arr.length) return arr
    const copy = [...arr]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    return copy
  }
  const next = rest.length === 0 ? swap(bucket, head.index) : bucket
  return { ...branches, [head.branch]: next }
}

// ------------------------------------------------------------
// Serialize builder tree → API payload (flattened shape)
// ------------------------------------------------------------

interface ApiStep {
  step_type: string
  step_config: Record<string, unknown>
  position_x?: number | null
  position_y?: number | null
  branches?: { yes?: ApiStep[]; no?: ApiStep[] }
}

export function toApiSteps(steps: BuilderStep[]): ApiStep[] {
  return steps.map((s) => ({
    step_type: s.step_type,
    step_config: s.step_config,
    position_x: s.pos ? Math.round(s.pos.x) : null,
    position_y: s.pos ? Math.round(s.pos.y) : null,
    branches: s.branches
      ? { yes: toApiSteps(s.branches.yes), no: toApiSteps(s.branches.no) }
      : undefined,
  }))
}

/**
 * Convert server-returned step tree (from loadStepsTree) into the
 * builder-local shape with client ids.
 */
export interface ServerStepNode {
  id: string
  step_type: string
  step_config: Record<string, unknown>
  position_x?: number | null
  position_y?: number | null
  branches: { yes: ServerStepNode[]; no: ServerStepNode[] }
}

export function fromServerSteps(nodes: ServerStepNode[]): BuilderStep[] {
  return nodes.map((n) => ({
    cid: cid(),
    step_type: n.step_type as AutomationStepType,
    step_config: n.step_config ?? {},
    pos:
      n.position_x != null && n.position_y != null
        ? { x: n.position_x, y: n.position_y }
        : null,
    branches:
      n.step_type === "condition"
        ? {
            yes: fromServerSteps(n.branches?.yes ?? []),
            no: fromServerSteps(n.branches?.no ?? []),
          }
        : undefined,
  }))
}
