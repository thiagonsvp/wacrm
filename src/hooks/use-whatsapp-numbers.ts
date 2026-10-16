"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export interface WhatsAppNumber {
  id: string;
  /** What the inbox shows: the instance name ("Igor Whatsapp"). */
  label: string;
  isPrimary: boolean;
  /** Stable colour for this number's chip (by binding order). */
  color: string;
}

/** Distinct from the seller chip palette so the two never read as one. */
const NUMBER_COLORS = ["#0f766e", "#c2410c", "#7c3aed", "#be123c", "#1d4ed8", "#4d7c0f"];

// Shared by the list and the thread; refreshed after a minute so a number
// bound while the inbox is open shows up without a reload.
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; pending: Promise<WhatsAppNumber[]> }>();

function load(accountId: string): Promise<WhatsAppNumber[]> {
  const hit = cache.get(accountId);
  let pending = hit && Date.now() - hit.at < TTL_MS ? hit.pending : undefined;
  if (!pending) {
    pending = Promise.resolve(
      createClient()
        .from("whatsapp_config")
        .select("id, provider, uazapi_instance_name, phone_number_id, is_primary, created_at")
        .eq("account_id", accountId)
        .order("created_at", { ascending: true })
    ).then(({ data }) =>
      (data ?? []).map((row, i) => ({
        id: row.id as string,
        label:
          (row.uazapi_instance_name as string | null)?.trim() ||
          (row.provider === "meta" ? "WhatsApp oficial" : `Número ${i + 1}`),
        isPrimary: !!row.is_primary,
        color: NUMBER_COLORS[i % NUMBER_COLORS.length],
      }))
    );
    pending.catch(() => cache.delete(accountId));
    cache.set(accountId, { at: Date.now(), pending });
  }
  return pending;
}

/**
 * The company's WhatsApp numbers (several since migration 087). The inbox
 * only labels conversations by number when there is more than one —
 * `multiple` says whether to show the label at all.
 */
export function useWhatsAppNumbers() {
  const { accountId } = useAuth();
  const [loaded, setLoaded] = useState<{ accountId: string; numbers: WhatsAppNumber[] } | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    const refresh = () =>
      load(accountId)
        .then((numbers) => {
          if (alive) setLoaded({ accountId, numbers });
        })
        .catch(() => {});
    void refresh();
    const timer = setInterval(refresh, TTL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [accountId]);

  const numbers = loaded && loaded.accountId === accountId ? loaded.numbers : [];
  const byId = new Map(numbers.map((n) => [n.id, n]));
  return { numbers, byId, multiple: numbers.length > 1 };
}
