# UAZAPI Instance Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner/admin de uma empresa cria, conecta, renomeia, desconecta e deleta suas instâncias UAZAPI dentro do CRM, sem colar URL nem token.

**Architecture:** A UAZAPI é a fonte da verdade do inventário; a posse é marcada em `adminField01 = account_id`, que só o backend pode escrever porque só ele tem o admintoken (vindo de env). O CRM guarda apenas o *vínculo* (`uazapi_instance_id` + token criptografado) em `whatsapp_config`. Funções puras decidem posse e carimbo; wrappers finos fazem a IO.

**Tech Stack:** Next.js 16.2.6 (App Router, route handlers com `params: Promise<...>`), React 19.2.4, TypeScript, Supabase (SSR client + service role), vitest 4, next-intl, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-31-uazapi-instance-panel-design.md`

## Global Constraints

- **Leia antes de escrever rota:** `AGENTS.md` avisa que este Next não corresponde ao seu treino. Rotas dinâmicas usam `{ params }: { params: Promise<{ id: string }> }` + `const { id } = await params` — o padrão das 21 rotas dinâmicas existentes. **Não** use o helper `RouteContext`; o repo não o adotou.
- **Papel:** nunca abra o próprio teste de papel. Use `requireRole('admin')` de `src/lib/auth/account.ts` e `toErrorResponse(err)` no `catch`. `src/lib/auth/roles.ts:11-15` declara os predicados como única fonte de verdade.
- **Token nunca em claro no banco:** todo write de `whatsapp_config.uazapi_token` passa por `encrypt()` de `src/lib/whatsapp/encryption.ts`.
- **Token nunca no browser:** o único formato serializado para o cliente é `PublicInstance` (Task 3). Nunca devolva `token` nem `openai_apikey`.
- **Webhook só no bind.** Existe uma URL de webhook por empresa e a rota do webhook autentica apenas pelo UUID no caminho. `/connect` **não** chama `setWebhook`.
- **i18n:** textos de UI e mensagens de erro das rotas são chaves next-intl, adicionadas a `messages/pt-BR.json` **e** `messages/en.json`, no namespace `Settings.uazapi`.
- **Env:** `UAZAPI_BASE_URL` e `UAZAPI_ADMIN_TOKEN`, só de servidor (sem `NEXT_PUBLIC_`).
- **Comandos:** `npm test` (vitest run), `npm run lint`, `npm run typecheck`.
- **Branch:** o repo está em `main` com trabalho não commitado. Antes da Task 1, crie um branch: `git checkout -b feat/uazapi-instance-panel`.

---

### Task 1: Migração e documentação de ambiente

**Files:**
- Create: `supabase/migrations/060_uazapi_instance_id.sql`
- Modify: `.env.local.example`

**Interfaces:**
- Consumes: nada.
- Produces: coluna `whatsapp_config.uazapi_instance_id TEXT` (nullable) e índice `idx_whatsapp_config_uazapi_instance_id`. Todas as tasks seguintes leem/escrevem essa coluna.

- [ ] **Step 1: Escreva a migração**

Crie `supabase/migrations/060_uazapi_instance_id.sql`:

```sql
-- ============================================================
-- whatsapp_config: chavear o vínculo UAZAPI pelo id da instância
--
-- Até aqui o vínculo entre a empresa e sua instância era o
-- `uazapi_instance_name`. Isso funcionou enquanto o nome era imutável
-- (só existia colando credenciais na mão). O painel de instâncias
-- adiciona um botão "Renomear", e a partir daí o nome deixa de servir
-- como chave: renomear a instância vinculada quebraria o badge
-- "vinculada", o carimbo automático de posse, a guarda de 409 em
-- src/app/api/whatsapp/config/route.ts e a URL de foto de perfil em
-- src/app/api/whatsapp/webhook/uazapi/[configId]/route.ts.
--
-- O `id` da instância na UAZAPI é estável e único. Ele passa a ser a
-- chave; `uazapi_instance_name` continua existindo como espelho
-- legível (o webhook o usa para montar a URL de foto de perfil) e é
-- reescrito junto com o id a cada bind e a cada rename.
--
-- Nullable de propósito: linhas existentes só ganham o id quando o
-- painel as adota (ver o carimbo automático em
-- src/lib/whatsapp/uazapi-ownership.ts).
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS uazapi_instance_id TEXT;

-- O lookup "outra empresa já reivindicou esta instância?" roda em todo
-- bind e é o que impede duas empresas de compartilharem um número.
CREATE INDEX IF NOT EXISTS idx_whatsapp_config_uazapi_instance_id
  ON whatsapp_config(uazapi_instance_id)
  WHERE uazapi_instance_id IS NOT NULL;
```

- [ ] **Step 2: Documente as variáveis de ambiente**

Acrescente ao final de `.env.local.example` (sem valores reais):

```bash
# ============================================================
# UAZAPI — servidor WhatsApp não-oficial (QR Code / Baileys)
#
# Credenciais do SERVIDOR, não de uma instância. O admin token
# autoriza criar/listar/deletar instâncias (header `admintoken`) e
# nunca sai do backend: as rotas em /api/whatsapp/uazapi/instances
# filtram por empresa antes de responder ao browser.
#
# Sem estas duas variáveis o painel renderiza "servidor não
# configurado" em vez de quebrar.
# ============================================================
UAZAPI_BASE_URL=
UAZAPI_ADMIN_TOKEN=
```

- [ ] **Step 3: Verifique que o SQL é válido**

Run: `npx supabase db lint --schema public` se o CLI local estiver linkado.
Se não estiver, verifique manualmente: o arquivo usa apenas `ADD COLUMN IF NOT EXISTS` e `CREATE INDEX IF NOT EXISTS`, ambos idempotentes, sem `NOT NULL` e sem default — logo é seguro em tabela populada e re-executável.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/060_uazapi_instance_id.sql .env.local.example
git commit -m "feat(uazapi): key the company-instance link on instance id"
```

---

### Task 2: Cliente UAZAPI — criar, listar, carimbar, renomear

**Files:**
- Modify: `src/lib/whatsapp/providers/uazapi.ts`
- Test: `src/lib/whatsapp/providers/uazapi.admin.test.ts` (criar)

**Interfaces:**
- Consumes: nada (só `fetch`).
- Produces:
  - `adminHeaders(adminToken: string): Record<string, string>`
  - `interface UazapiInstance { id: string; token: string; name: string; status: string; owner?: string; profileName?: string; profilePicUrl?: string; adminField01?: string; adminField02?: string; created?: string }`
  - `createInstance(args: { baseUrl: string; adminToken: string; name: string; adminField01?: string }): Promise<{ id: string; token: string }>`
  - `listInstances(args: { baseUrl: string; adminToken: string }): Promise<UazapiInstance[]>`
  - `stampAdminFields(args: { baseUrl: string; adminToken: string; id: string; adminField01: string }): Promise<void>`
  - `renameInstance(args: { baseUrl: string; token: string; name: string }): Promise<void>`
  - `setWebhook(args: { baseUrl: string; token: string; webhookUrl: string; enabled?: boolean }): Promise<void>` (assinatura estendida)

- [ ] **Step 1: Escreva os testes que falham**

Crie `src/lib/whatsapp/providers/uazapi.admin.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createInstance,
  listInstances,
  stampAdminFields,
  renameInstance,
  setWebhook,
} from './uazapi'

/**
 * Endpoints administrativos da uazapiGO v2.1.1, verificados contra um
 * servidor real em 2026-08-31. O detalhe que estes testes existem para
 * travar: o admin token vai no header `admintoken`. Mandá-lo no header
 * `token` — como o código fazia — responde 401.
 */
describe('uazapi — endpoints administrativos', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  function ok(body: unknown) {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 }),
    )
  }

  describe('createInstance', () => {
    it('autentica com o header admintoken, nunca com token', async () => {
      ok({ instance: { id: 'r1', name: 'nova' }, token: 'inst-tok' })
      await createInstance({
        baseUrl: 'https://x.uazapi.com',
        adminToken: 'admin-secret',
        name: 'nova',
      })
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://x.uazapi.com/instance/create')
      const headers = init.headers as Record<string, string>
      expect(headers.admintoken).toBe('admin-secret')
      expect(headers.token).toBeUndefined()
    })

    it('lê o token do topo da resposta', async () => {
      ok({ instance: { id: 'r1' }, token: 'top-level-token' })
      const res = await createInstance({
        baseUrl: 'https://x.uazapi.com',
        adminToken: 'a',
        name: 'nova',
      })
      expect(res.token).toBe('top-level-token')
      expect(res.id).toBe('r1')
    })

    it('cai para instance.token quando o topo não traz o token', async () => {
      ok({ instance: { id: 'r2', token: 'nested-token' } })
      const res = await createInstance({
        baseUrl: 'https://x.uazapi.com',
        adminToken: 'a',
        name: 'nova',
      })
      expect(res.token).toBe('nested-token')
      expect(res.id).toBe('r2')
    })

    it('envia adminField01 no corpo quando informado', async () => {
      ok({ instance: { id: 'r1' }, token: 't' })
      await createInstance({
        baseUrl: 'https://x.uazapi.com',
        adminToken: 'a',
        name: 'nova',
        adminField01: 'acct-123',
      })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body).toEqual({ name: 'nova', adminField01: 'acct-123' })
    })

    it('lança quando a resposta não traz token, em vez de devolver undefined', async () => {
      ok({ instance: { id: 'r1' } })
      await expect(
        createInstance({ baseUrl: 'https://x.uazapi.com', adminToken: 'a', name: 'n' }),
      ).rejects.toThrow(/token/i)
    })

    it('lança com a mensagem do servidor num erro HTTP', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: 'invalid admintoken' }), { status: 401 }),
      )
      await expect(
        createInstance({ baseUrl: 'https://x.uazapi.com', adminToken: 'bad', name: 'n' }),
      ).rejects.toThrow('invalid admintoken')
    })
  })

  describe('listInstances', () => {
    it('devolve o array do servidor', async () => {
      ok([
        { id: 'r1', name: 'smart', token: 't1', status: 'disconnected', adminField01: '' },
        { id: 'r2', name: 'Metalis', token: 't2', status: 'connected', adminField01: 'acct-a' },
      ])
      const res = await listInstances({ baseUrl: 'https://x.uazapi.com', adminToken: 'a' })
      expect(res).toHaveLength(2)
      expect(res[1].adminField01).toBe('acct-a')
    })

    it('usa o header admintoken e nunca põe o token na URL', async () => {
      ok([])
      await listInstances({ baseUrl: 'https://x.uazapi.com', adminToken: 'admin-secret' })
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://x.uazapi.com/instance/all')
      expect(url).not.toContain('admin-secret')
      expect((init.headers as Record<string, string>).admintoken).toBe('admin-secret')
    })

    it('devolve lista vazia quando o servidor responde algo que não é array', async () => {
      ok({ response: 'ok' })
      const res = await listInstances({ baseUrl: 'https://x.uazapi.com', adminToken: 'a' })
      expect(res).toEqual([])
    })
  })

  describe('stampAdminFields', () => {
    it('manda id e adminField01 com o admintoken', async () => {
      ok({ id: 'r1' })
      await stampAdminFields({
        baseUrl: 'https://x.uazapi.com',
        adminToken: 'admin-secret',
        id: 'r1',
        adminField01: 'acct-a',
      })
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://x.uazapi.com/instance/updateAdminFields')
      expect((init.headers as Record<string, string>).admintoken).toBe('admin-secret')
      expect(JSON.parse(init.body as string)).toEqual({ id: 'r1', adminField01: 'acct-a' })
    })
  })

  describe('renameInstance', () => {
    it('usa o token da instância, não o admintoken', async () => {
      ok({ id: 'r1', name: 'novo' })
      await renameInstance({
        baseUrl: 'https://x.uazapi.com',
        token: 'inst-tok',
        name: 'novo',
      })
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://x.uazapi.com/instance/updateInstanceName')
      const headers = init.headers as Record<string, string>
      expect(headers.token).toBe('inst-tok')
      expect(headers.admintoken).toBeUndefined()
      expect(JSON.parse(init.body as string)).toEqual({ name: 'novo' })
    })
  })

  describe('setWebhook', () => {
    it('habilita por padrão', async () => {
      ok({})
      await setWebhook({
        baseUrl: 'https://x.uazapi.com',
        token: 't',
        webhookUrl: 'https://crm.test/hook',
      })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.enabled).toBe(true)
      expect(body.url).toBe('https://crm.test/hook')
    })

    it('desabilita quando enabled: false — é como o bind desliga a instância anterior', async () => {
      ok({})
      await setWebhook({
        baseUrl: 'https://x.uazapi.com',
        token: 'old-tok',
        webhookUrl: 'https://crm.test/hook',
        enabled: false,
      })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.enabled).toBe(false)
    })
  })
})
```

- [ ] **Step 2: Rode os testes e confirme que falham**

Run: `npm test -- src/lib/whatsapp/providers/uazapi.admin.test.ts`
Expected: FAIL — `createInstance`, `listInstances`, `stampAdminFields`, `renameInstance` não são exportados.

- [ ] **Step 3: Implemente no cliente**

Em `src/lib/whatsapp/providers/uazapi.ts`, logo abaixo de `baseHeaders`, acrescente:

```ts
/**
 * Header do token de ADMINISTRADOR do servidor.
 *
 * Diferente de `baseHeaders`, que manda o token por-instância em
 * `token`. A uazapiGO v2.1.1 responde 401 ao admin token enviado como
 * `token` — verificado contra servidor real em 2026-08-31.
 */
function adminHeaders(adminToken: string): Record<string, string> {
  return { admintoken: adminToken, 'Content-Type': 'application/json' }
}
```

Substitua o bloco `InitInstanceArgs` / `InitInstanceResult` / `initInstance` inteiro por:

```ts
export interface CreateInstanceArgs {
  baseUrl: string
  /** Admin token do servidor. Só ele pode criar instâncias. */
  adminToken: string
  name: string
  /** Marca de posse: o `account_id` da empresa dona. */
  adminField01?: string
}

export interface CreateInstanceResult {
  id: string
  /** Token por-instância, usado em todas as chamadas seguintes. */
  token: string
}

export async function createInstance(
  args: CreateInstanceArgs,
): Promise<CreateInstanceResult> {
  const { baseUrl, adminToken, name, adminField01 } = args
  const body: Record<string, unknown> = { name }
  if (adminField01) body.adminField01 = adminField01

  const response = await fetch(`${trimBaseUrl(baseUrl)}/instance/create`, {
    method: 'POST',
    headers: adminHeaders(adminToken),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwUazapiError(response, `UAZAPI error: ${response.status}`)
  }
  const data = await response.json()
  // A resposta traz o token no topo E dentro de `instance`. Ler os dois
  // evita depender de qual das duas formas o servidor usa na versão
  // instalada.
  const token: string | undefined = data?.token ?? data?.instance?.token
  const id: string | undefined = data?.instance?.id ?? data?.id
  if (!token) throw new Error('UAZAPI did not return an instance token.')
  if (!id) throw new Error('UAZAPI did not return an instance id.')
  return { id, token }
}

/**
 * Uma instância como o servidor a descreve. `token` está presente aqui
 * porque `/instance/all` o devolve — mas ele NUNCA pode ser serializado
 * para o browser. Use `toPublicInstance` de `uazapi-ownership.ts`.
 */
export interface UazapiInstance {
  id: string
  token: string
  name: string
  status: string
  owner?: string
  profileName?: string
  profilePicUrl?: string
  adminField01?: string
  adminField02?: string
  created?: string
}

export async function listInstances(args: {
  baseUrl: string
  adminToken: string
}): Promise<UazapiInstance[]> {
  const { baseUrl, adminToken } = args
  const response = await fetch(`${trimBaseUrl(baseUrl)}/instance/all`, {
    headers: adminHeaders(adminToken),
  })
  if (!response.ok) {
    await throwUazapiError(response, `UAZAPI error: ${response.status}`)
  }
  const data = await response.json()
  return Array.isArray(data) ? (data as UazapiInstance[]) : []
}

export async function stampAdminFields(args: {
  baseUrl: string
  adminToken: string
  id: string
  adminField01: string
}): Promise<void> {
  const { baseUrl, adminToken, id, adminField01 } = args
  const response = await fetch(
    `${trimBaseUrl(baseUrl)}/instance/updateAdminFields`,
    {
      method: 'POST',
      headers: adminHeaders(adminToken),
      body: JSON.stringify({ id, adminField01 }),
    },
  )
  if (!response.ok) {
    await throwUazapiError(response, `UAZAPI error: ${response.status}`)
  }
}

export async function renameInstance(args: {
  baseUrl: string
  /** Token da instância — renomear não é operação de admin. */
  token: string
  name: string
}): Promise<void> {
  const { baseUrl, token, name } = args
  const response = await fetch(
    `${trimBaseUrl(baseUrl)}/instance/updateInstanceName`,
    {
      method: 'POST',
      headers: baseHeaders(token),
      body: JSON.stringify({ name }),
    },
  )
  if (!response.ok) {
    await throwUazapiError(response, `UAZAPI error: ${response.status}`)
  }
}
```

Depois estenda `setWebhook`. Troque a interface e o corpo por:

```ts
export interface SetWebhookArgs extends UazapiInstanceArgs {
  webhookUrl: string
  /**
   * `false` desliga a entrega sem apagar a configuração. O bind usa
   * isso na instância que deixa de ser a vinculada, para que duas
   * instâncias nunca postem na mesma URL de webhook.
   */
  enabled?: boolean
}

export async function setWebhook(args: SetWebhookArgs): Promise<void> {
  const { baseUrl, token, webhookUrl, enabled = true } = args
  const response = await fetch(`${trimBaseUrl(baseUrl)}/webhook`, {
    method: 'POST',
    headers: baseHeaders(token),
    body: JSON.stringify({
      url: webhookUrl,
      enabled,
      events: ['messages', 'messages_update'],
      excludeMessages: ['wasSentByApi'],
    }),
  })
  if (!response.ok) {
    await throwUazapiError(response, `UAZAPI error: ${response.status}`)
  }
}
```

- [ ] **Step 4: Rode os testes e confirme que passam**

Run: `npm test -- src/lib/whatsapp/providers/uazapi.admin.test.ts`
Expected: PASS, 13 testes.

- [ ] **Step 5: Conserte o único chamador de `initInstance`**

`src/app/api/whatsapp/uazapi/connect/route.ts:96` ainda chama `initInstance`. Essa rota é deletada na Task 12, mas o typecheck precisa passar agora. Troque a linha 4 e o bloco do `catch`:

```ts
import { createInstance, connectInstance, setWebhook } from '@/lib/whatsapp/providers/uazapi'
```

```ts
        const created = await createInstance({ baseUrl, adminToken: token, name: instanceName })
```

- [ ] **Step 6: Verifique tipos e lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/lib/whatsapp/providers/uazapi.ts src/lib/whatsapp/providers/uazapi.admin.test.ts src/app/api/whatsapp/uazapi/connect/route.ts
git commit -m "feat(uazapi): add admin endpoints with the admintoken header"
```

---

### Task 3: Regras de posse — funções puras

**Files:**
- Create: `src/lib/whatsapp/uazapi-ownership.ts`
- Test: `src/lib/whatsapp/uazapi-ownership.test.ts`

**Interfaces:**
- Consumes: `UazapiInstance` da Task 2.
- Produces:
  - `interface PublicInstance { id: string; name: string; status: string; owner?: string; profileName?: string; profilePicUrl?: string; created?: string }`
  - `toPublicInstance(i: UazapiInstance): PublicInstance`
  - `ownedBy(instances: UazapiInstance[], accountId: string): UazapiInstance[]`
  - `unowned(instances: UazapiInstance[]): UazapiInstance[]`
  - `findOwned(instances: UazapiInstance[], accountId: string, id: string): UazapiInstance | null`
  - `interface StampTarget { config: { uazapi_base_url?: string | null; uazapi_instance_id?: string | null; uazapi_instance_name?: string | null } | null; envBaseUrl: string }`
  - `planStamp(instances: UazapiInstance[], accountId: string, target: StampTarget): UazapiInstance | null`
  - `sameServer(a: string | null | undefined, b: string | null | undefined): boolean`

- [ ] **Step 1: Escreva os testes que falham**

Crie `src/lib/whatsapp/uazapi-ownership.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { UazapiInstance } from './providers/uazapi'
import {
  toPublicInstance,
  ownedBy,
  unowned,
  findOwned,
  planStamp,
  sameServer,
} from './uazapi-ownership'

function inst(over: Partial<UazapiInstance> = {}): UazapiInstance {
  return {
    id: 'r1',
    token: 'super-secret-token',
    name: 'Metalis',
    status: 'connected',
    owner: '5521988398031',
    profileName: 'Metalis',
    adminField01: '',
    adminField02: '',
    created: '2026-08-25T15:03:50.213Z',
    ...over,
  }
}

describe('toPublicInstance — o token nunca vai para o browser', () => {
  it('não inclui token nem campos administrativos no payload público', () => {
    const pub = toPublicInstance(
      inst({ adminField01: 'acct-a', adminField02: 'nota interna' }),
    )
    expect(pub).not.toHaveProperty('token')
    expect(pub).not.toHaveProperty('adminField01')
    expect(pub).not.toHaveProperty('adminField02')
    expect(pub).not.toHaveProperty('openai_apikey')
  })

  it('não vaza o token nem quando a instância traz chaves extras do servidor', () => {
    const withExtras = {
      ...inst(),
      openai_apikey: 'sk-secret',
      chatbot_enabled: true,
    } as unknown as UazapiInstance
    const serialized = JSON.stringify(toPublicInstance(withExtras))
    expect(serialized).not.toContain('super-secret-token')
    expect(serialized).not.toContain('sk-secret')
  })

  it('preserva os campos que a UI precisa', () => {
    const pub = toPublicInstance(inst())
    expect(pub).toEqual({
      id: 'r1',
      name: 'Metalis',
      status: 'connected',
      owner: '5521988398031',
      profileName: 'Metalis',
      profilePicUrl: undefined,
      created: '2026-08-25T15:03:50.213Z',
    })
  })
})

describe('ownedBy / unowned / findOwned', () => {
  const all = [
    inst({ id: 'r1', name: 'smart', adminField01: '' }),
    inst({ id: 'r2', name: 'Metalis', adminField01: 'acct-a' }),
    inst({ id: 'r3', name: 'Connect', adminField01: 'acct-b' }),
  ]

  it('devolve só as da empresa', () => {
    expect(ownedBy(all, 'acct-a').map((i) => i.id)).toEqual(['r2'])
  })

  it('não trata carimbo vazio como pertencente a ninguém em particular', () => {
    expect(ownedBy(all, '').map((i) => i.id)).toEqual([])
  })

  it('lista as órfãs, tratando ausente e string vazia como órfã', () => {
    const withMissing = [...all, inst({ id: 'r4', adminField01: undefined })]
    expect(unowned(withMissing).map((i) => i.id)).toEqual(['r1', 'r4'])
  })

  it('acha a instância da empresa pelo id', () => {
    expect(findOwned(all, 'acct-a', 'r2')?.name).toBe('Metalis')
  })

  it('recusa a instância de outra empresa — esta é a fronteira de segurança', () => {
    expect(findOwned(all, 'acct-a', 'r3')).toBeNull()
  })

  it('recusa uma instância órfã: possuir exige carimbo', () => {
    expect(findOwned(all, 'acct-a', 'r1')).toBeNull()
  })

  it('devolve null para id inexistente', () => {
    expect(findOwned(all, 'acct-a', 'nope')).toBeNull()
  })
})

describe('sameServer', () => {
  it('ignora barra final e caixa do host', () => {
    expect(sameServer('https://newphone.uazapi.com/', 'https://newphone.uazapi.com')).toBe(true)
    expect(sameServer('https://NewPhone.uazapi.com', 'https://newphone.uazapi.com')).toBe(true)
  })

  it('distingue servidores diferentes', () => {
    expect(sameServer('https://old.uazapi.com', 'https://newphone.uazapi.com')).toBe(false)
  })

  it('é falso quando algum lado falta', () => {
    expect(sameServer(null, 'https://x.uazapi.com')).toBe(false)
    expect(sameServer('https://x.uazapi.com', undefined)).toBe(false)
  })
})

describe('planStamp — adoção da instância legada', () => {
  const env = 'https://newphone.uazapi.com'
  const orphan = inst({ id: 'r9', name: 'Metalis', adminField01: '' })

  it('adota pelo id quando a linha já tem uazapi_instance_id', () => {
    const target = {
      config: { uazapi_base_url: env, uazapi_instance_id: 'r9', uazapi_instance_name: 'nome-antigo' },
      envBaseUrl: env,
    }
    expect(planStamp([orphan], 'acct-a', target)?.id).toBe('r9')
  })

  it('adota pelo nome quando a linha é legada e não tem id', () => {
    const target = {
      config: { uazapi_base_url: env, uazapi_instance_id: null, uazapi_instance_name: 'Metalis' },
      envBaseUrl: env,
    }
    expect(planStamp([orphan], 'acct-a', target)?.id).toBe('r9')
  })

  it('NÃO adota quando a empresa aponta para outro servidor, mesmo com nome igual', () => {
    // Sem esta guarda, uma empresa em old.uazapi.com reivindicaria uma
    // instância homônima do servidor do env — de outra empresa.
    const target = {
      config: { uazapi_base_url: 'https://old.uazapi.com', uazapi_instance_id: null, uazapi_instance_name: 'Metalis' },
      envBaseUrl: env,
    }
    expect(planStamp([orphan], 'acct-a', target)).toBeNull()
  })

  it('nunca sobrescreve o carimbo de outra empresa', () => {
    const taken = inst({ id: 'r9', name: 'Metalis', adminField01: 'acct-b' })
    const target = {
      config: { uazapi_base_url: env, uazapi_instance_id: 'r9', uazapi_instance_name: 'Metalis' },
      envBaseUrl: env,
    }
    expect(planStamp([taken], 'acct-a', target)).toBeNull()
  })

  it('é idempotente: nada a fazer quando já está carimbada para a própria empresa', () => {
    const mine = inst({ id: 'r9', adminField01: 'acct-a' })
    const target = {
      config: { uazapi_base_url: env, uazapi_instance_id: 'r9', uazapi_instance_name: 'Metalis' },
      envBaseUrl: env,
    }
    expect(planStamp([mine], 'acct-a', target)).toBeNull()
  })

  it('não faz nada quando a empresa não tem config UAZAPI', () => {
    expect(planStamp([orphan], 'acct-a', { config: null, envBaseUrl: env })).toBeNull()
  })

  it('não adota por nome quando a linha tem id que não casa com ninguém', () => {
    // Id é a chave: existindo id, o nome não serve de desempate.
    const target = {
      config: { uazapi_base_url: env, uazapi_instance_id: 'r-outro', uazapi_instance_name: 'Metalis' },
      envBaseUrl: env,
    }
    expect(planStamp([orphan], 'acct-a', target)).toBeNull()
  })
})
```

- [ ] **Step 2: Rode e confirme que falham**

Run: `npm test -- src/lib/whatsapp/uazapi-ownership.test.ts`
Expected: FAIL — módulo `./uazapi-ownership` não existe.

- [ ] **Step 3: Implemente**

Crie `src/lib/whatsapp/uazapi-ownership.ts`:

```ts
// ============================================================
// Quem é dono de qual instância UAZAPI.
//
// Tudo aqui é função pura sobre a lista que `/instance/all` devolve.
// A IO (buscar a lista, gravar o carimbo) vive em `uazapi-admin.ts`;
// separar as duas coisas deixa a regra de posse — que é a fronteira de
// segurança do painel — testável sem rede nem banco.
//
// A posse é `adminField01 === account_id`. Esse campo só pode ser
// escrito por quem tem o admintoken, e só o backend o tem, então ele
// não é falsificável a partir do browser.
// ============================================================

import type { UazapiInstance } from './providers/uazapi'

/**
 * O ÚNICO formato que pode ser serializado para o browser.
 *
 * `/instance/all` devolve o token de toda instância do servidor,
 * inclusive as de outras empresas. Montar o payload por lista de
 * inclusão (e não removendo campos) garante que uma chave nova no
 * retorno do servidor não vaze sozinha.
 */
export interface PublicInstance {
  id: string
  name: string
  status: string
  owner?: string
  profileName?: string
  profilePicUrl?: string
  created?: string
}

export function toPublicInstance(i: UazapiInstance): PublicInstance {
  return {
    id: i.id,
    name: i.name,
    status: i.status,
    owner: i.owner,
    profileName: i.profileName,
    profilePicUrl: i.profilePicUrl,
    created: i.created,
  }
}

/** Normaliza uma base URL para comparação: sem barra final, host em minúsculas. */
function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase()
}

export function sameServer(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false
  return normalizeBaseUrl(a) === normalizeBaseUrl(b)
}

export function ownedBy(
  instances: UazapiInstance[],
  accountId: string,
): UazapiInstance[] {
  if (!accountId) return []
  return instances.filter((i) => i.adminField01 === accountId)
}

export function unowned(instances: UazapiInstance[]): UazapiInstance[] {
  return instances.filter((i) => !i.adminField01)
}

/**
 * A checagem de posse. Devolve `null` — nunca a instância — quando ela
 * é de outra empresa ou órfã; quem chama traduz isso em 403.
 */
export function findOwned(
  instances: UazapiInstance[],
  accountId: string,
  id: string,
): UazapiInstance | null {
  if (!accountId || !id) return null
  return instances.find((i) => i.id === id && i.adminField01 === accountId) ?? null
}

export interface StampTarget {
  config: {
    uazapi_base_url?: string | null
    uazapi_instance_id?: string | null
    uazapi_instance_name?: string | null
  } | null
  envBaseUrl: string
}

/**
 * Decide qual instância órfã deve receber o `account_id` desta empresa.
 *
 * Existe porque as instâncias criadas antes do painel não têm
 * `adminField01`, e sem adoção o painel abriria vazio para quem já usa
 * o CRM. Adota no máximo uma: aquela que a própria `whatsapp_config` já
 * aponta.
 *
 * Duas guardas que não podem ser afrouxadas:
 *
 *  - servidor igual. Uma empresa apontada para outro servidor UAZAPI
 *    não pode reivindicar uma instância homônima daqui.
 *  - carimbo vazio. Instância de outra empresa nunca é tocada.
 *
 * Devolve `null` quando não há nada a fazer, inclusive no caso comum de
 * já estar carimbada — o que torna a operação idempotente.
 */
export function planStamp(
  instances: UazapiInstance[],
  accountId: string,
  target: StampTarget,
): UazapiInstance | null {
  const { config, envBaseUrl } = target
  if (!config || !accountId) return null
  if (!sameServer(config.uazapi_base_url, envBaseUrl)) return null

  // O id é a chave. Existindo, o nome não desempata.
  const candidate = config.uazapi_instance_id
    ? instances.find((i) => i.id === config.uazapi_instance_id)
    : config.uazapi_instance_name
      ? instances.find((i) => i.name === config.uazapi_instance_name)
      : undefined

  if (!candidate) return null
  if (candidate.adminField01) return null // já tem dono — inclusive esta empresa
  return candidate
}
```

- [ ] **Step 4: Rode e confirme que passam**

Run: `npm test -- src/lib/whatsapp/uazapi-ownership.test.ts`
Expected: PASS, 20 testes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/whatsapp/uazapi-ownership.ts src/lib/whatsapp/uazapi-ownership.test.ts
git commit -m "feat(uazapi): pure ownership rules for instance panel"
```

---

### Task 4: Camada administrativa — env, listagem e guardas

**Files:**
- Create: `src/lib/whatsapp/uazapi-admin.ts`
- Test: `src/lib/whatsapp/uazapi-admin.test.ts`

**Interfaces:**
- Consumes: Task 2 (`listInstances`, `stampAdminFields`, `UazapiInstance`), Task 3 (todas), `ForbiddenError` de `@/lib/auth/account`.
- Produces:
  - `interface UazapiServer { baseUrl: string; adminToken: string }`
  - `getUazapiServer(): UazapiServer | null`
  - `loadInstances(server: UazapiServer): Promise<UazapiInstance[]>`
  - `adoptForAccount(server: UazapiServer, instances: UazapiInstance[], accountId: string, target: StampTarget): Promise<UazapiInstance[]>`
  - `requireOwnedInstance(server: UazapiServer, accountId: string, id: string): Promise<UazapiInstance>`
  - `requireUnownedInstance(server: UazapiServer, id: string): Promise<UazapiInstance>`
  - `isSuperAdmin(supabase: SupabaseClient, userId: string): Promise<boolean>`

- [ ] **Step 1: Escreva os testes que falham**

Crie `src/lib/whatsapp/uazapi-admin.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UazapiInstance } from './providers/uazapi'

// `@/lib/auth/account` importa `@/lib/supabase/server`, que lê
// next/headers no carregamento do módulo. Sem este mock o arquivo de
// teste nem chega a executar — é o mesmo tratamento que
// src/lib/auth/account.test.ts:65 já faz.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

const listInstances = vi.fn()
const stampAdminFields = vi.fn()

vi.mock('./providers/uazapi', () => ({
  listInstances: (...a: unknown[]) => listInstances(...a),
  stampAdminFields: (...a: unknown[]) => stampAdminFields(...a),
}))

import {
  getUazapiServer,
  loadInstances,
  adoptForAccount,
  requireOwnedInstance,
  requireUnownedInstance,
} from './uazapi-admin'
import { ForbiddenError } from '@/lib/auth/account'

function inst(over: Partial<UazapiInstance> = {}): UazapiInstance {
  return {
    id: 'r1',
    token: 'tok',
    name: 'Metalis',
    status: 'connected',
    adminField01: '',
    ...over,
  }
}

const server = { baseUrl: 'https://newphone.uazapi.com', adminToken: 'admin' }

describe('getUazapiServer', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    delete process.env.UAZAPI_BASE_URL
    delete process.env.UAZAPI_ADMIN_TOKEN
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  it('devolve null quando falta a base URL', () => {
    process.env.UAZAPI_ADMIN_TOKEN = 'a'
    expect(getUazapiServer()).toBeNull()
  })

  it('devolve null quando falta o admin token', () => {
    process.env.UAZAPI_BASE_URL = 'https://x.uazapi.com'
    expect(getUazapiServer()).toBeNull()
  })

  it('devolve null quando as variáveis existem mas estão vazias', () => {
    process.env.UAZAPI_BASE_URL = '   '
    process.env.UAZAPI_ADMIN_TOKEN = ''
    expect(getUazapiServer()).toBeNull()
  })

  it('devolve o servidor quando as duas estão preenchidas', () => {
    process.env.UAZAPI_BASE_URL = 'https://x.uazapi.com'
    process.env.UAZAPI_ADMIN_TOKEN = 'secret'
    expect(getUazapiServer()).toEqual({
      baseUrl: 'https://x.uazapi.com',
      adminToken: 'secret',
    })
  })
})

describe('requireOwnedInstance — a fronteira de 403', () => {
  beforeEach(() => {
    listInstances.mockReset()
    stampAdminFields.mockReset()
  })

  it('devolve a instância da própria empresa, com token', async () => {
    listInstances.mockResolvedValue([inst({ id: 'r2', adminField01: 'acct-a', token: 'inst-tok' })])
    const got = await requireOwnedInstance(server, 'acct-a', 'r2')
    expect(got.token).toBe('inst-tok')
  })

  it('lança ForbiddenError para instância de outra empresa', async () => {
    listInstances.mockResolvedValue([inst({ id: 'r2', adminField01: 'acct-b' })])
    await expect(requireOwnedInstance(server, 'acct-a', 'r2')).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('lança ForbiddenError para instância órfã', async () => {
    listInstances.mockResolvedValue([inst({ id: 'r2', adminField01: '' })])
    await expect(requireOwnedInstance(server, 'acct-a', 'r2')).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('lança ForbiddenError para id inexistente, sem distinguir de "não é sua"', async () => {
    listInstances.mockResolvedValue([])
    await expect(requireOwnedInstance(server, 'acct-a', 'sumiu')).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})

describe('requireUnownedInstance — usada só por /assign', () => {
  beforeEach(() => listInstances.mockReset())

  it('devolve a instância órfã', async () => {
    listInstances.mockResolvedValue([inst({ id: 'r1', adminField01: '' })])
    expect((await requireUnownedInstance(server, 'r1')).id).toBe('r1')
  })

  it('recusa uma instância que já tem dono', async () => {
    listInstances.mockResolvedValue([inst({ id: 'r1', adminField01: 'acct-b' })])
    await expect(requireUnownedInstance(server, 'r1')).rejects.toThrow(/already/i)
  })
})

describe('adoptForAccount — grava o carimbo decidido por planStamp', () => {
  const env = 'https://newphone.uazapi.com'
  beforeEach(() => {
    listInstances.mockReset()
    stampAdminFields.mockReset()
  })

  it('carimba a órfã que a config já aponta e a devolve como possuída', async () => {
    const instances = [inst({ id: 'r9', name: 'Metalis', adminField01: '' })]
    const out = await adoptForAccount(server, instances, 'acct-a', {
      config: { uazapi_base_url: env, uazapi_instance_id: 'r9', uazapi_instance_name: 'Metalis' },
      envBaseUrl: env,
    })
    expect(stampAdminFields).toHaveBeenCalledWith({
      baseUrl: server.baseUrl,
      adminToken: server.adminToken,
      id: 'r9',
      adminField01: 'acct-a',
    })
    expect(out.map((i) => i.id)).toEqual(['r9'])
  })

  it('não grava nada quando não há o que adotar', async () => {
    const instances = [inst({ id: 'r9', adminField01: 'acct-b' })]
    const out = await adoptForAccount(server, instances, 'acct-a', {
      config: { uazapi_base_url: env, uazapi_instance_id: 'r9', uazapi_instance_name: 'Metalis' },
      envBaseUrl: env,
    })
    expect(stampAdminFields).not.toHaveBeenCalled()
    expect(out).toEqual([])
  })

  it('não deixa uma falha do carimbo derrubar a listagem', async () => {
    stampAdminFields.mockRejectedValue(new Error('uazapi fora do ar'))
    const instances = [inst({ id: 'r9', name: 'Metalis', adminField01: '' })]
    const out = await adoptForAccount(server, instances, 'acct-a', {
      config: { uazapi_base_url: env, uazapi_instance_id: 'r9', uazapi_instance_name: 'Metalis' },
      envBaseUrl: env,
    })
    // O carimbo é oportunista; o painel ainda deve abrir.
    expect(out).toEqual([])
  })
})

describe('loadInstances', () => {
  beforeEach(() => listInstances.mockReset())

  it('repassa as credenciais do servidor', async () => {
    listInstances.mockResolvedValue([])
    await loadInstances(server)
    expect(listInstances).toHaveBeenCalledWith({
      baseUrl: server.baseUrl,
      adminToken: server.adminToken,
    })
  })
})
```

- [ ] **Step 2: Rode e confirme que falham**

Run: `npm test -- src/lib/whatsapp/uazapi-admin.test.ts`
Expected: FAIL — módulo `./uazapi-admin` não existe.

- [ ] **Step 3: Implemente**

Crie `src/lib/whatsapp/uazapi-admin.ts`:

```ts
// ============================================================
// Acesso administrativo ao servidor UAZAPI.
//
// O admin token vem do ambiente e nunca sai do backend. É ele que
// torna o filtro por empresa uma fronteira real: sem ele na mão do
// usuário, ninguém contorna o CRM chamando a UAZAPI direto.
//
// As regras de posse são puras e vivem em `uazapi-ownership.ts`; aqui
// ficam só o env, a IO e a tradução de "não é sua" em ForbiddenError.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { ForbiddenError } from '@/lib/auth/account'
import {
  listInstances,
  stampAdminFields,
  type UazapiInstance,
} from './providers/uazapi'
import { findOwned, ownedBy, planStamp, type StampTarget } from './uazapi-ownership'

export interface UazapiServer {
  baseUrl: string
  adminToken: string
}

/**
 * `null` quando o servidor não está configurado. As rotas traduzem isso
 * em `{ configured: false }` com 200 — é um estado da tela, não um erro.
 */
export function getUazapiServer(): UazapiServer | null {
  const baseUrl = process.env.UAZAPI_BASE_URL?.trim()
  const adminToken = process.env.UAZAPI_ADMIN_TOKEN?.trim()
  if (!baseUrl || !adminToken) return null
  return { baseUrl, adminToken }
}

export async function loadInstances(server: UazapiServer): Promise<UazapiInstance[]> {
  return listInstances({ baseUrl: server.baseUrl, adminToken: server.adminToken })
}

/**
 * Carimba a instância legada da empresa, se houver, e devolve as
 * instâncias que ela possui depois disso.
 *
 * O carimbo é oportunista: uma falha aqui não pode impedir o painel de
 * abrir, então ela é registrada e engolida.
 */
export async function adoptForAccount(
  server: UazapiServer,
  instances: UazapiInstance[],
  accountId: string,
  target: StampTarget,
): Promise<UazapiInstance[]> {
  const toStamp = planStamp(instances, accountId, target)
  if (toStamp) {
    try {
      await stampAdminFields({
        baseUrl: server.baseUrl,
        adminToken: server.adminToken,
        id: toStamp.id,
        adminField01: accountId,
      })
      toStamp.adminField01 = accountId
    } catch (err) {
      console.error(
        '[uazapi-admin] falha ao carimbar posse da instância',
        toStamp.id,
        err instanceof Error ? err.message : err,
      )
    }
  }
  return ownedBy(instances, accountId)
}

/**
 * A checagem que toda rota `[id]` faz antes de qualquer efeito.
 *
 * Instância de outra empresa, órfã e inexistente colapsam no mesmo 403:
 * distinguir os casos contaria ao chamador o que existe no servidor.
 */
export async function requireOwnedInstance(
  server: UazapiServer,
  accountId: string,
  id: string,
): Promise<UazapiInstance> {
  const instances = await loadInstances(server)
  const found = findOwned(instances, accountId, id)
  if (!found) {
    throw new ForbiddenError('This instance does not belong to your company')
  }
  return found
}

/**
 * Só `/assign` usa isto: atribuir opera por definição sobre uma
 * instância sem dono, então ela não pode passar por
 * `requireOwnedInstance`, que a recusaria.
 */
export async function requireUnownedInstance(
  server: UazapiServer,
  id: string,
): Promise<UazapiInstance> {
  const instances = await loadInstances(server)
  const found = instances.find((i) => i.id === id)
  if (!found) throw new ForbiddenError('Instance not found')
  if (found.adminField01) {
    throw new ForbiddenError('This instance is already assigned to a company')
  }
  return found
}

export async function isSuperAdmin(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('profiles')
    .select('is_super_admin')
    .eq('user_id', userId)
    .maybeSingle()
  return data?.is_super_admin === true
}
```

- [ ] **Step 4: Rode e confirme que passam**

Run: `npm test -- src/lib/whatsapp/uazapi-admin.test.ts`
Expected: PASS, 14 testes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/whatsapp/uazapi-admin.ts src/lib/whatsapp/uazapi-admin.test.ts
git commit -m "feat(uazapi): server credentials and ownership guards"
```

---

### Task 5: Correções defensivas fora do painel

**Files:**
- Modify: `src/lib/whatsapp/send-message.ts:280`
- Modify: `src/app/api/whatsapp/config/route.ts:553`, `:577`
- Test: `src/lib/whatsapp/send-message.uazapi-token.test.ts` (criar)

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: nenhuma API nova. Duas correções de comportamento das quais as Tasks 7 e 9 dependem.

**Por que agora:** a Task 9 (`DELETE /[id]`) deixa a linha com `provider='uazapi'` e `uazapi_token = NULL`. Sem a guarda deste passo, o próximo envio estoura `TypeError: Cannot read properties of null (reading 'split')` dentro de `decrypt`, e o chamador recebe 500 opaco.

- [ ] **Step 1: Escreva o teste que falha**

Crie `src/lib/whatsapp/send-message.uazapi-token.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { sendMessageToConversation, SendMessageError } from './send-message'

/**
 * Deletar a instância vinculada pelo painel zera `uazapi_token` mas
 * mantém a linha com `provider = 'uazapi'` (é UNIQUE(account_id) e
 * carrega outros campos). O envio precisa dizer "não configurado", não
 * estourar dentro do decrypt.
 */
function dbWith(config: Record<string, unknown>): SupabaseClient {
  const conversation = {
    id: 'cv-1',
    account_id: 'acct-a',
    contact: { id: 'ct-1', phone: '+5521999999999' },
  }
  return {
    from(table: string) {
      const result =
        table === 'conversations'
          ? { data: conversation, error: null }
          : { data: config, error: null }
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => result,
        maybeSingle: async () => result,
      }
      return chain
    },
  } as unknown as SupabaseClient
}

describe('sendMessageToConversation — config uazapi sem token', () => {
  const params = { conversationId: 'cv-1', messageType: 'text', contentText: 'oi' }

  it('responde whatsapp_not_configured quando uazapi_token é null', async () => {
    const db = dbWith({
      id: 'cfg-1',
      account_id: 'acct-a',
      provider: 'uazapi',
      uazapi_token: null,
      uazapi_base_url: 'https://x.uazapi.com',
    })
    await expect(
      sendMessageToConversation(db, 'acct-a', params),
    ).rejects.toBeInstanceOf(SendMessageError)
    await sendMessageToConversation(db, 'acct-a', params).catch(
      (e: SendMessageError) => {
        expect(e.code).toBe('whatsapp_not_configured')
        expect(e.status).toBe(400)
      },
    )
  })

  it('responde whatsapp_not_configured quando uazapi_token é string vazia', async () => {
    const db = dbWith({
      id: 'cfg-1',
      account_id: 'acct-a',
      provider: 'uazapi',
      uazapi_token: '',
      uazapi_base_url: 'https://x.uazapi.com',
    })
    await sendMessageToConversation(db, 'acct-a', params).catch(
      (e: SendMessageError) => {
        expect(e.code).toBe('whatsapp_not_configured')
      },
    )
  })
})
```

`SendMessageError` expõe `code` e `status` como readonly (`src/lib/whatsapp/send-message.ts:62-71`), então as asserções acima estão corretas como escritas.

- [ ] **Step 2: Rode e confirme que falha**

Run: `npm test -- src/lib/whatsapp/send-message.uazapi-token.test.ts`
Expected: FAIL com `TypeError: Cannot read properties of null (reading 'split')`, vindo de `decrypt`.

- [ ] **Step 3: Adicione a guarda**

Em `src/lib/whatsapp/send-message.ts`, imediatamente **antes** da linha
`const accessToken = isMeta ? decrypt(config.access_token) : '';`:

```ts
  // O painel de instâncias pode deixar a linha com provider 'uazapi' e
  // token nulo (instância vinculada deletada). `decrypt(null)` estoura
  // um TypeError e vira 500; o chamador precisa do mesmo 400 que
  // qualquer outra config incompleta produz.
  if (isUazapi && !config.uazapi_token) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }
```

- [ ] **Step 4: Rode e confirme que passa**

Run: `npm test -- src/lib/whatsapp/send-message.uazapi-token.test.ts`
Expected: PASS, 2 testes.

- [ ] **Step 5: Faça as duas guardas de 409 falharem fechadas**

Em `src/app/api/whatsapp/config/route.ts`, a primeira guarda (linha ~553) descarta o erro da consulta. Troque:

```ts
    const { data: claimed } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id, accounts(name)')
      .eq('uazapi_instance_name', resolvedInstance)
      .neq('account_id', accountId)
      .maybeSingle()
```

por:

```ts
    // O erro NÃO pode ser descartado. Com o painel de instâncias, duas
    // linhas com o mesmo nome de instância passam a ser alcançáveis, e
    // aí `maybeSingle()` devolve PGRST116 com data: null — a guarda
    // falharia aberta exatamente no caso para o qual foi escrita.
    const { data: claimed, error: claimedError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id, accounts(name)')
      .eq('uazapi_instance_name', resolvedInstance)
      .neq('account_id', accountId)
      .maybeSingle()

    if (claimedError) {
      console.error('[whatsapp/config] claim check failed:', claimedError)
      return NextResponse.json(
        {
          error:
            'Não foi possível verificar se esta instância já pertence a outra empresa. ' +
            'Tente novamente.',
        },
        { status: 503 }
      )
    }
```

Faça o mesmo na segunda guarda (linha ~577). Troque:

```ts
    const { data: current } = await supabase
      .from('whatsapp_config')
      .select('uazapi_instance_name, status')
      .eq('account_id', accountId)
      .maybeSingle()
```

por:

```ts
    const { data: current, error: currentError } = await supabase
      .from('whatsapp_config')
      .select('uazapi_instance_name, status')
      .eq('account_id', accountId)
      .maybeSingle()

    if (currentError) {
      console.error('[whatsapp/config] current config check failed:', currentError)
      return NextResponse.json(
        {
          error:
            'Não foi possível verificar a configuração atual desta empresa. ' +
            'Tente novamente.',
        },
        { status: 503 }
      )
    }
```

- [ ] **Step 6: Rode a suíte inteira, typecheck e lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: tudo passa. Se algum teste existente de `config/route` quebrar por causa do 503, ajuste o teste — o comportamento novo é o correto.

- [ ] **Step 7: Commit**

```bash
git add src/lib/whatsapp/send-message.ts src/lib/whatsapp/send-message.uazapi-token.test.ts src/app/api/whatsapp/config/route.ts
git commit -m "fix(whatsapp): guard null uazapi token and fail closed on guard queries"
```

---

### Task 6: Rota de coleção — listar e criar

**Files:**
- Create: `src/app/api/whatsapp/uazapi/instances/route.ts`

**Interfaces:**
- Consumes: Task 4 (`getUazapiServer`, `loadInstances`, `adoptForAccount`, `isSuperAdmin`), Task 3 (`toPublicInstance`, `unowned`), Task 2 (`createInstance`).
- Produces:
  - `GET` → `{ configured: boolean; instances: PublicInstance[]; boundInstanceId: string | null; otherServer?: boolean; unowned?: PublicInstance[]; accounts?: { id: string; name: string }[] }` — `unowned` e `accounts` só para super admin.
  - `POST` body `{ name: string }` → `{ instance: PublicInstance }`

- [ ] **Step 1: Leia o guia de route handlers**

Run: `sed -n '70,120p' node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
Confirme a assinatura antes de escrever. Rotas de coleção não têm `params`.

- [ ] **Step 2: Implemente a rota**

Crie `src/app/api/whatsapp/uazapi/instances/route.ts`:

```ts
import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { createInstance } from '@/lib/whatsapp/providers/uazapi'
import {
  adoptForAccount,
  getUazapiServer,
  isSuperAdmin,
  loadInstances,
} from '@/lib/whatsapp/uazapi-admin'
import { sameServer, toPublicInstance, unowned } from '@/lib/whatsapp/uazapi-ownership'

/**
 * GET /api/whatsapp/uazapi/instances
 *
 * As instâncias UAZAPI desta empresa. A lista completa do servidor —
 * que traz o token de toda instância, de toda empresa — é buscada aqui
 * e filtrada aqui; para o browser só vai `PublicInstance`.
 */
export async function GET() {
  try {
    const { supabase, userId, accountId } = await requireRole('admin')

    const server = getUazapiServer()
    if (!server) {
      return NextResponse.json({ configured: false, instances: [], boundInstanceId: null })
    }

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('provider, uazapi_base_url, uazapi_instance_id, uazapi_instance_name')
      .eq('account_id', accountId)
      .maybeSingle()

    const all = await loadInstances(server)
    const owned = await adoptForAccount(server, all, accountId, {
      config: config ?? null,
      envBaseUrl: server.baseUrl,
    })

    // Uma empresa cuja config aponta para outro servidor veria um painel
    // vazio sem explicação. Diga isso em vez de deixá-la adivinhar.
    const otherServer =
      config?.provider === 'uazapi' &&
      !!config.uazapi_base_url &&
      !sameServer(config.uazapi_base_url, server.baseUrl)

    const body: Record<string, unknown> = {
      configured: true,
      instances: owned.map(toPublicInstance),
      boundInstanceId: config?.uazapi_instance_id ?? null,
      otherServer,
    }

    // Super admin também recebe as órfãs e a lista de empresas, para
    // poder atribuí-las. Sem a lista de empresas o bloco "Sem empresa"
    // exigiria digitar um UUID na mão — que é como um account_id errado
    // entraria no adminField01.
    if (await isSuperAdmin(supabase, userId)) {
      body.unowned = unowned(all).map(toPublicInstance)
      const { data: accounts } = await supabase
        .from('accounts')
        .select('id, name')
        .order('name')
      body.accounts = accounts ?? []
    }

    return NextResponse.json(body)
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/whatsapp/uazapi/instances
 *
 * Cria uma instância e a marca como desta empresa. NÃO vincula: a
 * linha `whatsapp_config` é compartilhada com o provider Meta, e
 * escrevê-la aqui apagaria silenciosamente um canal oficial em uso.
 * Vincular é sempre explícito, via POST /[id]/bind.
 */
export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')

    const server = getUazapiServer()
    if (!server) {
      return NextResponse.json({ error: 'uazapi_not_configured' }, { status: 503 })
    }

    const payload = (await request.json().catch(() => ({}))) as { name?: string }
    const name = payload.name?.trim()
    if (!name) {
      return NextResponse.json({ error: 'name_required' }, { status: 400 })
    }

    const created = await createInstance({
      baseUrl: server.baseUrl,
      adminToken: server.adminToken,
      name,
      adminField01: accountId,
    })

    return NextResponse.json({
      instance: {
        id: created.id,
        name,
        status: 'disconnected',
      },
    })
  } catch (err) {
    if (err instanceof Error && !('status' in err)) {
      console.error('[uazapi/instances] create failed:', err.message)
      return NextResponse.json({ error: 'uazapi_error', message: err.message }, { status: 502 })
    }
    return toErrorResponse(err)
  }
}
```

- [ ] **Step 3: Verifique tipos e lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.

- [ ] **Step 4: Teste manualmente contra o servidor real**

Suba `npm run dev`, autentique como owner/admin e:

```bash
curl -s -b cookies.txt http://localhost:3000/api/whatsapp/uazapi/instances | jq
```

Expected: `configured: true`. Confirme que **nenhum** objeto em `instances` nem em `unowned` tem a chave `token`:

```bash
curl -s -b cookies.txt http://localhost:3000/api/whatsapp/uazapi/instances | grep -c '"token"'
```

Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/whatsapp/uazapi/instances/route.ts
git commit -m "feat(uazapi): list and create instances scoped to the company"
```

---

### Task 7: Rota de vínculo — `POST /[id]/bind`

**Files:**
- Create: `src/app/api/whatsapp/uazapi/instances/[id]/bind/route.ts`
- Test: `src/app/api/whatsapp/uazapi/instances/bind-guards.test.ts` (criar)

**Interfaces:**
- Consumes: Task 4 (`getUazapiServer`, `requireOwnedInstance`), Task 2 (`setWebhook`), `encrypt`/`decrypt`.
- Produces:
  - `POST` body `{ replace_existing?: boolean }` → `{ success: true }` ou 409 `{ error, requires_confirmation: true, ... }`
  - De `src/lib/whatsapp/uazapi-bind.ts`, testáveis sem HTTP:
    - `decideBindConflict(args: { current: BindCurrentConfig | null; newInstanceId: string; newInstanceName: string; replaceExisting: boolean }): BindConflict | null`
    - `buildBindRow(args: { baseUrl: string; instance: { id: string; name: string; token: string; status: string }; encryptToken: (raw: string) => string; now?: Date }): BindRow`
    - `buildBindInsert(row: BindRow, accountId: string, userId: string): BindRow & { account_id: string; user_id: string }`

- [ ] **Step 1: Escreva o teste da decisão de conflito**

Crie `src/app/api/whatsapp/uazapi/instances/bind-guards.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decideBindConflict } from '@/lib/whatsapp/uazapi-bind'

/**
 * Três formas de um bind destruir algo em uso. Todas viram 409 com
 * `requires_confirmation`, e nenhuma pode ser silenciosa.
 */
describe('decideBindConflict', () => {
  const base = {
    newInstanceId: 'r-new',
    newInstanceName: 'Carolina',
    replaceExisting: false,
  }

  it('libera quando a empresa não tem config nenhuma', () => {
    expect(decideBindConflict({ ...base, current: null })).toBeNull()
  })

  it('libera quando já está vinculada à mesma instância', () => {
    const current = {
      provider: 'uazapi',
      status: 'connected',
      uazapi_instance_id: 'r-new',
      uazapi_instance_name: 'Carolina',
      phone_number_id: null,
    }
    expect(decideBindConflict({ ...base, current })).toBeNull()
  })

  it('bloqueia a troca de uma instância uazapi conectada', () => {
    const current = {
      provider: 'uazapi',
      status: 'connected',
      uazapi_instance_id: 'r-old',
      uazapi_instance_name: 'Metalis',
      phone_number_id: null,
    }
    const conflict = decideBindConflict({ ...base, current })
    expect(conflict?.reason).toBe('replace_uazapi')
    expect(conflict?.currentInstanceName).toBe('Metalis')
  })

  it('libera a troca quando o chamador confirmou', () => {
    const current = {
      provider: 'uazapi',
      status: 'connected',
      uazapi_instance_id: 'r-old',
      uazapi_instance_name: 'Metalis',
      phone_number_id: null,
    }
    expect(
      decideBindConflict({ ...base, current, replaceExisting: true }),
    ).toBeNull()
  })

  it('libera a troca de uma instância uazapi desconectada sem confirmação', () => {
    const current = {
      provider: 'uazapi',
      status: 'disconnected',
      uazapi_instance_id: 'r-old',
      uazapi_instance_name: 'Metalis',
      phone_number_id: null,
    }
    expect(decideBindConflict({ ...base, current })).toBeNull()
  })

  it('bloqueia sobrescrever uma config Meta preenchida', () => {
    // Sem isto, um clique em "Vincular" apaga o canal oficial da
    // empresa: o write zera phone_number_id e waba_id.
    const current = {
      provider: 'meta',
      status: 'connected',
      uazapi_instance_id: null,
      uazapi_instance_name: null,
      phone_number_id: '123456789',
    }
    const conflict = decideBindConflict({ ...base, current })
    expect(conflict?.reason).toBe('replace_meta')
  })

  it('libera quando a linha é Meta mas está vazia', () => {
    const current = {
      provider: 'meta',
      status: 'disconnected',
      uazapi_instance_id: null,
      uazapi_instance_name: null,
      phone_number_id: null,
    }
    expect(decideBindConflict({ ...base, current })).toBeNull()
  })

  it('libera a sobrescrita de Meta quando confirmada', () => {
    const current = {
      provider: 'meta',
      status: 'connected',
      uazapi_instance_id: null,
      uazapi_instance_name: null,
      phone_number_id: '123456789',
    }
    expect(
      decideBindConflict({ ...base, current, replaceExisting: true }),
    ).toBeNull()
  })
})

/**
 * A linha gravada pelo bind. Dois invariantes que, quebrados, só
 * aparecem em produção: token em claro derruba todo envio (os leitores
 * chamam decrypt), e `user_id` ausente faz o INSERT violar NOT NULL na
 * primeira empresa sem config.
 */
describe('buildBindRow / buildBindInsert', () => {
  const instance = { id: 'r-new', name: 'Carolina', token: 'raw-token', status: 'connected' }
  const fakeEncrypt = (raw: string) => `enc(${raw})`

  it('nunca grava o token em claro', () => {
    const row = buildBindRow({
      baseUrl: 'https://newphone.uazapi.com',
      instance,
      encryptToken: fakeEncrypt,
    })
    expect(row.uazapi_token).toBe('enc(raw-token)')
    expect(JSON.stringify(row)).not.toContain('raw-token')
  })

  it('grava id e nome, e zera os campos do provider Meta', () => {
    const row = buildBindRow({
      baseUrl: 'https://newphone.uazapi.com',
      instance,
      encryptToken: fakeEncrypt,
    })
    expect(row.uazapi_instance_id).toBe('r-new')
    expect(row.uazapi_instance_name).toBe('Carolina')
    expect(row.uazapi_base_url).toBe('https://newphone.uazapi.com')
    expect(row.provider).toBe('uazapi')
    expect(row.phone_number_id).toBeNull()
    expect(row.waba_id).toBeNull()
  })

  it('espelha o status real da instância, não um chute', () => {
    const connected = buildBindRow({
      baseUrl: 'https://x.uazapi.com',
      instance,
      encryptToken: fakeEncrypt,
    })
    expect(connected.status).toBe('connected')

    const offline = buildBindRow({
      baseUrl: 'https://x.uazapi.com',
      instance: { ...instance, status: 'disconnected' },
      encryptToken: fakeEncrypt,
    })
    expect(offline.status).toBe('disconnected')
  })

  it('o INSERT carrega user_id — a coluna é NOT NULL desde a migração 001', () => {
    const row = buildBindRow({
      baseUrl: 'https://x.uazapi.com',
      instance,
      encryptToken: fakeEncrypt,
    })
    const insert = buildBindInsert(row, 'acct-a', 'user-1')
    expect(insert.account_id).toBe('acct-a')
    expect(insert.user_id).toBe('user-1')
    expect(insert.uazapi_instance_id).toBe('r-new')
  })
})
```

Ajuste o import no topo desse arquivo para trazer as três funções:

```ts
import { buildBindInsert, buildBindRow, decideBindConflict } from '@/lib/whatsapp/uazapi-bind'
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `npm test -- src/app/api/whatsapp/uazapi/instances/bind-guards.test.ts`
Expected: FAIL — módulo `@/lib/whatsapp/uazapi-bind` não existe.

- [ ] **Step 3: Implemente a decisão pura**

Crie `src/lib/whatsapp/uazapi-bind.ts`:

```ts
// ============================================================
// A decisão "este bind destrói algo em uso?", isolada do HTTP.
//
// `whatsapp_config` é UNIQUE(account_id) e compartilhada entre os
// providers Meta e UAZAPI, então um bind sobrescreve o canal atual da
// empresa qualquer que ele seja. Em 2026-08-06 exatamente isso
// aconteceu por engano e os anexos de 60 conversas ficaram
// irrecuperáveis — daí as guardas serem explícitas e confirmáveis, em
// vez de o write ser silencioso.
// ============================================================

export interface BindCurrentConfig {
  provider: string | null
  status: string | null
  uazapi_instance_id: string | null
  uazapi_instance_name: string | null
  phone_number_id: string | null
}

export interface BindConflict {
  reason: 'replace_uazapi' | 'replace_meta'
  currentInstanceName?: string
}

export function decideBindConflict(args: {
  current: BindCurrentConfig | null
  newInstanceId: string
  newInstanceName: string
  replaceExisting: boolean
}): BindConflict | null {
  const { current, newInstanceId, replaceExisting } = args
  if (!current) return null
  if (replaceExisting) return null

  // Já é esta instância — rebind é idempotente e não destrói nada.
  if (current.uazapi_instance_id && current.uazapi_instance_id === newInstanceId) {
    return null
  }

  // Trocar uma instância UAZAPI que está no ar: as conversas antigas
  // deixam de abrir anexos, porque a mídia é baixada com o token da
  // instância vinculada.
  if (
    current.provider === 'uazapi' &&
    current.uazapi_instance_id &&
    current.status === 'connected'
  ) {
    return {
      reason: 'replace_uazapi',
      currentInstanceName: current.uazapi_instance_name ?? undefined,
    }
  }

  // Sobrescrever um canal Meta configurado: o write zera
  // phone_number_id e waba_id, e o número oficial some do CRM.
  if (current.provider === 'meta' && current.phone_number_id) {
    return { reason: 'replace_meta' }
  }

  return null
}

export interface BindRow {
  provider: 'uazapi'
  uazapi_base_url: string
  uazapi_instance_id: string
  uazapi_instance_name: string
  uazapi_token: string
  phone_number_id: null
  waba_id: null
  status: 'connected' | 'disconnected'
  updated_at: string
}

/**
 * Monta a linha do vínculo.
 *
 * `encryptToken` é injetado em vez de importado para que o teste possa
 * afirmar QUE o token foi cifrado sem depender do formato do
 * ciphertext: com um fake determinístico a asserção é exata. A rota
 * passa `encrypt`.
 */
export function buildBindRow(args: {
  baseUrl: string
  instance: { id: string; name: string; token: string; status: string }
  encryptToken: (raw: string) => string
  now?: Date
}): BindRow {
  const { baseUrl, instance, encryptToken, now = new Date() } = args
  return {
    provider: 'uazapi',
    uazapi_base_url: baseUrl,
    uazapi_instance_id: instance.id,
    uazapi_instance_name: instance.name,
    // NUNCA em claro: send-message.ts, o webhook e config/route.ts
    // chamam decrypt(), que exige o formato iv:ct:tag.
    uazapi_token: encryptToken(instance.token),
    phone_number_id: null,
    waba_id: null,
    status: instance.status === 'connected' ? 'connected' : 'disconnected',
    updated_at: now.toISOString(),
  }
}

/**
 * A mesma linha, pronta para INSERT. `user_id` é NOT NULL desde a
 * migração 001 e a 017 manteve a coluna — esquecê-lo faz a primeira
 * empresa sem config bater em 23502 com a instância já criada no
 * servidor, um meio-estado que o painel não sabe consertar.
 */
export function buildBindInsert(
  row: BindRow,
  accountId: string,
  userId: string,
): BindRow & { account_id: string; user_id: string } {
  return { ...row, account_id: accountId, user_id: userId }
}
```

- [ ] **Step 4: Rode e confirme que passa**

Run: `npm test -- src/app/api/whatsapp/uazapi/instances/bind-guards.test.ts`
Expected: PASS, 12 testes.

- [ ] **Step 5: Implemente a rota**

Crie `src/app/api/whatsapp/uazapi/instances/[id]/bind/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { setWebhook } from '@/lib/whatsapp/providers/uazapi'
import { getUazapiServer, requireOwnedInstance } from '@/lib/whatsapp/uazapi-admin'
import {
  buildBindInsert,
  buildBindRow,
  decideBindConflict,
} from '@/lib/whatsapp/uazapi-bind'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

/**
 * POST /api/whatsapp/uazapi/instances/[id]/bind
 *
 * Torna esta instância o canal WhatsApp da empresa. É o único lugar que
 * configura o webhook: existe uma URL de webhook por empresa e a rota
 * que a recebe autentica apenas pelo UUID do caminho, então apontar uma
 * instância não vinculada para ela faria as mensagens dela entrarem
 * como conversas da instância vinculada.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, userId, accountId } = await requireRole('admin')

    const server = getUazapiServer()
    if (!server) {
      return NextResponse.json({ error: 'uazapi_not_configured' }, { status: 503 })
    }

    const instance = await requireOwnedInstance(server, accountId, id)

    const payload = (await request.json().catch(() => ({}))) as {
      replace_existing?: boolean
    }
    const replaceExisting = payload.replace_existing === true

    // Outra empresa já reivindicou esta instância? Falha fechada: um
    // erro de consulta não pode virar "ninguém reivindicou".
    const { data: claimed, error: claimedError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id, accounts(name)')
      .eq('uazapi_instance_id', id)
      .neq('account_id', accountId)
      .maybeSingle()

    if (claimedError) {
      console.error('[uazapi/bind] claim check failed:', claimedError)
      return NextResponse.json({ error: 'claim_check_failed' }, { status: 503 })
    }
    if (claimed) {
      const owner = (claimed as { accounts?: { name?: string } }).accounts?.name
      return NextResponse.json(
        { error: 'instance_claimed', owner: owner ?? null },
        { status: 409 },
      )
    }

    const { data: current, error: currentError } = await supabase
      .from('whatsapp_config')
      .select('id, provider, status, uazapi_instance_id, uazapi_instance_name, uazapi_token, phone_number_id')
      .eq('account_id', accountId)
      .maybeSingle()

    if (currentError) {
      console.error('[uazapi/bind] current config check failed:', currentError)
      return NextResponse.json({ error: 'current_check_failed' }, { status: 503 })
    }

    const conflict = decideBindConflict({
      current: current
        ? {
            provider: current.provider,
            status: current.status,
            uazapi_instance_id: current.uazapi_instance_id,
            uazapi_instance_name: current.uazapi_instance_name,
            phone_number_id: current.phone_number_id,
          }
        : null,
      newInstanceId: instance.id,
      newInstanceName: instance.name,
      replaceExisting,
    })

    if (conflict) {
      return NextResponse.json(
        {
          error: conflict.reason,
          requires_confirmation: true,
          current_instance: conflict.currentInstanceName ?? null,
          new_instance: instance.name,
        },
        { status: 409 },
      )
    }

    // O token da instância que sai, capturado ANTES de a linha ser
    // sobrescrita — é com ele que desligamos o webhook dela.
    let previousToken: string | null = null
    const previousId = current?.uazapi_instance_id ?? null
    if (current?.uazapi_token && previousId && previousId !== instance.id) {
      try {
        previousToken = decrypt(current.uazapi_token)
      } catch {
        previousToken = null // token ilegível: seguimos sem desligar
      }
    }

    const row = buildBindRow({
      baseUrl: server.baseUrl,
      instance,
      encryptToken: encrypt,
    })

    let configId: string
    if (current) {
      const { data, error } = await supabase
        .from('whatsapp_config')
        .update(row)
        .eq('account_id', accountId)
        .select('id')
        .single()
      if (error || !data) {
        console.error('[uazapi/bind] update failed:', error)
        return NextResponse.json({ error: 'save_failed' }, { status: 500 })
      }
      configId = data.id
    } else {
      // `user_id` é NOT NULL desde a migração 001 e a 017 a manteve.
      const { data, error } = await supabase
        .from('whatsapp_config')
        .insert(buildBindInsert(row, accountId, userId))
        .select('id')
        .single()
      if (error || !data) {
        console.error('[uazapi/bind] insert failed:', error)
        return NextResponse.json({ error: 'save_failed' }, { status: 500 })
      }
      configId = data.id
    }

    const webhookUrl = `${new URL(request.url).origin}/api/whatsapp/webhook/uazapi/${configId}`

    try {
      await setWebhook({ baseUrl: server.baseUrl, token: instance.token, webhookUrl })
    } catch (err) {
      console.error('[uazapi/bind] setWebhook failed:', err)
      return NextResponse.json({ error: 'webhook_failed' }, { status: 502 })
    }

    // Duas instâncias jamais podem postar na mesma URL.
    if (previousToken) {
      try {
        await setWebhook({
          baseUrl: server.baseUrl,
          token: previousToken,
          webhookUrl,
          enabled: false,
        })
      } catch (err) {
        console.error('[uazapi/bind] disabling previous webhook failed:', err)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
```

- [ ] **Step 6: Verifique tipos, lint e suíte**

Run: `npm test && npm run typecheck && npm run lint`
Expected: tudo passa.

- [ ] **Step 7: Commit**

```bash
git add src/lib/whatsapp/uazapi-bind.ts src/app/api/whatsapp/uazapi/instances/bind-guards.test.ts src/app/api/whatsapp/uazapi/instances/\[id\]/bind/route.ts
git commit -m "feat(uazapi): bind an instance as the company channel"
```

---

### Task 8: Rotas de conexão — `connect` e `status`

**Files:**
- Create: `src/app/api/whatsapp/uazapi/instances/[id]/connect/route.ts`
- Create: `src/app/api/whatsapp/uazapi/instances/[id]/status/route.ts`

**Interfaces:**
- Consumes: Task 4 (`getUazapiServer`, `requireOwnedInstance`), Task 2 (`connectInstance`, `getInstanceStatus`), `decrypt`.
- Produces:
  - `POST /[id]/connect` → `{ connected: boolean; base64?: string; paircode?: string }`
  - `GET /[id]/status` → `{ connected: boolean; state?: string }`

- [ ] **Step 1: Implemente `connect`**

Crie `src/app/api/whatsapp/uazapi/instances/[id]/connect/route.ts`:

```ts
import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { connectInstance } from '@/lib/whatsapp/providers/uazapi'
import { getUazapiServer, requireOwnedInstance } from '@/lib/whatsapp/uazapi-admin'

/**
 * POST /api/whatsapp/uazapi/instances/[id]/connect
 *
 * Abre a sessão WhatsApp e devolve o QR code.
 *
 * Deliberadamente NÃO configura o webhook. A URL de webhook é uma por
 * empresa e a rota que a recebe autentica só pelo UUID do caminho: uma
 * instância possuída mas não vinculada apontada para lá teria suas
 * mensagens gravadas como conversas da instância vinculada, com o
 * download de mídia usando o token errado. Webhook é assunto do bind.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { accountId } = await requireRole('admin')

    const server = getUazapiServer()
    if (!server) {
      return NextResponse.json({ error: 'uazapi_not_configured' }, { status: 503 })
    }

    const instance = await requireOwnedInstance(server, accountId, id)

    try {
      const qr = await connectInstance({ baseUrl: server.baseUrl, token: instance.token })
      if (!qr.qrcode && !qr.paircode) {
        return NextResponse.json({ connected: true })
      }
      return NextResponse.json({
        connected: false,
        base64: qr.qrcode,
        paircode: qr.paircode,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown UAZAPI error'
      console.error('[uazapi/connect] failed:', message)
      return NextResponse.json({ error: 'uazapi_error', message }, { status: 502 })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
```

- [ ] **Step 2: Implemente `status`**

Crie `src/app/api/whatsapp/uazapi/instances/[id]/status/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getInstanceStatus } from '@/lib/whatsapp/providers/uazapi'
import { getUazapiServer, requireOwnedInstance } from '@/lib/whatsapp/uazapi-admin'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

/**
 * GET /api/whatsapp/uazapi/instances/[id]/status
 *
 * Polling do diálogo de QR (~3s).
 *
 * Para a instância VINCULADA lê id e token direto de `whatsapp_config`,
 * sem tocar em `/instance/all`: o polling não pode baixar o inventário
 * inteiro do servidor — com o token de toda empresa — 20 vezes por
 * leitura de QR.
 *
 * Mantém também a persistência que a rota antiga fazia: ao ver a
 * instância vinculada conectar, grava status e connected_at. Sem isso a
 * guarda 2 do bind, condicionada a status === 'connected', não
 * dispararia e a empresa trocaria de canal em silêncio.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, accountId } = await requireRole('admin')

    const server = getUazapiServer()
    if (!server) {
      return NextResponse.json({ connected: false, reason: 'uazapi_not_configured' })
    }

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('id, status, uazapi_instance_id, uazapi_token')
      .eq('account_id', accountId)
      .maybeSingle()

    const isBound = config?.uazapi_instance_id === id && !!config?.uazapi_token

    let token: string
    if (isBound) {
      try {
        token = decrypt(config!.uazapi_token)
      } catch {
        return NextResponse.json({ connected: false, reason: 'token_corrupted' })
      }
    } else {
      const instance = await requireOwnedInstance(server, accountId, id)
      token = instance.token
    }

    try {
      const result = await getInstanceStatus({ baseUrl: server.baseUrl, token })

      if (isBound && result.connected && config!.status !== 'connected') {
        await supabaseAdmin()
          .from('whatsapp_config')
          .update({ status: 'connected', connected_at: new Date().toISOString() })
          .eq('id', config!.id)
      }

      return NextResponse.json({ connected: result.connected, state: result.status })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown UAZAPI error'
      return NextResponse.json({ connected: false, reason: 'uazapi_error', message })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
```

- [ ] **Step 3: Verifique tipos e lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.

- [ ] **Step 4: Teste manualmente**

Com `npm run dev` e uma instância possuída pela sua empresa:

```bash
curl -s -b cookies.txt -X POST http://localhost:3000/api/whatsapp/uazapi/instances/<id>/connect | jq 'keys'
```

Expected: `["base64","connected","paircode"]` ou `["connected"]`.

Confirme a fronteira de posse com uma instância de OUTRA empresa:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -b cookies.txt -X POST http://localhost:3000/api/whatsapp/uazapi/instances/<id-de-outra>/connect
```

Expected: `403`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/whatsapp/uazapi/instances/\[id\]/connect src/app/api/whatsapp/uazapi/instances/\[id\]/status
git commit -m "feat(uazapi): per-instance connect and status routes"
```

---

### Task 9: Rotas de manutenção — `name`, `disconnect`, `DELETE`

**Files:**
- Create: `src/app/api/whatsapp/uazapi/instances/[id]/name/route.ts`
- Create: `src/app/api/whatsapp/uazapi/instances/[id]/disconnect/route.ts`
- Create: `src/app/api/whatsapp/uazapi/instances/[id]/route.ts`

**Interfaces:**
- Consumes: Task 4 (`getUazapiServer`, `requireOwnedInstance`), Task 2 (`renameInstance`, `disconnectInstance`, `deleteInstance`).
- Produces: `POST /[id]/name`, `POST /[id]/disconnect`, `DELETE /[id]` → `{ success: true }`.

- [ ] **Step 1: Implemente `name`**

Crie `src/app/api/whatsapp/uazapi/instances/[id]/name/route.ts`:

```ts
import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { renameInstance } from '@/lib/whatsapp/providers/uazapi'
import { getUazapiServer, requireOwnedInstance } from '@/lib/whatsapp/uazapi-admin'

/**
 * POST /api/whatsapp/uazapi/instances/[id]/name
 *
 * Renomeia a instância e, sendo ela a vinculada, mantém o espelho em
 * `whatsapp_config.uazapi_instance_name` em dia — o webhook o usa para
 * montar a URL de foto de perfil. O vínculo em si é pelo id, então um
 * espelho desatualizado não quebra o canal, mas quebra as fotos.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, accountId } = await requireRole('admin')

    const server = getUazapiServer()
    if (!server) {
      return NextResponse.json({ error: 'uazapi_not_configured' }, { status: 503 })
    }

    const instance = await requireOwnedInstance(server, accountId, id)

    const payload = (await request.json().catch(() => ({}))) as { name?: string }
    const name = payload.name?.trim()
    if (!name) {
      return NextResponse.json({ error: 'name_required' }, { status: 400 })
    }

    try {
      await renameInstance({ baseUrl: server.baseUrl, token: instance.token, name })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown UAZAPI error'
      return NextResponse.json({ error: 'uazapi_error', message }, { status: 502 })
    }

    await supabase
      .from('whatsapp_config')
      .update({ uazapi_instance_name: name, updated_at: new Date().toISOString() })
      .eq('account_id', accountId)
      .eq('uazapi_instance_id', id)

    return NextResponse.json({ success: true, name })
  } catch (err) {
    return toErrorResponse(err)
  }
}
```

- [ ] **Step 2: Implemente `disconnect`**

Crie `src/app/api/whatsapp/uazapi/instances/[id]/disconnect/route.ts`:

```ts
import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { disconnectInstance } from '@/lib/whatsapp/providers/uazapi'
import { getUazapiServer, requireOwnedInstance } from '@/lib/whatsapp/uazapi-admin'

/**
 * POST /api/whatsapp/uazapi/instances/[id]/disconnect
 *
 * Derruba a sessão WhatsApp sem apagar a instância. Sendo a vinculada,
 * reflete o estado em `whatsapp_config.status` para que a guarda de
 * troca do bind leia a verdade.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, accountId } = await requireRole('admin')

    const server = getUazapiServer()
    if (!server) {
      return NextResponse.json({ error: 'uazapi_not_configured' }, { status: 503 })
    }

    const instance = await requireOwnedInstance(server, accountId, id)

    try {
      await disconnectInstance({ baseUrl: server.baseUrl, token: instance.token })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown UAZAPI error'
      return NextResponse.json({ error: 'uazapi_error', message }, { status: 502 })
    }

    await supabase
      .from('whatsapp_config')
      .update({ status: 'disconnected', updated_at: new Date().toISOString() })
      .eq('account_id', accountId)
      .eq('uazapi_instance_id', id)

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
```

- [ ] **Step 3: Implemente `DELETE`**

Crie `src/app/api/whatsapp/uazapi/instances/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { deleteInstance } from '@/lib/whatsapp/providers/uazapi'
import { getUazapiServer, requireOwnedInstance } from '@/lib/whatsapp/uazapi-admin'

/**
 * DELETE /api/whatsapp/uazapi/instances/[id]
 *
 * Apaga a instância no servidor. Sendo ela a vinculada, desfaz o
 * vínculo mas MANTÉM a linha de `whatsapp_config` — ela é
 * UNIQUE(account_id) e carrega outros campos.
 *
 * A linha fica com provider 'uazapi' e token nulo; `send-message.ts`
 * ganhou uma guarda de nulo na Task 5 para responder
 * `whatsapp_not_configured` em vez de estourar dentro do decrypt.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, accountId } = await requireRole('admin')

    const server = getUazapiServer()
    if (!server) {
      return NextResponse.json({ error: 'uazapi_not_configured' }, { status: 503 })
    }

    const instance = await requireOwnedInstance(server, accountId, id)

    try {
      await deleteInstance({ baseUrl: server.baseUrl, token: instance.token })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown UAZAPI error'
      return NextResponse.json({ error: 'uazapi_error', message }, { status: 502 })
    }

    await supabase
      .from('whatsapp_config')
      .update({
        uazapi_instance_id: null,
        uazapi_instance_name: null,
        uazapi_token: null,
        status: 'disconnected',
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)
      .eq('uazapi_instance_id', id)

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
```

- [ ] **Step 4: Verifique tipos, lint e suíte**

Run: `npm test && npm run typecheck && npm run lint`
Expected: tudo passa.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/whatsapp/uazapi/instances/\[id\]
git commit -m "feat(uazapi): rename, disconnect and delete instances"
```

---

### Task 10: Atribuição de órfãs — super admin

**Files:**
- Create: `src/app/api/whatsapp/uazapi/instances/[id]/assign/route.ts`

**Interfaces:**
- Consumes: Task 4 (`getUazapiServer`, `requireUnownedInstance`, `loadInstances`, `isSuperAdmin`), Task 2 (`stampAdminFields`).
- Produces: `POST /[id]/assign` body `{ account_id: string }`, `DELETE /[id]/assign` → `{ success: true }`.

- [ ] **Step 1: Implemente as duas direções**

Crie `src/app/api/whatsapp/uazapi/instances/[id]/assign/route.ts`:

```ts
import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { stampAdminFields } from '@/lib/whatsapp/providers/uazapi'
import {
  getUazapiServer,
  isSuperAdmin,
  loadInstances,
  requireUnownedInstance,
} from '@/lib/whatsapp/uazapi-admin'

/**
 * POST /api/whatsapp/uazapi/instances/[id]/assign
 *
 * Dá dono a uma instância órfã. Só super admin, porque a instância
 * ainda não pertence a ninguém e portanto nenhuma empresa tem direito a
 * ela por posse.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, userId } = await requireRole('admin')

    if (!(await isSuperAdmin(supabase, userId))) {
      return NextResponse.json({ error: 'super_admin_required' }, { status: 403 })
    }

    const server = getUazapiServer()
    if (!server) {
      return NextResponse.json({ error: 'uazapi_not_configured' }, { status: 503 })
    }

    const payload = (await request.json().catch(() => ({}))) as { account_id?: string }
    const targetAccountId = payload.account_id?.trim()
    if (!targetAccountId) {
      return NextResponse.json({ error: 'account_id_required' }, { status: 400 })
    }

    // Um account_id inexistente tornaria a instância invisível para
    // todos: nem órfã (o campo deixa de ser vazio) nem de alguém.
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('id')
      .eq('id', targetAccountId)
      .maybeSingle()

    if (accountError) {
      console.error('[uazapi/assign] account lookup failed:', accountError)
      return NextResponse.json({ error: 'account_check_failed' }, { status: 503 })
    }
    if (!account) {
      return NextResponse.json({ error: 'account_not_found' }, { status: 400 })
    }

    await requireUnownedInstance(server, id)

    await stampAdminFields({
      baseUrl: server.baseUrl,
      adminToken: server.adminToken,
      id,
      adminField01: targetAccountId,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/whatsapp/uazapi/instances/[id]/assign
 *
 * Limpa o carimbo. Sem esta rota um account_id errado seria
 * irreversível: a instância sumiria da lista de órfãs (o campo não está
 * mais vazio) e da lista de toda empresa (o carimbo não bate), e a
 * única saída seria o painel da UAZAPI — justamente o que este trabalho
 * remove.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, userId } = await requireRole('admin')

    if (!(await isSuperAdmin(supabase, userId))) {
      return NextResponse.json({ error: 'super_admin_required' }, { status: 403 })
    }

    const server = getUazapiServer()
    if (!server) {
      return NextResponse.json({ error: 'uazapi_not_configured' }, { status: 503 })
    }

    const instances = await loadInstances(server)
    if (!instances.some((i) => i.id === id)) {
      return NextResponse.json({ error: 'instance_not_found' }, { status: 404 })
    }

    // Uma instância desvinculada continua existindo no servidor; só
    // deixa de aparecer para a empresa que a tinha.
    await supabase
      .from('whatsapp_config')
      .update({
        uazapi_instance_id: null,
        uazapi_instance_name: null,
        uazapi_token: null,
        status: 'disconnected',
        updated_at: new Date().toISOString(),
      })
      .eq('uazapi_instance_id', id)

    await stampAdminFields({
      baseUrl: server.baseUrl,
      adminToken: server.adminToken,
      id,
      adminField01: '',
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
```

- [ ] **Step 2: Verifique tipos e lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.

- [ ] **Step 3: Atribua as 4 instâncias reais**

Com o servidor rodando e você logado como super admin, atribua
`smart`, `Connect`, `Metalis` e `Carolina` às empresas corretas pelo
painel (Task 11) ou por curl. Confirme depois:

```bash
curl -s -H "admintoken: $UAZAPI_ADMIN_TOKEN" https://newphone.uazapi.com/instance/all \
  | jq '[.[] | {name, adminField01}]'
```

Expected: nenhum `adminField01` vazio para instâncias em uso.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/whatsapp/uazapi/instances/\[id\]/assign
git commit -m "feat(uazapi): super-admin assignment of unowned instances"
```

---

### Task 11: Painel na UI

**Files:**
- Create: `src/components/settings/uazapi-instances.tsx`
- Modify: `src/components/settings/whatsapp-config.tsx` (ramo `provider === 'uazapi'`)
- Modify: `messages/pt-BR.json`, `messages/en.json`

**Interfaces:**
- Consumes: todas as rotas das Tasks 6-10.
- Produces: `<UazapiInstances />`, sem props.

- [ ] **Step 1: Adicione as chaves de tradução**

Em `messages/pt-BR.json`, dentro de `Settings`, ao lado de `"whatsapp"`, acrescente:

```json
    "uazapi": {
      "title": "Instâncias",
      "description": "Crie e conecte números de WhatsApp desta empresa.",
      "newInstance": "Nova instância",
      "namePlaceholder": "nome-da-instancia",
      "creating": "Criando...",
      "empty": "Nenhuma instância ainda. Crie a primeira para conectar um número.",
      "notConfigured": "Servidor UAZAPI não configurado",
      "notConfiguredHint": "Defina UAZAPI_BASE_URL e UAZAPI_ADMIN_TOKEN no ambiente do servidor.",
      "otherServer": "Esta empresa está configurada em outro servidor UAZAPI. As instâncias dele não aparecem aqui.",
      "bound": "Vinculada",
      "connected": "conectado",
      "disconnected": "desconectado",
      "qr": "QR",
      "bind": "Vincular",
      "rename": "Renomear",
      "disconnect": "Desconectar",
      "delete": "Excluir",
      "qrTitle": "Escaneie o QR Code",
      "qrHint": "Abra o WhatsApp no celular → Aparelhos conectados → Conectar um aparelho.",
      "paircode": "Código de pareamento:",
      "connectedToast": "WhatsApp conectado.",
      "renameTitle": "Renomear instância",
      "deleteTitle": "Excluir esta instância?",
      "deleteBody": "A instância é apagada no servidor e o WhatsApp dela é desconectado. Não há como desfazer.",
      "disconnectTitle": "Desconectar esta instância?",
      "disconnectBody": "O WhatsApp cai e as mensagens param de chegar até reconectar pelo QR.",
      "replaceTitle": "Trocar o canal desta empresa?",
      "confirm": "Confirmar",
      "cancel": "Cancelar",
      "unownedTitle": "Sem empresa",
      "unownedHint": "Instâncias no servidor que ainda não pertencem a nenhuma empresa.",
      "assign": "Atribuir",
      "unassign": "Desvincular da empresa",
      "selectCompany": "Escolha a empresa",
      "replaceUazapi": "Esta empresa já está conectada à instância \"{current}\". Vincular \"{next}\" agora faria os anexos das conversas antigas deixarem de abrir. Confirmar a troca?",
      "replaceMeta": "Esta empresa usa a API oficial da Meta. Vincular uma instância UAZAPI remove essa configuração. Confirmar?",
      "instanceClaimed": "Esta instância já pertence a outra empresa.",
      "forbidden": "Esta instância pertence a outra empresa.",
      "genericError": "Não foi possível concluir a operação."
    },
```

Em `messages/en.json`, no mesmo lugar, acrescente o equivalente:

```json
    "uazapi": {
      "title": "Instances",
      "description": "Create and connect WhatsApp numbers for this company.",
      "newInstance": "New instance",
      "namePlaceholder": "instance-name",
      "creating": "Creating...",
      "empty": "No instances yet. Create the first one to connect a number.",
      "notConfigured": "UAZAPI server not configured",
      "notConfiguredHint": "Set UAZAPI_BASE_URL and UAZAPI_ADMIN_TOKEN in the server environment.",
      "otherServer": "This company is configured on a different UAZAPI server. Its instances are not listed here.",
      "bound": "Bound",
      "connected": "connected",
      "disconnected": "disconnected",
      "qr": "QR",
      "bind": "Bind",
      "rename": "Rename",
      "disconnect": "Disconnect",
      "delete": "Delete",
      "qrTitle": "Scan the QR code",
      "qrHint": "Open WhatsApp on your phone → Linked devices → Link a device.",
      "paircode": "Pairing code:",
      "connectedToast": "WhatsApp connected.",
      "renameTitle": "Rename instance",
      "deleteTitle": "Delete this instance?",
      "deleteBody": "The instance is removed from the server and its WhatsApp is disconnected. This cannot be undone.",
      "disconnectTitle": "Disconnect this instance?",
      "disconnectBody": "WhatsApp goes offline and messages stop arriving until you reconnect by QR.",
      "replaceTitle": "Switch this company's channel?",
      "confirm": "Confirm",
      "cancel": "Cancel",
      "unownedTitle": "No company",
      "unownedHint": "Instances on the server that do not belong to any company yet.",
      "assign": "Assign",
      "unassign": "Unassign from company",
      "selectCompany": "Choose a company",
      "replaceUazapi": "This company is already connected to instance \"{current}\". Binding \"{next}\" now would stop attachments in older conversations from opening. Confirm the switch?",
      "replaceMeta": "This company uses the official Meta API. Binding a UAZAPI instance removes that configuration. Confirm?",
      "instanceClaimed": "This instance already belongs to another company.",
      "forbidden": "This instance belongs to another company.",
      "genericError": "The operation could not be completed."
    },
```

- [ ] **Step 2: Confirme que os dois arquivos são JSON válido**

Run: `node -e "JSON.parse(require('fs').readFileSync('messages/pt-BR.json','utf8')); JSON.parse(require('fs').readFileSync('messages/en.json','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Confirme que as duas locales têm exatamente as mesmas chaves**

Run:

```bash
node -e "
const pt=JSON.parse(require('fs').readFileSync('messages/pt-BR.json','utf8')).Settings.uazapi;
const en=JSON.parse(require('fs').readFileSync('messages/en.json','utf8')).Settings.uazapi;
const a=Object.keys(pt).sort().join(','), b=Object.keys(en).sort().join(',');
if(a!==b){ console.error('DIVERGEM'); process.exit(1); }
console.log('mesmas chaves:', Object.keys(pt).length);
"
```

Expected: `mesmas chaves: 39`.

- [ ] **Step 4: Escreva o componente**

Crie `src/components/settings/uazapi-instances.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Plus, QrCode, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface PublicInstance {
  id: string;
  name: string;
  status: string;
  owner?: string;
  profileName?: string;
  created?: string;
}

interface ListResponse {
  configured: boolean;
  instances: PublicInstance[];
  boundInstanceId: string | null;
  otherServer?: boolean;
  /** Só chega para super admin. */
  unowned?: PublicInstance[];
  /** Só chega para super admin. */
  accounts?: { id: string; name: string }[];
}

/**
 * As instâncias UAZAPI desta empresa.
 *
 * Nenhum token trafega até aqui: o backend filtra por empresa e
 * serializa apenas `PublicInstance`. Toda ação é uma chamada à rota
 * correspondente, que refaz a checagem de posse — esconder um botão
 * nunca é a proteção.
 */
export function UazapiInstances() {
  const t = useTranslations('Settings.uazapi');

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ListResponse | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Empresa escolhida por linha, no bloco "Sem empresa". */
  const [assignTo, setAssignTo] = useState<Record<string, string>>({});

  const [qrFor, setQrFor] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [paircode, setPaircode] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [confirm, setConfirm] = useState<
    | null
    | { kind: 'delete' | 'disconnect'; id: string }
    | { kind: 'replace'; id: string; message: string }
  >(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/uazapi/instances');
      if (!res.ok) {
        setData(null);
        return;
      }
      setData((await res.json()) as ListResponse);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch('/api/whatsapp/uazapi/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        toast.error(t('genericError'));
        return;
      }
      setNewName('');
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function handleConnect(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/whatsapp/uazapi/instances/${id}/connect`, {
        method: 'POST',
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(res.status === 403 ? t('forbidden') : t('genericError'));
        return;
      }
      if (body.connected) {
        toast.success(t('connectedToast'));
        await load();
        return;
      }
      setQrFor(id);
      setQr(body.base64 ?? null);
      setPaircode(body.paircode ?? null);
      stopPolling();
      pollRef.current = setInterval(async () => {
        const s = await fetch(`/api/whatsapp/uazapi/instances/${id}/status`);
        const sb = await s.json();
        if (sb.connected) {
          stopPolling();
          setQrFor(null);
          setQr(null);
          setPaircode(null);
          toast.success(t('connectedToast'));
          void load();
        }
      }, 3000);
    } finally {
      setBusyId(null);
    }
  }

  async function handleBind(id: string, replaceExisting = false) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/whatsapp/uazapi/instances/${id}/bind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replace_existing: replaceExisting }),
      });
      const body = await res.json();

      if (res.status === 409 && body.requires_confirmation) {
        setConfirm({
          kind: 'replace',
          id,
          message:
            body.error === 'replace_meta'
              ? t('replaceMeta')
              : t('replaceUazapi', {
                  current: body.current_instance ?? '',
                  next: body.new_instance ?? '',
                }),
        });
        return;
      }
      if (res.status === 409 && body.error === 'instance_claimed') {
        toast.error(t('instanceClaimed'));
        return;
      }
      if (!res.ok) {
        toast.error(res.status === 403 ? t('forbidden') : t('genericError'));
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleRename(id: string, current: string) {
    const name = window.prompt(t('renameTitle'), current)?.trim();
    if (!name || name === current) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/whatsapp/uazapi/instances/${id}/name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        toast.error(t('genericError'));
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleAssign(id: string, targetAccountId: string) {
    if (!targetAccountId) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/whatsapp/uazapi/instances/${id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: targetAccountId }),
      });
      if (!res.ok) {
        toast.error(t('genericError'));
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleUnassign(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/whatsapp/uazapi/instances/${id}/assign`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        toast.error(t('genericError'));
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function runConfirmed() {
    if (!confirm) return;
    const { kind, id } = confirm;
    setConfirm(null);
    if (kind === 'replace') {
      await handleBind(id, true);
      return;
    }
    setBusyId(id);
    try {
      const res = await fetch(
        kind === 'delete'
          ? `/api/whatsapp/uazapi/instances/${id}`
          : `/api/whatsapp/uazapi/instances/${id}/disconnect`,
        { method: kind === 'delete' ? 'DELETE' : 'POST' },
      );
      if (!res.ok) {
        toast.error(t('genericError'));
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (!data?.configured) {
    return (
      <Alert className="bg-card border-border">
        <AlertTitle className="text-foreground">{t('notConfigured')}</AlertTitle>
        <AlertDescription className="text-muted-foreground">
          {t('notConfiguredHint')}
        </AlertDescription>
      </Alert>
    );
  }

  // O backend só envia `accounts` para super admin, então a presença do
  // campo é a resposta — a UI não decide papel por conta própria, e
  // esconder o botão nunca é a proteção: cada rota refaz a checagem.
  const isSuper = data.accounts !== undefined;

  return (
    <>
      {data.otherServer && (
        <Alert className="bg-card border-border">
          <AlertDescription className="text-muted-foreground">
            {t('otherServer')}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">{t('title')}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('namePlaceholder')}
              className="bg-muted border-border text-foreground"
            />
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {creating ? t('creating') : t('newInstance')}
            </Button>
          </div>

          {data.instances.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.instances.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="flex items-center gap-2 font-medium text-foreground">
                    {i.status === 'connected' ? (
                      <CheckCircle2 className="size-4 text-primary" />
                    ) : (
                      <span className="size-2 rounded-full bg-muted-foreground" />
                    )}
                    {i.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {i.status === 'connected' ? t('connected') : t('disconnected')}
                    {i.owner ? ` · ${i.owner}` : ''}
                    {i.profileName ? ` · ${i.profileName}` : ''}
                  </span>
                  {data.boundInstanceId === i.id && <Badge>{t('bound')}</Badge>}

                  <span className="ml-auto flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === i.id}
                      onClick={() => handleConnect(i.id)}
                    >
                      <QrCode className="size-4" />
                      {t('qr')}
                    </Button>
                    {data.boundInstanceId !== i.id && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === i.id}
                        onClick={() => handleBind(i.id)}
                      >
                        {t('bind')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === i.id}
                      onClick={() => handleRename(i.id, i.name)}
                    >
                      {t('rename')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === i.id}
                      onClick={() => setConfirm({ kind: 'disconnect', id: i.id })}
                    >
                      {t('disconnect')}
                    </Button>
                    {isSuper && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === i.id}
                        onClick={() => handleUnassign(i.id)}
                      >
                        {t('unassign')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === i.id}
                      onClick={() => setConfirm({ kind: 'delete', id: i.id })}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {isSuper && (data.unowned?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">{t('unownedTitle')}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('unownedHint')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {data.unowned!.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="font-medium text-foreground">{i.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {i.status === 'connected' ? t('connected') : t('disconnected')}
                    {i.owner ? ` · ${i.owner}` : ''}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <select
                      value={assignTo[i.id] ?? ''}
                      onChange={(e) =>
                        setAssignTo((prev) => ({ ...prev, [i.id]: e.target.value }))
                      }
                      className="h-9 rounded-md border border-border bg-muted px-2 text-sm text-foreground"
                    >
                      <option value="">{t('selectCompany')}</option>
                      {(data.accounts ?? []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      disabled={busyId === i.id || !assignTo[i.id]}
                      onClick={() => handleAssign(i.id, assignTo[i.id])}
                    >
                      {t('assign')}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!qrFor} onOpenChange={(open) => { if (!open) { stopPolling(); setQrFor(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('qrTitle')}</DialogTitle>
            <DialogDescription>{t('qrHint')}</DialogDescription>
          </DialogHeader>
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qr}
              alt={t('qrTitle')}
              className="mx-auto size-64 rounded border border-border bg-white p-2"
            />
          )}
          {paircode && (
            <p className="text-center text-sm text-muted-foreground">
              {t('paircode')} <span className="font-mono text-foreground">{paircode}</span>
            </p>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirm} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'delete'
                ? t('deleteTitle')
                : confirm?.kind === 'disconnect'
                  ? t('disconnectTitle')
                  : t('replaceTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'delete'
                ? t('deleteBody')
                : confirm?.kind === 'disconnect'
                  ? t('disconnectBody')
                  : confirm?.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={runConfirmed}>{t('confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

> Nota: `handleRename` usa `window.prompt`, que é aceitável para um
> campo de texto simples e não é um diálogo bloqueante do tipo que
> quebra automação de browser. Se o repo já tiver um dialog de input
> reutilizável em `src/components/ui/`, prefira-o.

- [ ] **Step 5: Confirme que os componentes de UI existem**

Run: `ls src/components/ui/ | grep -E "alert-dialog|dialog|badge"`
Expected: `alert-dialog.tsx`, `dialog.tsx`, `badge.tsx`. Se algum faltar, gere-o com `npx shadcn@latest add <nome>` antes de seguir.

- [ ] **Step 6: Monte o painel no lugar do formulário**

Em `src/components/settings/whatsapp-config.tsx`, no ramo `provider === 'uazapi'` (a partir da linha ~572), substitua **todo** o JSX entre `{provider === 'uazapi' ? (` e o `) : (` correspondente por:

```tsx
        {provider === 'uazapi' ? (
          <UazapiInstances />
        ) : (
```

E acrescente o import no topo:

```tsx
import { UazapiInstances } from './uazapi-instances';
```

- [ ] **Step 7: Remova o estado UAZAPI que ficou órfão**

Na mesma edição, remova de `whatsapp-config.tsx` tudo que só existia para o formulário que acabou de sair — deixar isso para a Task 12 quebraria o lint entre as duas tasks:

- estados: `uazapiBaseUrl`, `uazapiToken`, `uazapiInstanceName`, `uazapiTokenEdited`, `uazapiSaving`, `uazapiConnecting`, `uazapiQr`, `uazapiPaircode`, `uazapiConnected`
- ref: `uazapiPollRef`
- funções: `stopUazapiPolling`, `startUazapiPolling`, `handleSaveUazapi`, `handleUazapiConnect`
- o `useEffect` que faz cleanup do polling (`useEffect(() => stopUazapiPolling, [])`)
- as atribuições a esses estados dentro de `fetchConfig`

Mantenha o estado `provider` e o seletor Meta/UAZAPI — o painel é renderizado a partir dele.

- [ ] **Step 8: Verifique tipos e lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros, e sem avisos de variável declarada e não usada.

- [ ] **Step 9: Commit**

```bash
git add src/components/settings/uazapi-instances.tsx src/components/settings/whatsapp-config.tsx messages/pt-BR.json messages/en.json
git commit -m "feat(uazapi): instance panel UI"
```

---

### Task 12: Remoção do formulário e das rotas antigas

**Files:**
- Delete: `src/app/api/whatsapp/uazapi/connect/route.ts`
- Delete: `src/app/api/whatsapp/uazapi/status/route.ts`

**Interfaces:**
- Consumes: Task 11 (o painel substituiu a UI e já removeu o estado órfão do componente).
- Produces: nada. É a limpeza que fecha o trabalho.

- [ ] **Step 1: Confirme que ninguém mais chama as rotas antigas**

Run: `grep -rn "uazapi/connect\|uazapi/status" src --include=*.ts --include=*.tsx | grep -v "instances/"`
Expected: apenas os dois arquivos de rota. Se aparecer outro chamador, atualize-o antes de deletar.

- [ ] **Step 2: Delete as rotas**

```bash
rm -r src/app/api/whatsapp/uazapi/connect src/app/api/whatsapp/uazapi/status
```

- [ ] **Step 3: Confirme que o componente já não referencia nada removido**

Run: `grep -n "uazapiPollRef\|handleSaveUazapi\|handleUazapiConnect\|uazapiQr" src/components/settings/whatsapp-config.tsx`
Expected: nenhuma saída — a Task 11 já limpou. Se aparecer algo, remova antes de seguir.

- [ ] **Step 4: Verifique que nada quebrou**

Run: `npm test && npm run typecheck && npm run lint`
Expected: tudo passa, sem avisos de variável não usada.

- [ ] **Step 5: Rode o build**

Run: `npm run build`
Expected: build completa. É a única verificação que compila as rotas novas do App Router de verdade.

- [ ] **Step 6: Verificação manual de ponta a ponta**

Com `npm run dev`, como owner/admin:

1. Painel lista as instâncias da empresa e nenhuma de outra.
2. "Nova instância" cria; ela aparece na lista, sem badge Vinculada.
3. QR abre, o polling detecta a conexão e o diálogo fecha sozinho.
4. "Vincular" numa segunda instância com a primeira conectada devolve o diálogo de confirmação; confirmar troca o vínculo.
5. Após vincular, mande uma mensagem de teste ao número e confirme que ela chega numa conversa **desta** empresa.
6. Confirme na UAZAPI que o webhook da instância anterior ficou `enabled: false`:

```bash
curl -s -H "token: <token-da-instancia-anterior>" https://newphone.uazapi.com/webhook | jq '.enabled'
```

Expected: `false`.

7. Como agent ou viewer, confirme que o painel não aparece e que
   `curl -X POST .../instances` devolve 403.

- [ ] **Step 7: Commit**

```bash
git add -A src/app/api/whatsapp/uazapi
git commit -m "refactor(uazapi): drop the legacy connect and status routes"
```

---

## Notas de execução

- O repo estava em `main` com 68 arquivos modificados quando este plano foi escrito. Trabalhe em `feat/uazapi-instance-panel` e não misture essas mudanças nos commits acima.
- O admin token real está em `.env.local` (gitignored). Ele apareceu no transcript da sessão de design; considere rotacioná-lo com `POST /admin/token/rotate` ao terminar, atualizando `.env.local` em seguida.
- As 4 instâncias do servidor (`smart`, `Connect`, `Metalis`, `Carolina`) estavam sem `adminField01` em 2026-08-31. Até a Task 10 rodar contra o servidor real, o painel abre vazio para empresas cuja `whatsapp_config` não casa por id nem por nome.
