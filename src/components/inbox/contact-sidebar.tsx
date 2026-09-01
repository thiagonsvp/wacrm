"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { Contact, Deal, ContactNote, Tag, PipelineStage } from "@/types";
import { DealForm } from "@/components/pipelines/deal-form";
import {
  Phone,
  Mail,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { useTranslations } from "next-intl";

interface ContactSidebarProps {
  contact: Contact | null;
}

export function ContactSidebar({ contact }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");

  const { accountId } = useAuth();
  const [copied, setCopied] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [dealPickerOpen, setDealPickerOpen] = useState(false);
  const [dealTitle, setDealTitle] = useState("");
  const [addingDeal, setAddingDeal] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [dealStages, setDealStages] = useState<PipelineStage[]>([]);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, and tags in parallel
    const [dealsRes, notesRes, tagsRes, availableTagsRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .eq("account_id", accountId)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
      supabase.from("tags").select("*").order("name"),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
    if (availableTagsRes.data) setAvailableTags(availableTagsRes.data as Tag[]);
  }, [contact, accountId]);

  const handleAddTag = useCallback(async (tag: Tag) => {
    if (!contact) return;
    const supabase = createClient();
    const { data, error } = await supabase.from("contact_tags").insert({ contact_id: contact.id, tag_id: tag.id }).select("id").single();
    if (!error && data) setTags((prev) => [...prev, { ...tag, contact_tag_id: data.id }]);
    setTagPickerOpen(false);
  }, [contact]);

  const handleAddDeal = useCallback(async () => {
    if (!contact || !dealTitle.trim() || !accountId) return;
    setAddingDeal(true);
    const supabase = createClient();
    const [{ data: pipeline }, { data: userData }] = await Promise.all([
      supabase.from("pipelines").select("id").eq("account_id", accountId).order("created_at").limit(1).maybeSingle(),
      supabase.auth.getUser(),
    ]);
    if (!pipeline || !userData.user) { setAddingDeal(false); return; }
    const { data: stage } = await supabase.from("pipeline_stages").select("id").eq("pipeline_id", pipeline.id).order("position").limit(1).maybeSingle();
    if (stage) {
      const { data } = await supabase.from("deals").insert({ user_id: userData.user.id, account_id: accountId, pipeline_id: pipeline.id, stage_id: stage.id, contact_id: contact.id, title: dealTitle.trim(), value: 0, status: "open" }).select("*, stage:pipeline_stages(*)").single();
      if (data) setDeals((prev) => [data as Deal, ...prev]);
    }
    setDealTitle(""); setDealPickerOpen(false); setAddingDeal(false);
  }, [accountId, contact, dealTitle]);

  const openDealEditor = useCallback(async (deal: Deal) => {
    setEditingDeal(deal);
    const supabase = createClient();
    const { data } = await supabase.from("pipeline_stages").select("*").eq("pipeline_id", deal.pipeline_id).order("position");
    setDealStages((data ?? []) as PipelineStage[]);
  }, []);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  if (!contact) {
    return (
      <div className="flex h-full w-full items-center justify-center border-border bg-card lg:w-70 lg:border-l">
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  // Fills the width when opened as a mobile sheet; a fixed rail on
  // desktop. The left border only makes sense beside the thread.
  return (
    <div className="flex h-full w-full flex-col border-border bg-card lg:w-70 lg:border-l">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <button type="button" onClick={() => setPhotoOpen(true)} className="cursor-zoom-in rounded-full" aria-label={`Ampliar foto de ${displayName}`}>
                  <img
                    src={contact.avatar_url}
                    alt={displayName}
                    className="h-16 w-16 rounded-full object-cover"
                  />
                </button>
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
            {contact.acquisition_source && (
              <span className="mt-1 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                Lead via {contact.acquisition_source}
              </span>
            )}
            {contact.acquisition_campaign && (
              <p className="mt-1 max-w-full truncate text-[10px] text-muted-foreground" title={contact.acquisition_campaign}>
                Campanha: {contact.acquisition_campaign}
              </p>
            )}
            {contact.acquisition_ad_text && (
              <p className="mt-1 max-w-full text-[10px] text-muted-foreground">{contact.acquisition_ad_text}</p>
            )}
          </div>

          {photoOpen && contact.avatar_url && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPhotoOpen(false)}>
              <button type="button" onClick={() => setPhotoOpen(false)} className="absolute right-5 top-5 text-2xl text-white" aria-label="Fechar foto">×</button>
              <div className="flex h-[85vh] w-[min(90vw,800px)] items-center justify-center">
                <img src={contact.avatar_url} alt={displayName} className="h-full w-full rounded-lg object-contain" onClick={(event) => event.stopPropagation()} />
              </div>
            </div>
          )}

          {/* Phone */}
          <div className="mt-4 space-y-2">
            {contact.acquisition_source_id && (
              <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Source ID: <span className="font-mono">{contact.acquisition_source_id}</span>
              </div>
            )}
            {contact.acquisition_gclid && (
              <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {/* Google's click id. Wraps because it is long and the
                    operator needs to copy it whole to reconcile a sale
                    in Google Ads. */}
                gclid:{' '}
                <span className="break-all font-mono">{contact.acquisition_gclid}</span>
              </div>
            )}
            {contact.acquisition_url && (
              <a href={contact.acquisition_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-primary hover:underline">
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="truncate">Abrir anúncio/campanha</span>
              </a>
            )}
            {contact.acquisition_ad_image_url && (
              <a href={contact.acquisition_url || contact.acquisition_ad_image_url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border">
                <img src={contact.acquisition_ad_image_url} alt="Criativo do anúncio" className="max-h-48 w-full object-cover" />
              </a>
            )}
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              {tSidebar("tags")}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noTags")}</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
              <button type="button" onClick={() => setTagPickerOpen((open) => !open)} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-primary/20 hover:text-primary">+ adicionar</button>
            </div>
            {tagPickerOpen && (
              <div className="mt-2 rounded-lg border border-border bg-popover p-1 shadow-lg">
                {availableTags.filter((tag) => !tags.some((current) => current.id === tag.id)).map((tag) => (
                  <button key={tag.id} type="button" onClick={() => void handleAddTag(tag)} className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted">{tag.name}</button>
                ))}
                {availableTags.length === tags.length && <p className="px-2 py-1 text-[10px] text-muted-foreground">Nenhuma tag disponível</p>}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              {tSidebar("deals")}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noDeals")}</p>
              ) : (
                deals.map((deal) => (
                  <button
                    type="button"
                    key={deal.id}
                    onClick={() => openDealEditor(deal)}
                    className="block w-full rounded-lg bg-muted px-3 py-2 text-left transition-colors hover:bg-muted/80"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            // A terminal stage name alone is ambiguous: the
                            // deal's outcome is the source of truth. Make a
                            // lost close visibly distinct from a won close.
                            backgroundColor:
                              deal.status === "lost"
                                ? "#ef444420"
                                : deal.status === "won"
                                  ? "#22c55e20"
                                  : `${deal.stage.color}20`,
                            color:
                              deal.status === "lost"
                                ? "#ef4444"
                                : deal.status === "won"
                                  ? "#22c55e"
                                  : deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
            <button type="button" onClick={() => setDealPickerOpen((open) => !open)} className="mt-2 w-full rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground hover:bg-primary/20 hover:text-primary">+ adicionar negócio</button>
            {dealPickerOpen && (
              <div className="mt-2 rounded-lg border border-border bg-popover p-2">
                <input value={dealTitle} onChange={(event) => setDealTitle(event.target.value)} placeholder="Nome do negócio" className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs outline-none" />
                <button type="button" onClick={() => void handleAddDeal()} disabled={addingDeal || !dealTitle.trim()} className="mt-2 w-full rounded bg-primary px-2 py-1.5 text-xs text-primary-foreground disabled:opacity-50">Adicionar</button>
              </div>
            )}
          </div>

          {editingDeal && dealStages.length > 0 && (
            <DealForm
              open
              onOpenChange={(open) => { if (!open) setEditingDeal(null); }}
              deal={editingDeal}
              pipelineId={editingDeal.pipeline_id}
              stages={dealStages}
              onSaved={() => { setEditingDeal(null); void fetchContactData(); }}
            />
          )}

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
