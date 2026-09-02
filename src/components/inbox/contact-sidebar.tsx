'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import type { Contact, Deal, ContactNote, Tag, PipelineStage } from '@/types';
import { DealForm } from '@/components/pipelines/deal-form';
import {
  Phone,
  Mail,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  Banknote,
  StickyNote,
  Plus,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { useTranslations } from 'next-intl';
import { formatCurrency } from '@/lib/currency';

interface ContactSidebarProps {
  contact: Contact | null;
}

export function ContactSidebar({ contact }: ContactSidebarProps) {
  const tSidebar = useTranslations('Inbox.sidebar');
  const tThread = useTranslations('Inbox.messageThread');

  const { accountId } = useAuth();
  const [copied, setCopied] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [dealPickerOpen, setDealPickerOpen] = useState(false);
  const [dealTitle, setDealTitle] = useState('');
  const [addingDeal, setAddingDeal] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [dealStages, setDealStages] = useState<PipelineStage[]>([]);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, and tags in parallel
    const [dealsRes, notesRes, tagsRes, availableTagsRes] = await Promise.all([
      supabase
        .from('deals')
        .select('*, stage:pipeline_stages(*)')
        .eq('contact_id', contact.id)
        .eq('account_id', accountId)
        .order('created_at', { ascending: false }),
      supabase
        .from('contact_notes')
        .select('*')
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('contact_tags')
        .select('id, tag_id, tags(*)')
        .eq('contact_id', contact.id),
      supabase.from('tags').select('*').order('name'),
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

  const handleAddTag = useCallback(
    async (tag: Tag) => {
      if (!contact) return;
      const supabase = createClient();
      const { data, error } = await supabase
        .from('contact_tags')
        .insert({ contact_id: contact.id, tag_id: tag.id })
        .select('id')
        .single();
      if (!error && data)
        setTags((prev) => [...prev, { ...tag, contact_tag_id: data.id }]);
      setTagPickerOpen(false);
    },
    [contact]
  );

  const handleAddDeal = useCallback(async () => {
    if (!contact || !dealTitle.trim() || !accountId) return;
    setAddingDeal(true);
    const supabase = createClient();
    const [{ data: pipeline }, { data: userData }] = await Promise.all([
      supabase
        .from('pipelines')
        .select('id')
        .eq('account_id', accountId)
        .order('created_at')
        .limit(1)
        .maybeSingle(),
      supabase.auth.getUser(),
    ]);
    if (!pipeline || !userData.user) {
      setAddingDeal(false);
      return;
    }
    const { data: stage } = await supabase
      .from('pipeline_stages')
      .select('id')
      .eq('pipeline_id', pipeline.id)
      .order('position')
      .limit(1)
      .maybeSingle();
    if (stage) {
      const { data } = await supabase
        .from('deals')
        .insert({
          user_id: userData.user.id,
          account_id: accountId,
          pipeline_id: pipeline.id,
          stage_id: stage.id,
          contact_id: contact.id,
          title: dealTitle.trim(),
          value: 0,
          status: 'open',
        })
        .select('*, stage:pipeline_stages(*)')
        .single();
      if (data) setDeals((prev) => [data as Deal, ...prev]);
    }
    setDealTitle('');
    setDealPickerOpen(false);
    setAddingDeal(false);
  }, [accountId, contact, dealTitle]);

  const openDealEditor = useCallback(async (deal: Deal) => {
    setEditingDeal(deal);
    const supabase = createClient();
    const { data } = await supabase
      .from('pipeline_stages')
      .select('*')
      .eq('pipeline_id', deal.pipeline_id)
      .order('position');
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
      .from('contact_notes')
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
      setNewNote('');
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  if (!contact) {
    return (
      <div className="border-border bg-card flex h-full w-full items-center justify-center lg:w-70 lg:border-l">
        <p className="text-muted-foreground text-sm">
          {tThread('selectConversation')}
        </p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  // Fills the width when opened as a mobile sheet; a fixed rail on
  // desktop. The left border only makes sense beside the thread.
  return (
    <div className="border-border bg-card flex h-full w-full flex-col lg:w-70 lg:border-l">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="bg-muted text-foreground flex h-16 w-16 items-center justify-center rounded-full text-lg font-semibold">
              {contact.avatar_url ? (
                <button
                  type="button"
                  onClick={() => setPhotoOpen(true)}
                  className="cursor-zoom-in rounded-full"
                  aria-label={`Ampliar foto de ${displayName}`}
                >
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
            <h3 className="text-foreground mt-3 text-sm font-semibold">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-muted-foreground text-xs">{contact.company}</p>
            )}
            {contact.acquisition_source && (
              <span className="bg-primary/10 text-primary mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
                Lead via {contact.acquisition_source}
              </span>
            )}
            {contact.acquisition_campaign && (
              <p
                className="text-muted-foreground mt-1 max-w-full truncate text-[10px]"
                title={contact.acquisition_campaign}
              >
                Campanha: {contact.acquisition_campaign}
              </p>
            )}
            {contact.acquisition_ad_text && (
              <p className="text-muted-foreground mt-1 max-w-full text-[10px]">
                {contact.acquisition_ad_text}
              </p>
            )}
          </div>

          {photoOpen && contact.avatar_url && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
              onClick={() => setPhotoOpen(false)}
            >
              <button
                type="button"
                onClick={() => setPhotoOpen(false)}
                className="absolute top-5 right-5 text-2xl text-white"
                aria-label="Fechar foto"
              >
                ×
              </button>
              <div className="flex h-[85vh] w-[min(90vw,800px)] items-center justify-center">
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-full w-full rounded-lg object-contain"
                  onClick={(event) => event.stopPropagation()}
                />
              </div>
            </div>
          )}

          {/* Phone */}
          <div className="mt-4 space-y-2">
            {contact.acquisition_source_id && (
              <div className="bg-muted/40 text-muted-foreground rounded-lg px-3 py-2 text-xs">
                Source ID:{' '}
                <span className="font-mono">
                  {contact.acquisition_source_id}
                </span>
              </div>
            )}
            {contact.acquisition_gclid && (
              <div className="bg-muted/40 text-muted-foreground rounded-lg px-3 py-2 text-xs">
                {/* Google's click id. Wraps because it is long and the
                    operator needs to copy it whole to reconcile a sale
                    in Google Ads. */}
                gclid:{' '}
                <span className="font-mono break-all">
                  {contact.acquisition_gclid}
                </span>
              </div>
            )}
            {contact.acquisition_url && (
              <a
                href={contact.acquisition_url}
                target="_blank"
                rel="noreferrer"
                className="bg-muted/40 text-primary flex items-center gap-2 rounded-lg px-3 py-2 text-xs hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="truncate">Abrir anúncio/campanha</span>
              </a>
            )}
            {contact.acquisition_ad_image_url && (
              <a
                href={
                  contact.acquisition_url || contact.acquisition_ad_image_url
                }
                target="_blank"
                rel="noreferrer"
                className="border-border block overflow-hidden rounded-lg border"
              >
                <img
                  src={contact.acquisition_ad_image_url}
                  alt="Criativo do anúncio"
                  className="max-h-48 w-full object-cover"
                />
              </a>
            )}
            <button
              onClick={handleCopyPhone}
              className="text-muted-foreground hover:bg-muted flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors"
            >
              <Phone className="text-muted-foreground h-4 w-4" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="text-primary h-3 w-3" />
              ) : (
                <Copy className="text-muted-foreground h-3 w-3" />
              )}
            </button>

            {contact.email && (
              <div className="text-muted-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
                <Mail className="text-muted-foreground h-4 w-4" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Tags */}
          <div>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <TagIcon className="h-3 w-3" />
              {tSidebar('tags')}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="text-muted-foreground px-1 text-xs">
                  {tSidebar('noTags')}
                </p>
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
              <button
                type="button"
                onClick={() => setTagPickerOpen((open) => !open)}
                className="bg-muted text-muted-foreground hover:bg-primary/20 hover:text-primary rounded-full px-2 py-0.5 text-[10px]"
              >
                + adicionar
              </button>
            </div>
            {tagPickerOpen && (
              <div className="border-border bg-popover mt-2 rounded-lg border p-1 shadow-lg">
                {availableTags
                  .filter(
                    (tag) => !tags.some((current) => current.id === tag.id)
                  )
                  .map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => void handleAddTag(tag)}
                      className="hover:bg-muted block w-full rounded px-2 py-1 text-left text-xs"
                    >
                      {tag.name}
                    </button>
                  ))}
                {availableTags.length === tags.length && (
                  <p className="text-muted-foreground px-2 py-1 text-[10px]">
                    Nenhuma tag disponível
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Active Deals */}
          <div>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <Banknote className="h-3 w-3" />
              {tSidebar('deals')}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="text-muted-foreground px-1 text-xs">
                  {tSidebar('noDeals')}
                </p>
              ) : (
                deals.map((deal) => (
                  <button
                    type="button"
                    key={deal.id}
                    onClick={() => openDealEditor(deal)}
                    className="bg-muted hover:bg-muted/80 block w-full rounded-lg px-3 py-2 text-left transition-colors"
                  >
                    <p className="text-foreground text-sm font-medium">
                      {deal.title}
                    </p>
                    <div className="text-muted-foreground mt-1 flex items-center justify-between text-xs">
                      <span>{formatCurrency(deal.value, 'BRL')}</span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            // A terminal stage name alone is ambiguous: the
                            // deal's outcome is the source of truth. Make a
                            // lost close visibly distinct from a won close.
                            backgroundColor:
                              deal.status === 'lost'
                                ? '#ef444420'
                                : deal.status === 'won'
                                  ? '#22c55e20'
                                  : `${deal.stage.color}20`,
                            color:
                              deal.status === 'lost'
                                ? '#ef4444'
                                : deal.status === 'won'
                                  ? '#22c55e'
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
            <button
              type="button"
              onClick={() => setDealPickerOpen((open) => !open)}
              className="bg-muted text-muted-foreground hover:bg-primary/20 hover:text-primary mt-2 w-full rounded-md px-2 py-1.5 text-xs"
            >
              + adicionar negócio
            </button>
            {dealPickerOpen && (
              <div className="border-border bg-popover mt-2 rounded-lg border p-2">
                <input
                  value={dealTitle}
                  onChange={(event) => setDealTitle(event.target.value)}
                  placeholder="Nome do negócio"
                  className="border-border bg-background w-full rounded border px-2 py-1.5 text-xs outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleAddDeal()}
                  disabled={addingDeal || !dealTitle.trim()}
                  className="bg-primary text-primary-foreground mt-2 w-full rounded px-2 py-1.5 text-xs disabled:opacity-50"
                >
                  Adicionar
                </button>
              </div>
            )}
          </div>

          {editingDeal && dealStages.length > 0 && (
            <DealForm
              open
              onOpenChange={(open) => {
                if (!open) setEditingDeal(null);
              }}
              deal={editingDeal}
              pipelineId={editingDeal.pipeline_id}
              stages={dealStages}
              onSaved={() => {
                setEditingDeal(null);
                void fetchContactData();
              }}
            />
          )}

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Notes */}
          <div>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <StickyNote className="h-3 w-3" />
              {tSidebar('notes')}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar('addNotePlaceholder')}
                  rows={2}
                  className="border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 flex-1 resize-none rounded-lg border px-3 py-2 text-xs outline-none"
                />
                <Button
                  size="sm"
                  className="bg-primary hover:bg-primary/90 h-auto px-2"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div key={note.id} className="bg-muted rounded-lg px-3 py-2">
                    <p className="text-muted-foreground text-xs whitespace-pre-wrap">
                      {note.note_text}
                    </p>
                    <p className="text-muted-foreground mt-1 text-[10px]">
                      {format(new Date(note.created_at), 'MMM d, yyyy HH:mm')}
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
