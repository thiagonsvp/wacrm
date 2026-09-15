'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { SettingsPanelHead } from './settings-panel-head';
import { googleLeadTrackingSnippet } from '@/lib/google-ads/snippet';

const MASKED = '••••••••••••••••';

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
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}

export function GoogleAdsConfig() {
  const { canManageMembers: isAdmin } = useAuth();
  const t = useTranslations('Settings.googleAds');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [migrationPending, setMigrationPending] = useState(false);
  const [origin, setOrigin] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [loginCustomerId, setLoginCustomerId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [developerToken, setDeveloperToken] = useState('');
  const [leadAction, setLeadAction] = useState('');
  const [purchaseAction, setPurchaseAction] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [webhookToken, setWebhookToken] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [sendLead, setSendLead] = useState(true);
  const [sendPurchase, setSendPurchase] = useState(false);
  const [edited, setEdited] = useState<Record<string, boolean>>({});
  const loaded = useRef(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/google-ads/config', {
        cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok) return toast.error(data.error ?? t('loadFailed'));
      setMigrationPending(!!data.migration_pending);
      setConfigured(!!data.configured);
      if (data.configured) {
        setCustomerId(data.customer_id ?? '');
        setLoginCustomerId(data.login_customer_id ?? '');
        setClientId(data.client_id ?? '');
        setClientSecret(data.has_client_secret ? MASKED : '');
        setRefreshToken(data.has_refresh_token ? MASKED : '');
        setDeveloperToken(data.has_developer_token ? MASKED : '');
        setLeadAction(data.qualified_lead_conversion_action_id ?? '');
        setPurchaseAction(data.purchase_conversion_action_id ?? '');
        setWebsiteUrl(data.website_url ?? '');
        setWebhookToken(data.webhook_token ?? '');
        setIsActive(!!data.is_active);
        setSendLead(data.send_qualified_lead !== false);
        setSendPurchase(!!data.send_purchase);
        setEdited({});
      }
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    setOrigin(window.location.origin);
    if (loaded.current) return;
    loaded.current = true;
    void fetchConfig();
  }, [fetchConfig]);

  const endpoint =
    webhookToken && origin
      ? `${origin}/api/google-ads/leads/${webhookToken}`
      : '';
  const snippet = useMemo(
    () => googleLeadTrackingSnippet(endpoint),
    [endpoint]
  );
  const secret = (key: string, value: string) =>
    edited[key] ? value.trim() : '';
  const editSecret =
    (key: string, setter: (value: string) => void) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setter(event.target.value);
      setEdited((old) => ({ ...old, [key]: true }));
    };
  const focusSecret =
    (key: string, value: string, setter: (value: string) => void) => () => {
      if (!edited[key] && value === MASKED) setter('');
    };

  async function save() {
    setSaving(true);
    try {
      const response = await fetch('/api/google-ads/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          login_customer_id: loginCustomerId,
          client_id: clientId,
          client_secret: secret('clientSecret', clientSecret),
          refresh_token: secret('refreshToken', refreshToken),
          developer_token: secret('developerToken', developerToken),
          qualified_lead_conversion_action_id: leadAction,
          purchase_conversion_action_id: purchaseAction,
          website_url: websiteUrl,
          is_active: isActive,
          send_qualified_lead: sendLead,
          send_purchase: sendPurchase,
        }),
      });
      const data = await response.json();
      if (!response.ok) return toast.error(data.error ?? t('saveFailed'));
      toast.success(t('saved'));
      await fetchConfig();
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const response = await fetch('/api/google-ads/config', { method: 'PUT' });
      const data = await response.json();
      if (response.ok) toast.success(t('testOk'));
      else toast.error(data.error ?? t('testFailed'));
    } finally {
      setTesting(false);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  if (loading)
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('loading')}
      </div>
    );
  const disabled = !isAdmin || saving;

  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />
      {migrationPending && (
        <Card className="mb-4 border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-sm">{t('migrationPending')}</p>
          <code className="text-muted-foreground mt-2 block text-xs">
            supabase/migrations/073_google_ads_offline_conversions.sql
          </code>
        </Card>
      )}

      <Card className="space-y-5 p-5">
        <div>
          <h3 className="text-sm font-medium">{t('credentials')}</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('credentialsDesc')}
          </p>
          <a
            href="https://ads.google.com/aw/apicenter"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary mt-2 inline-flex items-center gap-1 text-xs hover:underline"
          >
            {t('openApiCenter')}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            id="google-customer"
            label={t('customerId')}
            hint={t('customerIdHint')}
          >
            <Input
              id="google-customer"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              placeholder="123-456-7890"
              disabled={disabled}
            />
          </Field>
          <Field
            id="google-manager"
            label={t('managerId')}
            hint={t('managerIdHint')}
          >
            <Input
              id="google-manager"
              value={loginCustomerId}
              onChange={(e) => setLoginCustomerId(e.target.value)}
              placeholder="123-456-7890"
              disabled={disabled}
            />
          </Field>
        </div>
        <Field
          id="google-client-id"
          label={t('clientId')}
          hint={t('clientIdHint')}
        >
          <Input
            id="google-client-id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="...apps.googleusercontent.com"
            disabled={disabled}
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            id="google-client-secret"
            label={t('clientSecret')}
            hint={t('clientSecretHint')}
          >
            <Input
              id="google-client-secret"
              type="password"
              value={clientSecret}
              onChange={editSecret('clientSecret', setClientSecret)}
              onFocus={focusSecret(
                'clientSecret',
                clientSecret,
                setClientSecret
              )}
              disabled={disabled}
            />
          </Field>
          <Field
            id="google-refresh"
            label={t('refreshToken')}
            hint={t('refreshTokenHint')}
          >
            <Input
              id="google-refresh"
              type="password"
              value={refreshToken}
              onChange={editSecret('refreshToken', setRefreshToken)}
              onFocus={focusSecret(
                'refreshToken',
                refreshToken,
                setRefreshToken
              )}
              disabled={disabled}
            />
          </Field>
        </div>
        <Field
          id="google-dev-token"
          label={t('developerToken')}
          hint={t('developerTokenHint')}
        >
          <Input
            id="google-dev-token"
            type="password"
            value={developerToken}
            onChange={editSecret('developerToken', setDeveloperToken)}
            onFocus={focusSecret(
              'developerToken',
              developerToken,
              setDeveloperToken
            )}
            disabled={disabled}
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            id="google-lead-action"
            label={t('leadAction')}
            hint={t('actionHint')}
          >
            <Input
              id="google-lead-action"
              value={leadAction}
              onChange={(e) => setLeadAction(e.target.value)}
              inputMode="numeric"
              disabled={disabled}
            />
          </Field>
          <Field
            id="google-purchase-action"
            label={t('purchaseAction')}
            hint={t('actionHint')}
          >
            <Input
              id="google-purchase-action"
              value={purchaseAction}
              onChange={(e) => setPurchaseAction(e.target.value)}
              inputMode="numeric"
              disabled={disabled}
            />
          </Field>
        </div>
      </Card>

      <Card className="mt-4 space-y-4 p-5">
        <div>
          <h3 className="text-sm font-medium">{t('siteTitle')}</h3>
          <p className="text-muted-foreground mt-1 text-xs">{t('siteDesc')}</p>
        </div>
        <Field
          id="google-site"
          label={t('websiteUrl')}
          hint={t('websiteUrlHint')}
        >
          <Input
            id="google-site"
            type="url"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://www.seusite.com.br"
            disabled={disabled}
          />
        </Field>
        {endpoint ? (
          <>
            <Field
              id="google-endpoint"
              label={t('endpoint')}
              hint={t('endpointHint')}
            >
              <div className="flex gap-2">
                <Input
                  id="google-endpoint"
                  readOnly
                  value={endpoint}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => copy(endpoint)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </Field>
            <Field
              id="google-snippet"
              label={t('snippet')}
              hint={t('snippetHint')}
            >
              <Textarea
                id="google-snippet"
                readOnly
                value={snippet}
                rows={14}
                className="font-mono text-[11px]"
              />
              <Button
                type="button"
                variant="outline"
                className="mt-2"
                onClick={() => copy(snippet)}
              >
                <Copy className="mr-2 h-4 w-4" />
                {t('copySnippet')}
              </Button>
            </Field>
          </>
        ) : (
          <p className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
            {t('saveForSnippet')}
          </p>
        )}
      </Card>

      <Card className="mt-4 space-y-4 p-5">
        <h3 className="text-sm font-medium">{t('behaviour')}</h3>
        {[
          [isActive, setIsActive, 'enable', 'enableDesc', false],
          [sendLead, setSendLead, 'sendLead', 'sendLeadDesc', !isActive],
          [
            sendPurchase,
            setSendPurchase,
            'sendPurchase',
            'sendPurchaseDesc',
            !isActive,
          ],
        ].map(([checked, setter, label, desc, extraDisabled]) => (
          <div
            key={String(label)}
            className="flex items-center justify-between gap-4 rounded-md border p-3"
          >
            <div>
              <p className="text-sm font-medium">{t(label as string)}</p>
              <p className="text-muted-foreground text-xs">
                {t(desc as string)}
              </p>
            </div>
            <Switch
              checked={checked as boolean}
              onCheckedChange={setter as (value: boolean) => void}
              disabled={disabled || (extraDisabled as boolean)}
            />
          </div>
        ))}
      </Card>
      {isAdmin && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('save')}
          </Button>
          <Button
            variant="outline"
            onClick={test}
            disabled={testing || !configured}
          >
            {testing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            {t('test')}
          </Button>
        </div>
      )}
    </div>
  );
}
