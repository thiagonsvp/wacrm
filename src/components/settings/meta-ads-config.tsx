'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';

/** Same masking convention as the AI key field. */
const MASKED = '••••••••••••••••';

/**
 * One credential field with the "where do I find this?" answer attached.
 *
 * Written for someone setting this up on a client's account for the
 * first time: every field says what it is, and the exact click path to
 * the value, because "Dataset ID" is meaningless without it.
 */
function Guided({
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

export function MetaAdsConfig() {
  const { canManageMembers: isAdmin } = useAuth();
  const t = useTranslations('Settings.metaAds');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [migrationPending, setMigrationPending] = useState(false);

  const [datasetId, setDatasetId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [pageId, setPageId] = useState('');
  const [testEventCode, setTestEventCode] = useState('');
  const [token, setToken] = useState('');
  const [hasStoredToken, setHasStoredToken] = useState(false);
  const [tokenEdited, setTokenEdited] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [sendLead, setSendLead] = useState(true);
  const [sendPurchase, setSendPurchase] = useState(false);

  const loadedRef = useRef(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/meta/capi/config', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('loadFailed'));
        return;
      }
      setMigrationPending(!!data.migration_pending);
      if (data.configured) {
        setConfigured(true);
        setDatasetId(data.dataset_id ?? '');
        setWabaId(data.waba_id ?? '');
        setPageId(data.page_id ?? '');
        setTestEventCode(data.test_event_code ?? '');
        setIsActive(!!data.is_active);
        setSendLead(data.send_qualified_lead !== false);
        setSendPurchase(!!data.send_purchase);
        setHasStoredToken(!!data.has_token);
        setToken(data.has_token ? MASKED : '');
        setTokenEdited(false);
      }
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void fetchConfig();
  }, [fetchConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/meta/capi/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_id: datasetId.trim(),
          waba_id: wabaId.trim(),
          page_id: pageId.trim(),
          test_event_code: testEventCode.trim(),
          // Only send the token when it was actually retyped, so a save
          // that just flips a switch never overwrites a good token with
          // the mask.
          access_token: tokenEdited ? token.trim() : '',
          is_active: isActive,
          send_qualified_lead: sendLead,
          send_purchase: sendPurchase,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('saveFailed'));
        return;
      }
      toast.success(t('saved'));
      setTokenEdited(false);
      await fetchConfig();
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/meta/capi/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test_event_code: testEventCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('testFailed'));
        return;
      }
      toast.success(t('testOk'));
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('loading')}
      </div>
    );
  }

  const disabled = !isAdmin || saving;

  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {migrationPending && (
        <Card className="mb-4 border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-sm text-foreground">{t('migrationPending')}</p>
          <code className="mt-2 block text-xs text-muted-foreground">
            supabase/migrations/043_meta_capi_and_tenant_config.sql
          </code>
        </Card>
      )}

      <Card className="space-y-5 p-5">
        <div>
          <h3 className="text-sm font-medium text-foreground">{t('credentials')}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t('credentialsDesc')}</p>
          <a
            href="https://business.facebook.com/events_manager2"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {t('openEventsManager')}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <Guided id="meta-dataset" label={t('datasetLabel')} hint={t('datasetHint')}>
          <Input
            id="meta-dataset"
            value={datasetId}
            onChange={(e) => setDatasetId(e.target.value)}
            placeholder="1234567890123456"
            inputMode="numeric"
            disabled={disabled}
          />
        </Guided>

        <Guided id="meta-token" label={t('tokenLabel')} hint={t('tokenHint')}>
          <Input
            id="meta-token"
            type="password"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setTokenEdited(true);
            }}
            onFocus={() => {
              if (!tokenEdited && hasStoredToken) setToken('');
            }}
            placeholder={hasStoredToken ? MASKED : 'EAAG...'}
            disabled={disabled}
          />
        </Guided>

        <Guided id="meta-waba" label={t('wabaLabel')} hint={t('wabaHint')}>
          <Input
            id="meta-waba"
            value={wabaId}
            onChange={(e) => setWabaId(e.target.value)}
            placeholder="1029384756..."
            inputMode="numeric"
            disabled={disabled}
          />
        </Guided>

        <Guided id="meta-page" label={t('pageLabel')} hint={t('pageHint')}>
          <Input
            id="meta-page"
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
            placeholder="129285426937638"
            inputMode="numeric"
            disabled={disabled}
          />
        </Guided>

        <Guided id="meta-test" label={t('testCodeLabel')} hint={t('testCodeHint')}>
          <Input
            id="meta-test"
            value={testEventCode}
            onChange={(e) => setTestEventCode(e.target.value)}
            placeholder="TEST12345"
            disabled={disabled}
          />
        </Guided>
      </Card>

      <Card className="mt-4 space-y-4 p-5">
        <h3 className="text-sm font-medium text-foreground">{t('behaviour')}</h3>

        <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
          <div>
            <p className="text-sm font-medium text-foreground">{t('enable')}</p>
            <p className="text-xs text-muted-foreground">{t('enableDesc')}</p>
          </div>
          <Switch checked={isActive} onCheckedChange={setIsActive} disabled={disabled} />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
          <div>
            <p className="text-sm font-medium text-foreground">{t('sendLead')}</p>
            <p className="text-xs text-muted-foreground">{t('sendLeadDesc')}</p>
          </div>
          <Switch
            checked={sendLead}
            onCheckedChange={setSendLead}
            disabled={disabled || !isActive}
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
          <div>
            <p className="text-sm font-medium text-foreground">{t('sendPurchase')}</p>
            <p className="text-xs text-muted-foreground">{t('sendPurchaseDesc')}</p>
          </div>
          <Switch
            checked={sendPurchase}
            onCheckedChange={setSendPurchase}
            disabled={disabled || !isActive}
          />
        </div>
      </Card>

      {isAdmin && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('save')}
          </Button>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={testing || !configured}
          >
            {testing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            {t('test')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('testHint')}</p>
        </div>
      )}
    </div>
  );
}
