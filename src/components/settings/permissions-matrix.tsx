"use client";

import { Check, Minus } from "lucide-react";

import { MODULES, canAccessModule, type Module } from "@/lib/auth/modules";
import type { AccountRole } from "@/lib/auth/roles";

/**
 * The permission matrix, shown so an operator can answer "what will this
 * person see?" before assigning a profile — and so a client asking the
 * same question gets a screen instead of a promise.
 *
 * Read-only by decision: one fixed matrix serves every company, so there
 * is nothing here to edit. Making it look editable would imply a
 * per-company override that does not exist.
 */

const COLUMNS: { role: AccountRole; label: string }[] = [
  { role: "admin", label: "Administrador" },
  { role: "manager", label: "Gerente" },
  { role: "agent", label: "Vendedor" },
];

const MODULE_LABELS: Record<Module, string> = {
  dashboard: "Painel",
  inbox: "Caixa de entrada",
  notifications: "Notificações",
  contacts: "Contatos",
  pipelines: "Pipeline (Negócios)",
  broadcasts: "Transmissões",
  "meta-approvals": "Aprovar conversões",
  automations: "Automações",
  flows: "Fluxos",
  agents: "Agentes de IA",
  settings: "Configurações",
};

export function PermissionsMatrix() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-lg font-semibold">Perfis e permissões</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          O que cada perfil pode abrir. A regra é a mesma para todas as
          empresas — o perfil é definido por empresa, então a mesma pessoa
          pode ser Gerente em uma e Vendedor em outra.
        </p>
      </header>

      {/* Wide table on a narrow phone: scroll the table, never the page. */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th scope="col" className="p-3 text-left font-medium">
                Módulo
              </th>
              {COLUMNS.map((c) => (
                <th key={c.role} scope="col" className="p-3 font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULES.map((m) => (
              <tr key={m} className="border-b last:border-0">
                <th scope="row" className="p-3 text-left font-normal">
                  {MODULE_LABELS[m]}
                </th>
                {COLUMNS.map((c) => {
                  const allowed = canAccessModule(c.role, m);
                  return (
                    <td key={c.role} className="p-3 text-center">
                      {allowed ? (
                        <Check
                          className="mx-auto h-4 w-4 text-emerald-600 dark:text-emerald-400"
                          aria-label="Tem acesso"
                        />
                      ) : (
                        <Minus
                          className="mx-auto h-4 w-4 text-muted-foreground/50"
                          aria-label="Sem acesso"
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 text-sm text-muted-foreground">
        <p>
          <strong className="text-foreground">Vendedor</strong> atende: conversas,
          contatos, pipeline e painel.
        </p>
        <p>
          <strong className="text-foreground">Gerente</strong> acrescenta o que é
          irreversível — transmissões, que não podem ser canceladas depois de
          enviadas, e a aprovação de conversões, que libera investimento em
          anúncio.
        </p>
        <p>
          <strong className="text-foreground">Administrador</strong> acrescenta o
          que muda o sistema para todo mundo: integrações, IA, automações e
          chaves.
        </p>
        <p className="border-t pt-3">
          <strong className="text-foreground">Sobre os dados:</strong> qualquer
          perfil enxerga todos os contatos e negócios da empresa em que está.
          Os perfis controlam o que a pessoa pode <em>fazer</em>, não quais
          registros ela vê. Se um dia você quiser que cada vendedor veja só a
          própria carteira, isso é uma mudança separada.
        </p>
      </div>
    </div>
  );
}
