# Painel de instâncias UAZAPI no CRM

**Data:** 2026-08-31
**Estado:** revisado após code review, aguardando plano de implementação

## Problema

Registrar uma instância UAZAPI hoje acontece fora do CRM. Em
`src/components/settings/whatsapp-config.tsx` o usuário cola URL do
servidor, nome da instância e um token; ao clicar *Conectar*,
`src/app/api/whatsapp/uazapi/connect/route.ts` tenta conectar e, **se
falhar**, assume que o token colado era o admin token e cria a
instância como efeito colateral do erro. Criar é um passo escondido
dentro de um `catch`, e não existe forma de listar, renomear ou
deletar uma instância pelo CRM.

Três divergências entre esse código e a API real (uazapiGO v2.1.1,
verificadas contra `https://newphone.uazapi.com` em 2026-08-31):

| Código atual | API real |
|---|---|
| `POST /instance/init` | o endpoint é `POST /instance/create`; `/instance/init` não existe no spec |
| admin token no header `token` | header `token` responde **401**; o correto é `admintoken` |
| lê o token só de `data.instance.token` | a resposta traz `token` no topo **e** em `instance.token` |

## Objetivo

Owner e admin de uma empresa criam, conectam, renomeiam, desconectam e
deletam as instâncias UAZAPI **daquela empresa** dentro do CRM, sem
colar URL nem token.

Fora de escopo: suportar mais de um servidor UAZAPI; vincular mais de
uma instância por empresa ao mesmo tempo; expor os campos de chatbot,
proxy ou privacidade que a API oferece.

## Decisões

| Decisão | Escolha | Por quê |
|---|---|---|
| Fonte da verdade da posse | A UAZAPI, via `adminField01` | Não duplica o que o servidor já sabe. `adminField01/02` só podem ser editados por quem tem o admintoken — e só o backend tem. |
| Chave do vínculo | O `id` da instância, em coluna nova | O `id` é estável e único; o `name` é editável pelo próprio painel e não é único de nenhum lado. Ver "Por que uma migração". |
| Onde mora o admin token | Variável de ambiente do servidor | O owner/admin nunca vê o token, então o filtro por empresa vira fronteira real e não guarda-corpo de UI. Custo aceito: um servidor UAZAPI só. |
| Quem acessa | `requireRole('admin')` | O helper que o repo já tem; `canEditSettings` documenta "WhatsApp config" como exatamente este caso. |
| Formulário atual | Substituído pelo painel | Menos superfície, um caminho só. |
| Instâncias órfãs | Carimbo automático + atribuição por super admin | Onde o CRM já sabe de quem é, carimba sozinho; o resto é escolha explícita e **reversível**. |
| Webhook | Configurado **só** no `bind` | Existe uma URL de webhook por empresa. Ver "Webhook e o incidente de 2026-08-06". |

### Alternativas descartadas

**Espelho local completo** (tabela `uazapi_instances`): cria uma
segunda fonte da verdade que dessincroniza quando alguém mexe pelo
painel da própria UAZAPI. O que guardamos no banco é só o vínculo
(`id` + token da instância vinculada), não o inventário.

**Admin token por empresa, em coluna criptografada**: permitiria
servidores diferentes por empresa, mas quem cola o token já tem poder
total no servidor — o filtro por empresa deixaria de significar
qualquer coisa.

### Por que uma migração, afinal

A primeira versão deste spec dizia "nenhuma migração é necessária" e
usava `whatsapp_config.uazapi_instance_name` como chave do vínculo.
Isso não se sustenta assim que o painel ganha um botão *Renomear*: o
`name` passa a ser mutável, não é único em nenhum dos dois lados, e é
a única ligação entre a linha do banco e a instância. Renomear a
instância vinculada quebraria de uma vez o badge VINCULADA, o carimbo
automático, a guarda de 409 em `config/route.ts:555` e a URL de foto de
perfil em `webhook/uazapi/[configId]/route.ts:169`.

Uma coluna resolve tudo isso na raiz:

```sql
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS uazapi_instance_id TEXT;

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_uazapi_instance_id
  ON whatsapp_config(uazapi_instance_id);
```

`uazapi_instance_name` **permanece** — o webhook o usa para montar a
URL de foto de perfil e ele é útil para diagnóstico — mas deixa de ser
chave: passa a ser um espelho, reescrito junto com o `id` a cada
`bind` e a cada rename da instância vinculada.

## Configuração

Duas variáveis, só de servidor, documentadas em `.env.local.example`
(sem valores) e preenchidas em `.env.local`:

```
UAZAPI_BASE_URL=https://seuservidor.uazapi.com
UAZAPI_ADMIN_TOKEN=...
```

Faltando qualquer uma, o painel renderiza "servidor UAZAPI não
configurado" nomeando as duas variáveis, em vez de quebrar.

`whatsapp_config.uazapi_base_url` permanece: `send-message.ts` e
`inbound.ts` leem dela e as linhas existentes já têm valor. Muda só a
origem do que é escrito ali — o env, não um campo de formulário. Linhas
apontando para **outro** servidor são tratadas explicitamente no
carimbo automático, abaixo.

## Componentes

### Cliente UAZAPI — `src/lib/whatsapp/providers/uazapi.ts`

Ganha um `adminHeaders(adminToken)` que emite `admintoken`, ao lado do
`baseHeaders(token)` que já existe.

- `initInstance` → renomeada `createInstance`: `POST /instance/create`,
  header `admintoken`, body `{ name, adminField01 }`, token lido de
  `data.token ?? data.instance?.token`.
- `listInstances({ baseUrl, adminToken })` → `GET /instance/all`.
- `stampAdminFields({ baseUrl, adminToken, id, adminField01 })` →
  `POST /instance/updateAdminFields`.
- `renameInstance({ baseUrl, token, name })` →
  `POST /instance/updateInstanceName`.
- `setWebhook` ganha um parâmetro `enabled` (a API já aceita
  `enabled: false` no mesmo body), usado para desligar o webhook da
  instância que deixa de ser a vinculada.

`connectInstance`, `getInstanceStatus`, `disconnectInstance`,
`deleteInstance`, `sendText`, `sendMedia` e `downloadMedia` não mudam.

### Fronteira de posse — `src/lib/whatsapp/uazapi-admin.ts` (novo)

- `getUazapiServer()` → `{ baseUrl, adminToken }` ou `null` se o env
  estiver incompleto.
- `listInstancesMemo()` → `listInstances` memoizado **por request**, já
  que várias checagens dentro de uma mesma chamada precisam da lista.
- `listOwnedInstances(accountId)` → lista, executa o carimbo
  automático, devolve só as da empresa.
- `listUnownedInstances()` → as de `adminField01` vazio. Só o bloco
  Sem empresa a usa, e só para super admin.
- `requireOwnedInstance(accountId, id)` → a instância e seu token, ou
  403 quando `adminField01 !== accountId`.
- `requireUnownedInstance(id)` → a instância, ou 409 se já tem dono.
  Usada por `/assign`, que por definição opera sobre instância sem dono
  e portanto **não** pode passar por `requireOwnedInstance`.

Autenticação e papel **não** são reimplementados aqui: as rotas usam
`requireRole('admin')` de `src/lib/auth/account.ts` e `toErrorResponse`
para o mapeamento 401/403. `roles.ts` diz explicitamente que os
predicados são a única fonte de verdade e que route guards devem
chamá-los em vez de abrir o próprio teste de papel; `canEditSettings`
já descreve "WhatsApp config" como o caso. Isso também resolve sozinho
o papel `manager` (migração 053), que meu rascunho anterior ignorava.

**Dois invariantes de token, ambos cobertos por teste:**

1. O token de instância **nunca** é serializado para o browser. O que
   sai é `{ id, name, status, owner, profileName, profilePicUrl,
   created }` — sem `token`, sem `openai_apikey`.
2. O token **nunca** é gravado em claro. Todo write de
   `whatsapp_config.uazapi_token` passa por `encrypt()`, porque todos
   os leitores (`send-message.ts:280`, `resolveMediaUrl` no webhook,
   `config/route.ts:124`) chamam `decrypt()`, que exige o formato
   `iv:ct:tag` e lança em qualquer outra coisa.

### Rotas — `src/app/api/whatsapp/uazapi/instances/`

```
GET    /                      lista da empresa + qual está vinculada
                              (+ as órfãs, se super admin)
POST   /                      { name } → cria e carimba adminField01
POST   /[id]/connect          connect → QR / paircode   (NÃO mexe no webhook)
GET    /[id]/status           polling enquanto o QR está na tela
POST   /[id]/bind             { replace_existing? } → vira o canal da empresa
POST   /[id]/name             { name } → renomeia
POST   /[id]/disconnect
DELETE /[id]                  deleta; se era a vinculada, desfaz o vínculo
POST   /[id]/assign           { account_id } → super admin apenas
DELETE /[id]/assign           limpa o carimbo → super admin apenas
```

`params` é uma Promise (Next 16): `const { id } = await params`, no
padrão que as 21 rotas dinâmicas do repo já usam — não o helper
`RouteContext`, que o repo não adotou.

Toda rota `[id]` passa por `requireOwnedInstance`, **exceto** as duas
`/assign`, que exigem super admin.

### UI — `src/components/settings/uazapi-instances.tsx` (novo)

Montado no ramo `provider === 'uazapi'` de `whatsapp-config.tsx`, que
perde o estado e o JSX do formulário (~200 das suas 1160 linhas).

Textos via `useTranslations` (next-intl), com as chaves adicionadas a
**`messages/pt-BR.json` e `messages/en.json`**: 22 dos 30 componentes
de `src/components/settings/` já são internacionalizados, e um painel
com literais deixaria a página de settings em inglês exceto neste
bloco. As mensagens de erro das rotas também são chaves, não literais.

Estados: env ausente; sem permissão; lista vazia; lista.

```
Instâncias                                   [ + Nova instância ]
──────────────────────────────────────────────────────────────────
● Metalis           conectado   5521988398031 · Metalis   VINCULADA
                    [ QR ]  [ Renomear ]  [ Desconectar ]  [ x ]
○ Carolina          desconectado
                    [ QR ]  [ Vincular ]  [ Renomear ]     [ x ]
```

QR num `Dialog`, com polling em `/[id]/status`. Deletar e Desconectar
confirmam por `AlertDialog`. Nunca `confirm()` nativo.

Para super admin, um bloco **Sem empresa** com as órfãs, um select de
empresa e a ação inversa (limpar carimbo) nas já atribuídas.

## Webhook e o incidente de 2026-08-06

Existe **uma** URL de webhook por empresa,
`/api/whatsapp/webhook/uazapi/{whatsapp_config.id}`, e essa rota
autentica pelo UUID do caminho: ela carrega a config por `id` e, no
`warnOnInstanceMismatch` (linha 247), apenas **loga** quando o token do
evento não bate com o armazenado — e segue processando.

Logo, apontar uma instância *possuída mas não vinculada* para essa URL
faz as mensagens dela entrarem como conversas da instância vinculada, e
todo download de mídia usar o token errado — exatamente o incidente que
`saveUazapiConfig` documenta em comentário. Por isso:

- `/[id]/connect` **não** chama `setWebhook`. Uma instância não
  vinculada pode ser conectada por QR, mas não alimenta o CRM.
- `/[id]/bind` chama `setWebhook` na nova instância **e**
  `setWebhook({ enabled: false })` na que estava vinculada, para que
  duas instâncias nunca postem na mesma URL.

## Vínculo, criação e remoção

`whatsapp_config` é `UNIQUE(account_id)` (migração 017): a empresa pode
**possuir** várias instâncias, mas só uma é o canal ativo.

**`POST /` cria e possui, e nunca vincula.** O rascunho anterior
vinculava automaticamente quando a empresa não tinha instância UAZAPI —
mas a linha é compartilhada com o provider Meta, e `saveUazapiConfig`
escreve `provider:'uazapi', phone_number_id: null, waba_id: null`. Uma
empresa no Meta perderia o canal oficial por clicar em "Nova
instância". Vincular é sempre explícito.

**`POST /[id]/bind`** recebe `{ replace_existing?: boolean }` — sem
corpo não haveria como confirmar o 409 `requires_confirmation` que a
guarda reaproveitada exige, e a empresa nunca conseguiria trocar de
canal. Além das duas guardas de `saveUazapiConfig`, o `bind` recusa
sobrescrever uma config **Meta já preenchida** sem `replace_existing`.

Ao inserir uma linha nova, o `bind` preenche `user_id`: a coluna é
`NOT NULL` desde a migração 001 e a 017 a manteve.

**`DELETE /[id]`** deleta na UAZAPI e, se era a vinculada, zera
`uazapi_instance_id`, `uazapi_instance_name` e `uazapi_token` e marca
`status = 'disconnected'`. Como a linha continua com
`provider = 'uazapi'`, `send-message.ts:280` faria
`decrypt(config.uazapi_token)` sobre `null` e estouraria um
`TypeError`. Então **`send-message.ts` ganha uma guarda de nulo** que
cai no `whatsapp_not_configured` que a rota já sabe responder, em vez
de um 500 opaco.

## Carimbo automático e reversibilidade

Em toda listagem, idempotente: uma instância de `adminField01` vazio
recebe o `account_id` quando **as duas** condições valem —
`whatsapp_config.uazapi_base_url` é o mesmo servidor do env, e
`uazapi_instance_id` casa (ou, para linhas legadas sem `id`,
`uazapi_instance_name` casa). A checagem de servidor evita que uma
empresa apontada para outro servidor UAZAPI reivindique uma instância
homônima aqui. Instância já carimbada nunca é tocada.

Uma empresa cuja linha aponta para outro servidor vê um aviso dizendo
isso, em vez de um painel vazio sem explicação.

Carimbar é **reversível**: `DELETE /[id]/assign` limpa o campo. Sem
isso, um `account_id` errado tornaria a instância invisível para todos
— nem em `listUnownedInstances` (que exige campo vazio) nem em
`listOwnedInstances` — e a única saída seria o painel da UAZAPI, que é
justamente o que este trabalho remove. `POST /[id]/assign` também
valida que o `account_id` existe em `accounts`.

## Status e persistência

`GET /[id]/status` **mantém** o efeito que a rota removida tinha
(`uazapi/status/route.ts:77`): ao ver a instância conectar, grava
`status = 'connected'` e `connected_at` — mas só quando a instância
consultada é a vinculada. Sem isso, a guarda 2 do `bind`, condicionada
a `current.status === 'connected'`, não dispararia, e um admin trocaria
o canal da empresa em silêncio.

Para a instância vinculada, `/[id]/status` lê `id` e token direto de
`whatsapp_config` e **não** chama `GET /instance/all` — o polling de 3s
não deve baixar o inventário inteiro do servidor, com o token de toda
empresa, 20 vezes por leitura de QR.

## Correção fora do painel

`config/route.ts:553` e `:577` descartam o `error` das consultas das
duas guardas de 409 (`const { data: claimed } = await ...`). Com o
painel, duas linhas com o mesmo `uazapi_instance_name` passam a ser
alcançáveis, `maybeSingle()` devolve `PGRST116` com `data: null`, e a
guarda **falha aberta** justamente no caso para o qual foi escrita. As
duas passam a checar o `error` e a falhar fechadas.

## Erros

Cada rota devolve uma chave de tradução, não um literal. O 403 de posse
tem mensagem própria; o 409 do `bind` reaproveita os textos de
`saveUazapiConfig`. Env incompleto responde `{ configured: false }` com
200 — é um estado da tela, não um erro.

## Testes

Em vitest, ao lado do `uazapi.status.test.ts` existente:

- `uazapi.create.test.ts` — header `admintoken` e não `token`;
  `adminField01` no body; token lido de `data.token`, com fallback para
  `data.instance.token`.
- `uazapi-admin.test.ts` — recusa instância de outra empresa; aceita a
  própria; carimba só com servidor igual **e** id/nome casando; nunca
  sobrescreve carimbo alheio; `requireUnownedInstance` recusa carimbada.
- `uazapi.list.test.ts` — o payload que vai ao browser não contém
  `token` nem `openai_apikey`.
- `uazapi.bind.test.ts` — grava o token **criptografado**; preenche
  `user_id` ao inserir; recusa sobrescrever config Meta preenchida sem
  `replace_existing`; desliga o webhook da instância anterior.
- `send-message` — config uazapi com `uazapi_token` nulo responde
  `whatsapp_not_configured`, não 500.

## Ordem de implementação

1. Migração `uazapi_instance_id` + índice
2. Cliente (`uazapi.ts`) + testes
3. Helper de posse (`uazapi-admin.ts`) + testes
4. Guarda de nulo em `send-message.ts` e fail-closed em
   `config/route.ts` + testes
5. Rotas
6. UI + chaves em `pt-BR.json` e `en.json`
7. Remoção do formulário antigo e das rotas `/uazapi/connect` e
   `/uazapi/status`
