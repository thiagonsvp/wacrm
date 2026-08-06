"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingsPanelHead } from "./settings-panel-head";

const MASKED = "••••••••••••••••";

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * Instagram Direct + Messenger credentials.
 *
 * The webhook URL and verify token are shown rather than asked for: the
 * operator pastes them into Meta's form, not the other way round. The
 * verify token is generated server-side on first save, so nobody has to
 * invent one and no value gets reused from another system.
 */
export function MetaMessagingConfig() {
  const { canManageMembers: isAdmin } = useAuth();
  const t = useTranslations("Settings.metaMessaging");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [migrationPending, setMigrationPending] = useState(false);

  const [pageId, setPageId] = useState("");
  const [igId, setIgId] = useState("");
  const [token, setToken] = useState("");
  const [tokenEdited, setTokenEdited] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [verifyToken, setVerifyToken] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [igEnabled, setIgEnabled] = useState(true);
  const [msgEnabled, setMsgEnabled] = useState(true);

  const loadedRef = useRef(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/messaging/meta/config", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t("loadFailed"));
        return;
      }
      setMigrationPending(!!data.migration_pending);
      if (data.configured) {
        setPageId(data.page_id ?? "");
        setIgId(data.instagram_account_id ?? "");
        setVerifyToken(data.verify_token ?? "");
        setIsActive(!!data.is_active);
        setIgEnabled(data.instagram_enabled !== false);
        setMsgEnabled(data.messenger_enabled !== false);
        setHasToken(!!data.has_token);
        setToken(data.has_token ? MASKED : "");
        setTokenEdited(false);
      }
    } catch {
      toast.error(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void fetchConfig();
  }, [fetchConfig]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/messaging/meta/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page_id: pageId.trim(),
          instagram_account_id: igId.trim(),
          page_access_token: tokenEdited ? token.trim() : "",
          is_active: isActive,
          instagram_enabled: igEnabled,
          messenger_enabled: msgEnabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t("saveFailed"));
        return;
      }
      toast.success(t("saved"));
      setTokenEdited(false);
      await fetchConfig();
    } finally {
      setSaving(false);
    }
  }, [pageId, igId, token, tokenEdited, isActive, igEnabled, msgEnabled, fetchConfig, t]);

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/messaging/meta/webhook`
      : "/api/messaging/meta/webhook";

  const copy = (value: string, label: string) => {
    void navigator.clipboard.writeText(value);
    toast.success(t("copied", { what: label }));
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("loading")}
      </div>
    );
  }

  const disabled = !isAdmin || saving;

  return (
    <div>
      <SettingsPanelHead title={t("title")} description={t("description")} />

      <Card className="mb-4 border-amber-500/30 bg-amber-500/10 p-4">
        <p className="text-sm font-medium text-foreground">{t("reviewTitle")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("reviewBody")}</p>
        <a
          href="https://developers.facebook.com/docs/instagram-platform/overview/"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {t("reviewLink")}
          <ExternalLink className="h-3 w-3" />
        </a>
      </Card>

      {migrationPending && (
        <Card className="mb-4 border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-sm text-foreground">{t("migrationPending")}</p>
          <code className="mt-2 block text-xs text-muted-foreground">
            supabase/migrations/049_messaging_channels.sql
          </code>
        </Card>
      )}

      <Card className="space-y-5 p-5">
        <div>
          <h3 className="text-sm font-medium text-foreground">{t("credentials")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("credentialsDesc")}</p>
        </div>

        <Field id="mm-page" label={t("pageLabel")} hint={t("pageHint")}>
          <Input
            id="mm-page"
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
            placeholder="102938475601234"
            inputMode="numeric"
            disabled={disabled}
          />
        </Field>

        <Field id="mm-ig" label={t("igLabel")} hint={t("igHint")}>
          <Input
            id="mm-ig"
            value={igId}
            onChange={(e) => setIgId(e.target.value)}
            placeholder="178414......"
            inputMode="numeric"
            disabled={disabled}
          />
        </Field>

        <Field id="mm-token" label={t("tokenLabel")} hint={t("tokenHint")}>
          <Input
            id="mm-token"
            type="password"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setTokenEdited(true);
            }}
            onFocus={() => {
              if (!tokenEdited && hasToken) setToken("");
            }}
            placeholder={hasToken ? MASKED : "EAAG..."}
            disabled={disabled}
          />
        </Field>
      </Card>

      <Card className="mt-4 space-y-4 p-5">
        <div>
          <h3 className="text-sm font-medium text-foreground">{t("webhookTitle")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("webhookDesc")}</p>
        </div>

        <div className="space-y-1.5">
          <Label>{t("webhookUrlLabel")}</Label>
          <div className="flex gap-2">
            <Input readOnly value={webhookUrl} className="font-mono text-xs" />
            <Button
              variant="outline"
              size="icon"
              onClick={() => copy(webhookUrl, t("webhookUrlLabel"))}
              aria-label={t("copy")}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>{t("verifyTokenLabel")}</Label>
          <div className="flex gap-2">
            <Input
              readOnly
              value={verifyToken || t("verifyTokenAfterSave")}
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              size="icon"
              disabled={!verifyToken}
              onClick={() => copy(verifyToken, t("verifyTokenLabel"))}
              aria-label={t("copy")}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("verifyTokenHint")}</p>
        </div>
      </Card>

      <Card className="mt-4 space-y-4 p-5">
        <h3 className="text-sm font-medium text-foreground">{t("behaviour")}</h3>

        <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
          <div>
            <p className="text-sm font-medium text-foreground">{t("enable")}</p>
            <p className="text-xs text-muted-foreground">{t("enableDesc")}</p>
          </div>
          <Switch checked={isActive} onCheckedChange={setIsActive} disabled={disabled} />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
          <div>
            <p className="text-sm font-medium text-foreground">{t("instagram")}</p>
            <p className="text-xs text-muted-foreground">{t("instagramDesc")}</p>
          </div>
          <Switch
            checked={igEnabled}
            onCheckedChange={setIgEnabled}
            disabled={disabled || !isActive}
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
          <div>
            <p className="text-sm font-medium text-foreground">{t("messenger")}</p>
            <p className="text-xs text-muted-foreground">{t("messengerDesc")}</p>
          </div>
          <Switch
            checked={msgEnabled}
            onCheckedChange={setMsgEnabled}
            disabled={disabled || !isActive}
          />
        </div>
      </Card>

      {isAdmin && (
        <div className="mt-4">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("save")}
          </Button>
        </div>
      )}
    </div>
  );
}
