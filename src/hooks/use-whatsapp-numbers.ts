"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export interface WhatsAppNumber {
  id: string;
  /** What the inbox shows: the instance name ("Igor Whatsapp"). */
  label: string;
  isPrimary: boolean;
}

// One fetch per company per page load, shared by the list and the thread.
const cache = new Map<string, Promise<WhatsAppNumber[]>>();

function load(accountId: string): Promise<WhatsAppNumber[]> {
  let pending = cache.get(accountId);
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
      }))
    );
    pending.catch(() => cache.delete(accountId));
    cache.set(accountId, pending);
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
    load(accountId)
      .then((numbers) => {
        if (alive) setLoaded({ accountId, numbers });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [accountId]);

  const numbers = loaded && loaded.accountId === accountId ? loaded.numbers : [];
  const byId = new Map(numbers.map((n) => [n.id, n]));
  return { numbers, byId, multiple: numbers.length > 1 };
}
