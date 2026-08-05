"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsPanelHead } from "./settings-panel-head";
import { MembersTab } from "./members-tab";

/**
 * The company this workspace belongs to, and the people in it.
 *
 * These were never one place before. `accounts.name` could only be set
 * by `handle_new_user()`, which names it after whoever signed up — so
 * the company list read as a list of people ("Thiago Nascimento da
 * Silva") with no way to say what the business is actually called. The
 * rename API existed but nothing called it.
 *
 * Members live here rather than in their own section because "who works
 * at this company" is part of registering the company, not a separate
 * concern — and because with several companies in play it matters that
 * the member list is visibly attached to the one you are editing.
 */
export function CompanyPanel() {
  const { account, accountRole, user } = useAuth();
  const t = useTranslations("Settings.company");

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const canEdit = accountRole === "owner" || accountRole === "admin";

  useEffect(() => {
    setName(account?.name ?? "");
  }, [account?.name]);

  // Company creation is super-admin only; hide the affordance rather
  // than offering a button that always fails.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("profiles")
        .select("is_super_admin")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled) setIsSuperAdmin(data?.is_super_admin === true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("nameRequired"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t("saveFailed"));
        return;
      }
      toast.success(t("saved"));
      // The name is read from server-side context on most pages, so a
      // reload is the only way to see it change everywhere at once.
      window.location.reload();
    } finally {
      setSaving(false);
    }
  }, [name, t]);

  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const res = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t("createFailed"));
        return;
      }
      toast.success(t("created", { name: trimmed }));
      setNewName("");
      setShowCreate(false);
      // Not switched into automatically: creating a company while
      // looking at another one should not silently move the operator
      // out of the one they were working in.
    } finally {
      setCreating(false);
    }
  }, [newName, t]);

  return (
    <div>
      <SettingsPanelHead title={t("title")} description={t("description")} />

      <Card className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="company-name">{t("nameLabel")}</Label>
            <Input
              id="company-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              maxLength={80}
              disabled={!canEdit || saving}
            />
            <p className="text-xs text-muted-foreground">{t("nameHint")}</p>
          </div>
        </div>

        {canEdit && (
          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={saving || name.trim() === (account?.name ?? "")}
            >
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              {t("save")}
            </Button>
          </div>
        )}
      </Card>

      {isSuperAdmin && (
        <Card className="mt-4 space-y-3 p-5">
          <div>
            <h3 className="text-sm font-medium text-foreground">
              {t("createTitle")}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("createDesc")}
            </p>
          </div>

          {showCreate ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("namePlaceholder")}
                maxLength={80}
                disabled={creating}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate();
                }}
              />
              <div className="flex gap-2">
                <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
                  {creating ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  {t("createConfirm")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowCreate(false);
                    setNewName("");
                  }}
                  disabled={creating}
                >
                  {t("cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setShowCreate(true)}>
              <Plus className="mr-1.5 size-4" />
              {t("createButton")}
            </Button>
          )}
        </Card>
      )}

      <div className="mt-8 border-t border-border pt-6">
        <h3 className="text-sm font-medium text-foreground">{t("usersTitle")}</h3>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          {t("usersDesc", { company: account?.name ?? "" })}
        </p>
        <MembersTab />
      </div>
    </div>
  );
}
