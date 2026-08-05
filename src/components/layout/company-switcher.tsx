"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronsUpDown, Loader2, UsersRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AccountRole } from "@/lib/auth/roles";

interface MyAccount {
  id: string;
  name: string;
  role: AccountRole;
  is_current: boolean;
}

/**
 * Company picker for operators who belong to more than one company.
 *
 * Reads `list_my_accounts()` and writes through `switch_account()` — both
 * SECURITY DEFINER, both verifying membership server-side. Nothing here
 * is trusted to enforce access: this component only decides what to
 * offer, while the database decides what is allowed. A user with one
 * company never sees a picker, so the common case is unchanged.
 *
 * Renders the plain account strip (name + role, no dropdown) when there
 * is nothing to switch between, so the sidebar keeps exactly one place
 * that says which company you are acting in.
 */
export function CompanySwitcher({
  fallbackName,
  fallbackRole,
  showFallback,
  roleChip,
}: {
  fallbackName?: string | null;
  fallbackRole?: AccountRole | null;
  /** Whether the single-company strip should render at all. */
  showFallback: boolean;
  roleChip: (role: AccountRole) => React.ReactNode;
}) {
  const t = useTranslations("Layout.companySwitcher");
  const [accounts, setAccounts] = useState<MyAccount[] | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("list_my_accounts");
      if (cancelled) return;
      // A deployment that hasn't run migration 046 has no such function;
      // fall back to the single-company strip rather than erroring.
      if (error) {
        setAccounts([]);
        return;
      }
      setAccounts((data ?? []) as MyAccount[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSwitch = useCallback(
    async (accountId: string) => {
      setSwitching(accountId);
      const supabase = createClient();
      const { error } = await supabase.rpc("switch_account", {
        target_account_id: accountId,
      });
      if (error) {
        setSwitching(null);
        toast.error(error.message || t("switchFailed"));
        return;
      }
      // Hard reload rather than a router refresh: the account id is read
      // server-side on nearly every request and cached in client state
      // all over the app, so a full reload is the only way to be sure
      // nothing from the previous company survives the switch.
      window.location.reload();
    },
    [t],
  );

  const current = accounts?.find((a) => a.is_current);
  const hasChoice = (accounts?.length ?? 0) > 1;

  if (!hasChoice) {
    if (!showFallback || !fallbackName) return null;
    return (
      <div className="mb-2 flex items-center gap-2 px-3 text-xs text-muted-foreground">
        <UsersRound className="size-3.5 shrink-0" />
        <span className="truncate" title={fallbackName}>
          {fallbackName}
        </span>
        {fallbackRole ? roleChip(fallbackRole) : null}
      </div>
    );
  }

  const currentName = current?.name ?? fallbackName ?? "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 focus:bg-muted/60 focus:outline-none data-popup-open:bg-muted/60">
        <UsersRound className="size-3.5 shrink-0" />
        <span className="truncate" title={currentName}>
          {currentName}
        </span>
        <ChevronsUpDown className="ml-auto size-3.5 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("label")}
        </div>
        {accounts?.map((account) => (
          <DropdownMenuItem
            key={account.id}
            disabled={switching !== null}
            onClick={() => {
              if (account.is_current) return;
              void handleSwitch(account.id);
            }}
            className="flex items-center gap-2"
          >
            {switching === account.id ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
            ) : account.is_current ? (
              <Check className="size-3.5 shrink-0 text-primary" />
            ) : (
              <span className="size-3.5 shrink-0" />
            )}
            <span className="truncate">{account.name}</span>
            <span className="ml-auto shrink-0">{roleChip(account.role)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
