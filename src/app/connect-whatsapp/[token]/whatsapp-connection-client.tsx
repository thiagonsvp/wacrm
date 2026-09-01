'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  Copy,
  Loader2,
  RefreshCw,
  Smartphone,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type ViewState =
  'loading' | 'waiting' | 'connected' | 'invalid' | 'expired' | 'error';

interface LinkPayload {
  state?: 'waiting' | 'connected' | 'invalid' | 'expired' | 'temporary_error';
  qrCode?: string;
  pairCode?: string;
  expiresAt?: string;
}

export function WhatsappConnectionClient({ token }: { token: string }) {
  const t = useTranslations('WhatsappConnection');
  const [state, setState] = useState<ViewState>('loading');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const terminalRef = useRef(false);
  const requestRef = useRef(false);
  const hasQrRef = useRef(false);

  const applyPayload = useCallback((payload: LinkPayload) => {
    if (payload.state === 'connected') {
      terminalRef.current = true;
      hasQrRef.current = false;
      setQrCode(null);
      setPairCode(null);
      setState('connected');
      return;
    }
    if (payload.state === 'expired') {
      terminalRef.current = true;
      hasQrRef.current = false;
      setQrCode(null);
      setPairCode(null);
      setState('expired');
      return;
    }
    if (payload.state === 'invalid') {
      terminalRef.current = true;
      hasQrRef.current = false;
      setQrCode(null);
      setPairCode(null);
      setState('invalid');
      return;
    }
    if (payload.expiresAt) setExpiresAt(payload.expiresAt);
    if (payload.qrCode) {
      hasQrRef.current = true;
      setQrCode(payload.qrCode);
    }
    if (payload.pairCode) setPairCode(payload.pairCode);
    if (payload.state === 'waiting') setState('waiting');
  }, []);

  const requestQr = useCallback(async () => {
    if (terminalRef.current || requestRef.current) return;
    requestRef.current = true;
    setRefreshing(true);
    try {
      const response = await fetch(
        `/api/public/whatsapp-connect/${encodeURIComponent(token)}/qr`,
        {
          method: 'POST',
          cache: 'no-store',
        }
      );
      const payload = (await response.json().catch(() => ({}))) as LinkPayload;
      applyPayload(payload);
      if (
        !response.ok &&
        (!payload.state || payload.state === 'temporary_error') &&
        !hasQrRef.current
      )
        setState('error');
    } catch {
      if (!hasQrRef.current) setState('error');
    } finally {
      requestRef.current = false;
      setRefreshing(false);
    }
  }, [applyPayload, token]);

  const checkStatus = useCallback(async () => {
    if (terminalRef.current) return;
    try {
      const response = await fetch(
        `/api/public/whatsapp-connect/${encodeURIComponent(token)}`,
        {
          cache: 'no-store',
        }
      );
      const payload = (await response.json().catch(() => ({}))) as LinkPayload;
      applyPayload(payload);
      if (
        !response.ok &&
        (!payload.state || payload.state === 'temporary_error') &&
        !hasQrRef.current
      )
        setState('error');
    } catch {
      // A transient status failure must not discard a QR that may still work.
    }
  }, [applyPayload, token]);

  useEffect(() => {
    void requestQr();
    const statusTimer = window.setInterval(() => void checkStatus(), 3_000);
    const qrTimer = window.setInterval(() => void requestQr(), 15_000);
    return () => {
      window.clearInterval(statusTimer);
      window.clearInterval(qrTimer);
    };
  }, [checkStatus, requestQr]);

  useEffect(() => {
    if (!expiresAt || terminalRef.current) return;
    const update = () => {
      const remaining = Math.max(
        0,
        Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000)
      );
      setSecondsLeft(remaining);
      if (remaining === 0) {
        terminalRef.current = true;
        hasQrRef.current = false;
        setQrCode(null);
        setPairCode(null);
        setState('expired');
      }
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  async function copyPairCode() {
    if (!pairCode) return;
    try {
      await navigator.clipboard.writeText(pairCode);
      toast.success(t('pairCodeCopied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  const minutes = secondsLeft === null ? null : Math.floor(secondsLeft / 60);
  const seconds = secondsLeft === null ? null : secondsLeft % 60;

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="bg-primary/10 text-primary mx-auto mb-2 flex size-12 items-center justify-center rounded-full">
          <Smartphone className="size-6" />
        </div>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-center" aria-live="polite">
        {state === 'loading' && (
          <div className="flex justify-center py-10">
            <Loader2 className="text-primary size-7 animate-spin" />
          </div>
        )}

        {state === 'waiting' && (
          <>
            {qrCode && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrCode}
                alt={t('qrAlt')}
                className={`mx-auto size-64 rounded-lg border bg-white p-2 ${refreshing ? 'opacity-60' : ''}`}
              />
            )}
            {!qrCode && (
              <div className="flex justify-center py-10">
                <Loader2 className="text-primary size-7 animate-spin" />
              </div>
            )}
            <p className="text-muted-foreground text-sm">{t('qrHint')}</p>
            {pairCode && (
              <div className="bg-muted/40 rounded-lg border p-3">
                <p className="text-muted-foreground text-xs">
                  {t('pairCodeLabel')}
                </p>
                <div className="mt-1 flex items-center justify-center gap-2">
                  <span className="font-mono text-xl font-semibold tracking-widest">
                    {pairCode}
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={copyPairCode}
                    aria-label={t('copyPairCode')}
                  >
                    <Copy />
                  </Button>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  {t('pairCodeHint')}
                </p>
              </div>
            )}
            {minutes !== null && seconds !== null && (
              <p className="text-muted-foreground flex items-center justify-center gap-1 text-xs">
                <Clock3 className="size-3.5" />
                {t('expiresIn', {
                  minutes,
                  seconds: String(seconds).padStart(2, '0'),
                })}
              </p>
            )}
            {refreshing && (
              <p className="text-muted-foreground text-xs">{t('refreshing')}</p>
            )}
          </>
        )}

        {state === 'connected' && (
          <div className="py-8">
            <CheckCircle2 className="mx-auto size-14 text-emerald-500" />
            <h2 className="mt-4 text-lg font-semibold">
              {t('connectedTitle')}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('connectedBody')}
            </p>
          </div>
        )}

        {(state === 'invalid' || state === 'expired') && (
          <div className="py-8">
            <h2 className="text-lg font-semibold">{t('invalidTitle')}</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('invalidBody')}
            </p>
          </div>
        )}

        {state === 'error' && (
          <div className="py-8">
            <h2 className="text-lg font-semibold">{t('errorTitle')}</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('errorBody')}
            </p>
            <Button
              className="mt-4"
              onClick={() => {
                setState('loading');
                void requestQr();
              }}
            >
              <RefreshCw />
              {t('retry')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
