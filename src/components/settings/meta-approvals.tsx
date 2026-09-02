'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Loader2,
  MessageSquareQuote,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

/**
 * Approve or reject Purchase conversions before they reach Meta.
 *
 * A conversion cannot be recalled — once Meta has it, the ad account
 * spends money finding people who resemble whoever it names. The AI reads
 * "won" from the conversation and has been wrong: a customer answering
 * "Ok" to a closing pitch once produced a R$7.400 sale that never
 * happened.
 *
 * The screen is built around the one question the reviewer actually has —
 * "did this person really buy?" — so it leads with the amount and the
 * customer's own last words, which is what gives a bad verdict away.
 * Qualified leads are not shown: they carry no amount and arrive ~11x a
 * day, and a queue that size gets clicked through without being read.
 */

interface Pending {
  id: string;
  deal_id: string;
  title: string | null;
  value: number | null;
  currency: string | null;
  contact: string | null;
  phone: string | null;
  queued_at: string;
  last_customer_message: string | null;
  days_left: number;
  expired: boolean;
}

function money(value: number | null, _currency: string | null) {
  if (value == null) return '—';
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  } catch {
    return `R$ ${value}`;
  }
}

export function MetaApprovals() {
  const [items, setItems] = useState<Pending[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [migrationPending, setMigrationPending] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/meta/capi/pending');
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      setItems([]);
      return;
    }
    setMigrationPending(!!data.migration_pending);
    setItems((data.pending ?? []) as Pending[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(item: Pending, decision: 'approve' | 'reject') {
    setBusy(item.id);
    const res = await fetch('/api/meta/capi/pending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, decision }),
    });
    const data = await res.json().catch(() => null);
    setBusy(null);

    if (!res.ok) {
      toast.error(data?.error ?? 'Não foi possível registrar a decisão.');
      return;
    }
    toast.success(
      decision === 'approve'
        ? `Compra de ${money(item.value, item.currency)} enviada à Meta.`
        : 'Conversão descartada — nada foi enviado.'
    );
    void load();
  }

  if (items === null) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <BadgeCheck className="h-5 w-5" />
          Aprovar conversões
        </h2>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Cada venda que a IA identifica espera aqui antes de ir para a Meta. Um
          evento enviado não pode ser desfeito: a partir dele a Meta passa a
          procurar mais pessoas parecidas com esse cliente. Leads qualificados
          continuam sendo enviados automaticamente — só o dinheiro passa por
          você.
        </p>
      </header>

      {migrationPending && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          Rode{' '}
          <code>supabase/migrations/051_meta_capi_purchase_approval.sql</code>{' '}
          no editor SQL do Supabase para ativar a fila.
        </div>
      )}

      {items.length === 0 && !migrationPending && (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          Nenhuma venda esperando aprovação.
        </div>
      )}

      <ul className="space-y-4">
        {items.map((item) => (
          <li
            key={item.id}
            className="bg-card space-y-4 rounded-lg border p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium break-words">
                  {item.title ?? 'Sem título'}
                </p>
                <p className="text-muted-foreground text-sm break-words">
                  {item.contact ?? 'Contato desconhecido'}
                </p>
              </div>
              <p className="text-lg font-semibold tabular-nums">
                {money(item.value, item.currency)}
              </p>
            </div>

            {item.last_customer_message && (
              <figure className="bg-muted/50 rounded-md p-3">
                <figcaption className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-medium">
                  <MessageSquareQuote className="h-3.5 w-3.5" />
                  Última mensagem do cliente
                </figcaption>
                <blockquote className="text-sm break-words">
                  {item.last_customer_message}
                </blockquote>
              </figure>
            )}

            {/* Meta refuses events older than 7 days, so the deadline is
                part of the decision, not a footnote. */}
            {item.expired ? (
              <p className="text-destructive flex items-center gap-1.5 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Fora do prazo de 7 dias da Meta — não é mais possível enviar.
              </p>
            ) : (
              <p
                className={
                  item.days_left <= 2
                    ? 'text-sm font-medium text-amber-600 dark:text-amber-500'
                    : 'text-muted-foreground text-sm'
                }
              >
                {item.days_left === 0
                  ? 'Vence hoje'
                  : `Faltam ${item.days_left} dia${item.days_left === 1 ? '' : 's'} para enviar`}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => decide(item, 'approve')}
                disabled={busy === item.id || item.expired}
                className="gap-1.5"
              >
                {busy === item.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Confirmar venda
              </Button>
              <Button
                variant="outline"
                onClick={() => decide(item, 'reject')}
                disabled={busy === item.id}
                className="gap-1.5"
              >
                <X className="h-4 w-4" />
                Não vendeu
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
