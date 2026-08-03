"use client";

import type { Deal, PipelineStage, Tag } from "@/types";
import { Calendar, Check, X } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { useTranslations } from "next-intl";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

type LeadSource = "facebook" | "instagram" | "google";

function getLeadSource(contact: Deal["contact"]): LeadSource | null {
  if (contact?.acquisition_source === "Facebook") return "facebook";
  if (contact?.acquisition_source === "Instagram") return "instagram";
  const names = ((contact?.tags ?? []) as Tag[]).map((tag) =>
    tag.name.trim().toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
  );
  if (names.some((name) => name.includes("facebook"))) return "facebook";
  if (names.some((name) => name.includes("instagram"))) return "instagram";
  if (names.some((name) => name.includes("google") || name.includes("organico"))) return "google";
  return null;
}

function LeadSourceIcon({ source }: { source: LeadSource }) {
  const label = source === "facebook" ? "Facebook" : source === "instagram" ? "Instagram" : "Google / Orgânico";
  return (
    <span aria-label={label} title={label} className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
      {source === "facebook" && <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4 fill-[#1877F2]"><path d="M14 8h3V4h-3c-3.3 0-5 1.9-5 5v3H6v4h3v8h4v-8h3.5l.5-4H13V9c0-.7.3-1 1-1Z" /></svg>}
      {source === "instagram" && <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4 fill-none stroke-[#E4405F]" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" className="fill-[#E4405F] stroke-none" /></svg>}
      {source === "google" && <span className="text-[11px] font-bold text-[#4285F4]">G</span>}
    </span>
  );
}

export function DealCard({ deal, stage, onEdit, isOverlay }: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const contactLabel = deal.contact?.name || deal.contact?.phone || t("noContact");
  const assigneeLabel = deal.assignee?.full_name || null;
  const leadSource = getLeadSource(deal.contact);
  const contactTags = (deal.contact?.tags ?? []) as Tag[];
  // Closed deals created before the close-date field was populated use their
  // last update as a safe historical fallback, so every closed card displays
  // a date while preserving the explicitly saved close date when available.
  const displayDate = deal.expected_close_date ||
    (deal.status === "won" || deal.status === "lost" ? deal.updated_at : null);

  return (
    <button
      type="button"
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      className={`group relative w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 pl-4 pr-3 py-3 text-left shadow-sm transition-all ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="flex items-start justify-between gap-2">
        <h4 className="flex-1 text-sm font-semibold leading-snug text-foreground break-words">
          {deal.title}
        </h4>
        {deal.status === "won" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
            <Check className="h-3 w-3" />
            {t("won")}
          </span>
        )}
        {deal.status === "lost" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            <X className="h-3 w-3" />
            {t("lost")}
          </span>
        )}
      </div>

      {/* Contact row */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
          {initials(deal.contact?.name, deal.contact?.phone)}
        </span>
        <span className="truncate text-xs text-muted-foreground">{contactLabel}</span>
        {leadSource && <LeadSourceIcon source={leadSource} />}
        {contactTags.map((tag) => (
          <span key={tag.id} title={tag.name} className="max-w-28 truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${tag.color}20`, color: tag.color }}>
            {tag.name}
          </span>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm font-bold text-primary">
          {formatCurrency(deal.value, deal.currency)}
        </span>
        {displayDate && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {formatDate(displayDate)}
          </span>
        )}
      </div>

      {assigneeLabel && (
        <div className="mt-2 flex items-center justify-end">
          <span
            title={assigneeLabel}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
          >
            {initials(assigneeLabel)}
          </span>
        </div>
      )}
    </button>
  );
}
