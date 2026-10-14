"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Music,
  Paperclip,
  Square,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
  uploadAccountMedia,
} from "@/lib/storage/upload-media";
import { CHAT_MEDIA_BUCKET } from "./message-composer";

type MediaKind = "image" | "video" | "audio" | "document";

interface Attachment {
  kind: MediaKind;
  mediaUrl: string;
  path: string;
  filename: string;
}

export interface ScheduledItem {
  id: string;
  group_id: string;
  position: number;
  message_type: "text" | MediaKind;
  content_text: string | null;
  filename: string | null;
  send_at: string;
  status: "pending" | "sending" | "sent" | "failed" | "canceled";
  error_message: string | null;
}

/** Everything the chat-media bucket accepts (migrations 023 + 084). */
const ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "video/3gpp",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/amr",
  "audio/x-m4a",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
].join(",");

const OPUS_ENCODER_PATH = "/opus/encoderWorker.min.js";
const MAX_RECORDING_SECONDS = 5 * 60;

function kindOf(mime: string): MediaKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

const KIND_ICON = { image: ImageIcon, video: Video, audio: Music, document: FileText };
const KIND_LABEL = { text: "Texto", image: "Imagem", video: "Vídeo", audio: "Áudio", document: "Arquivo" };

const pad = (n: number) => String(n).padStart(2, "0");
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Next round 5 minutes, at least `minutes` from now. */
function inMinutes(minutes: number): Date {
  const d = new Date(Date.now() + minutes * 60_000);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
  return d;
}
function tomorrowAt(hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Hoje às ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Amanhã às ${time}`;
  return `${d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })} às ${time}`;
}

/** Strips the "*Name:*\n" signature the server adds, for display. */
function displayText(text: string | null): string {
  return (text ?? "").replace(/^\*[^*\n]+:\*\n/, "");
}

/**
 * Scheduled messages of a conversation. Polls once a minute while any is
 * pending so a sent schedule leaves the list on its own.
 */
export function useScheduledMessages(conversationId: string | null) {
  // Tagged with the conversation it belongs to, so switching threads never
  // shows the previous thread's schedules while the new list loads.
  const [loaded, setLoaded] = useState<{ conversationId: string; items: ScheduledItem[] } | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!conversationId) return;
    let alive = true;
    fetch(`/api/scheduled-messages?conversation_id=${conversationId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (alive && data) setLoaded({ conversationId, items: data.items ?? [] });
      })
      // Offline or table not migrated yet — the list just stays empty.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [conversationId, nonce]);

  const items = loaded && loaded.conversationId === conversationId ? loaded.items : [];
  const hasPending = items.some((i) => i.status === "pending" || i.status === "sending");
  useEffect(() => {
    if (!hasPending) return;
    const id = setInterval(reload, 60_000);
    return () => clearInterval(id);
  }, [hasPending, reload]);

  const pendingCount = new Set(
    items.filter((i) => i.status === "pending").map((i) => i.group_id)
  ).size;
  return { items, reload, pendingCount };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  contactName: string;
  items: ScheduledItem[];
  onChanged: () => void;
}

export function ScheduleMessageDialog({
  open,
  onOpenChange,
  conversationId,
  contactName,
  items,
  onChanged,
}: Props) {
  const initial = inMinutes(60);
  const [date, setDate] = useState(toDateInput(initial));
  const [time, setTime] = useState(toTimeInput(initial));
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const savedRef = useRef(false);
  const attachmentsRef = useRef<Attachment[]>([]);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const setWhen = (d: Date) => {
    setDate(toDateInput(d));
    setTime(toTimeInput(d));
  };

  const reset = useCallback(() => {
    const d = inMinutes(60);
    setDate(toDateInput(d));
    setTime(toTimeInput(d));
    setText("");
    setAttachments([]);
  }, []);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  // Closing without scheduling: drop the uploads nobody will send.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      if (recording) {
        cancelledRef.current = true;
        clearTimer();
        setRecording(false);
        void recorderRef.current?.stop().catch(() => {});
      }
      if (!savedRef.current) {
        for (const a of attachmentsRef.current) {
          void deleteAccountMedia(CHAT_MEDIA_BUCKET, a.path).catch(() => {});
        }
      }
      savedRef.current = false;
      reset();
    }
    onOpenChange(next);
  };

  const addFile = useCallback(async (file: File, kindOverride?: MediaKind) => {
    const kind = kindOverride ?? kindOf(file.type);
    if (file.size > MEDIA_MAX_BYTES_BY_KIND[kind]) {
      toast.error(
        `${file.name}: ${(file.size / 1024 / 1024).toFixed(1)} MB passa do limite de ${Math.round(
          MEDIA_MAX_BYTES_BY_KIND[kind] / 1024 / 1024
        )} MB para ${KIND_LABEL[kind].toLowerCase()}.`
      );
      return;
    }
    setUploading(true);
    try {
      const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
      setAttachments((prev) => [...prev, { kind, mediaUrl: publicUrl, path, filename: file.name }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha no envio do arquivo.");
    } finally {
      setUploading(false);
    }
  }, []);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) await addFile(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => {
      const gone = prev[index];
      if (gone) void deleteAccountMedia(CHAT_MEDIA_BUCKET, gone.path).catch(() => {});
      return prev.filter((_, i) => i !== index);
    });
  };

  // Same client-side Ogg/Opus recorder as the composer: WhatsApp plays it
  // as a voice note.
  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      toast.error("Este navegador não oferece suporte à gravação de voz.");
      return;
    }
    try {
      const { default: Recorder } = await import("opus-recorder");
      const recorder = new Recorder({
        encoderPath: OPUS_ENCODER_PATH,
        numberOfChannels: 1,
        encoderApplication: 2048,
        encoderSampleRate: 48000,
        streamPages: false,
      });
      cancelledRef.current = false;
      recorder.ondataavailable = (bytes) => {
        if (cancelledRef.current) return;
        const file = new File([bytes as unknown as BlobPart], `audio-${Date.now()}.ogg`, {
          type: "audio/ogg",
        });
        if (file.size > 0) void addFile(file, "audio");
      };
      recorderRef.current = recorder;
      await recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      toast.error("O acesso ao microfone foi negado ou está indisponível.");
    }
  };

  const stopRecording = useCallback(() => {
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, []);

  useEffect(() => {
    if (recording && recordSeconds >= MAX_RECORDING_SECONDS) stopRecording();
  }, [recording, recordSeconds, stopRecording]);

  useEffect(() => () => clearTimer(), []);

  const sendAt = new Date(`${date}T${time}`);
  const validWhen = !Number.isNaN(sendAt.getTime()) && sendAt.getTime() > Date.now() + 30_000;
  const canSave = validWhen && (text.trim() || attachments.length > 0) && !uploading && !recording && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = [
        ...(text.trim() ? [{ message_type: "text", content_text: text.trim() }] : []),
        ...attachments.map((a) => ({
          message_type: a.kind,
          media_url: a.mediaUrl,
          media_path: a.path,
          filename: a.filename,
        })),
      ];
      const res = await fetch("/api/scheduled-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          send_at: sendAt.toISOString(),
          items: payload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || "Não foi possível agendar.");
        return;
      }
      toast.success(`Mensagem agendada para ${formatWhen(sendAt.toISOString()).toLowerCase()}.`);
      savedRef.current = true;
      onChanged();
      handleOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const cancelGroup = async (groupId: string) => {
    const res = await fetch(`/api/scheduled-messages/${groupId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) toast.error(data?.error || "Não foi possível cancelar.");
    else toast.success("Agendamento cancelado.");
    onChanged();
  };

  // One entry per schedule still to go, plus failures from the last week
  // so the agent can see what didn't go out and redo it.
  const failedSince = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const groups = Array.from(
    items
      .filter(
        (i) =>
          i.status === "pending" ||
          i.status === "sending" ||
          (i.status === "failed" && i.send_at >= failedSince)
      )
      .reduce((map, item) => {
        const list = map.get(item.group_id) ?? [];
        list.push(item);
        return map.set(item.group_id, list);
      }, new Map<string, ScheduledItem[]>())
      .values()
  ).sort((a, b) => a[0].send_at.localeCompare(b[0].send_at));

  const quick: [string, () => Date][] = [
    ["Em 1 hora", () => inMinutes(60)],
    ["Em 3 horas", () => inMinutes(180)],
    ["Amanhã 9h", () => tomorrowAt(9)],
    ["Amanhã 14h", () => tomorrowAt(14)],
  ];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            Agendar mensagem
          </DialogTitle>
          <p className="text-muted-foreground text-xs">Para {contactName}</p>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label className="text-muted-foreground text-xs">Quando enviar</Label>
            <div className="flex flex-wrap gap-1.5">
              {quick.map(([label, at]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setWhen(at())}
                  className="border-border text-muted-foreground hover:bg-muted hover:text-foreground rounded-full border px-2.5 py-1 text-xs transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Input
                id="schedule-date"
                type="date"
                value={date}
                min={toDateInput(new Date())}
                onChange={(e) => setDate(e.target.value)}
                className="border-border bg-muted text-foreground text-sm"
                aria-label="Data"
              />
              <Input
                id="schedule-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="border-border bg-muted text-foreground w-28 text-sm"
                aria-label="Horário"
              />
            </div>
            {!validWhen && (
              <p className="text-destructive text-xs">Escolha uma data e horário no futuro.</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="schedule-text" className="text-muted-foreground text-xs">
              Mensagem
            </Label>
            <Textarea
              id="schedule-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Digite a mensagem (opcional se houver anexo)"
              className="border-border bg-muted text-foreground max-h-48 min-h-24 text-sm"
            />
          </div>

          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => void handleFiles(e.target.files)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading || recording}
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip className="mr-1.5 h-3.5 w-3.5" />
                Anexar arquivo
              </Button>
              {recording ? (
                <Button type="button" variant="outline" size="sm" onClick={stopRecording} className="text-destructive">
                  <Square className="mr-1.5 h-3.5 w-3.5 fill-current" />
                  Parar · {Math.floor(recordSeconds / 60)}:{pad(recordSeconds % 60)}
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => void startRecording()}>
                  <Mic className="mr-1.5 h-3.5 w-3.5" />
                  Gravar áudio
                </Button>
              )}
              {uploading && <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />}
            </div>
            {attachments.length > 0 && (
              <ul className="grid gap-1.5">
                {attachments.map((a, i) => {
                  const Icon = KIND_ICON[a.kind];
                  return (
                    <li key={a.path} className="border-border flex items-center gap-2 rounded-md border px-2.5 py-1.5">
                      <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-sm">{a.filename}</span>
                      {a.kind === "audio" && <audio src={a.mediaUrl} controls className="h-7 max-w-40" />}
                      <button
                        type="button"
                        onClick={() => removeAttachment(i)}
                        aria-label={`Remover ${a.filename}`}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-muted-foreground text-[11px]">
              Texto, áudio e arquivos vão na ordem em que aparecem, no horário escolhido.
            </p>
          </div>

          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
            {validWhen ? `Agendar para ${formatWhen(sendAt.toISOString()).toLowerCase()}` : "Agendar"}
          </Button>

          {groups.length > 0 && (
            <div className="border-border grid gap-2 border-t pt-3">
              <p className="text-muted-foreground text-xs font-medium">Agendadas nesta conversa</p>
              <ul className="grid gap-2">
                {groups.map((g) => {
                  const failed = g.some((i) => i.status === "failed");
                  const pending = g.every((i) => i.status === "pending");
                  return (
                    <li
                      key={g[0].group_id}
                      className={cn(
                        "flex items-start gap-2 rounded-md border px-2.5 py-2",
                        failed ? "border-destructive/40 bg-destructive/5" : "border-border"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-xs font-medium", failed ? "text-destructive" : "text-foreground")}>
                          {failed ? "Falhou · " : g[0].status === "sending" ? "Enviando · " : ""}
                          {formatWhen(g[0].send_at)}
                        </p>
                        {g.map((i) => (
                          <p key={i.id} className="text-muted-foreground truncate text-xs">
                            {i.message_type === "text"
                              ? displayText(i.content_text)
                              : `${KIND_LABEL[i.message_type]}: ${i.filename ?? ""}`}
                          </p>
                        ))}
                        {failed && (
                          <p className="text-destructive mt-0.5 text-[11px]">
                            {g.find((i) => i.error_message)?.error_message}
                          </p>
                        )}
                      </div>
                      {pending && (
                        <button
                          type="button"
                          onClick={() => void cancelGroup(g[0].group_id)}
                          aria-label="Cancelar agendamento"
                          title="Cancelar agendamento"
                          className="text-muted-foreground hover:text-destructive shrink-0 p-1"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
