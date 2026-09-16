import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  MonitorUp,
  ShieldCheck,
} from 'lucide-react';

import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

const GOOGLE_SCOPES =
  'https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/datamanager';

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex gap-4">
        <span className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{title}</h2>
          <div className="text-muted-foreground mt-3 space-y-3 text-sm leading-6">
            {children}
          </div>
        </div>
      </div>
    </Card>
  );
}

function ExternalDoc({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary inline-flex items-center gap-1 font-medium hover:underline"
    >
      {children}
      <ExternalLink className="size-3.5" />
    </a>
  );
}

export default function GoogleAdsHelpPage() {
  return (
    <div className="mx-auto max-w-4xl pb-10">
      <Link
        href="/settings?tab=google-ads"
        className={buttonVariants({
          variant: 'ghost',
          className: 'mb-3 -ml-2',
        })}
      >
        <ArrowLeft />
        Voltar ao Google Ads
      </Link>

      <div className="mb-6">
        <p className="text-primary text-sm font-medium">Central de ajuda</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
          Configurar Google Ads no CRM
        </h1>
        <p className="text-muted-foreground mt-2 max-w-3xl text-sm leading-6">
          Faça a configuração do CRM uma vez para cada empresa. O webhook, o
          código e as ações de conversão são exclusivos da empresa selecionada e
          podem ser usados na home e em todas as landing pages HTML dela.
        </p>
      </div>

      <Card className="border-primary/20 bg-primary/5 mb-5 p-5">
        <div className="flex gap-3">
          <ShieldCheck className="text-primary mt-0.5 size-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Antes de começar</p>
            <p className="text-muted-foreground mt-1 text-sm leading-6">
              Nunca envie Client Secret, Refresh Token ou o endereço completo do
              webhook por mensagem ou captura de tela. Cada cliente deve ter sua
              própria empresa e seu próprio webhook no CRM.
            </p>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <Step number={1} title="Cadastre ou selecione a empresa">
          <p>
            Em <strong>Configurações → Empresa</strong>, cadastre o cliente.
            Depois, use o seletor de empresas do menu para entrar no workspace
            correto antes de abrir a configuração do Google Ads.
          </p>
          <p>
            Contatos, credenciais, webhook e conversões ficam isolados por
            empresa.
          </p>
        </Step>

        <Step number={2} title="Prepare o projeto no Google Cloud">
          <p>
            Se a agência usa uma conta administradora MCC, o mesmo projeto e
            cliente OAuth podem atender às contas que ela administra. Sem MCC,
            use um projeto e uma autorização com acesso direto à conta do
            cliente.
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Crie ou selecione o projeto do cliente.</li>
            <li>
              Ative a <strong>Google Ads API</strong>.
            </li>
            <li>
              Ative a <strong>Data Manager API</strong>.
            </li>
            <li>
              Em Google Auth Platform, configure o aplicativo como Externo,
              preencha a marca e adicione o domínio autorizado.
            </li>
          </ol>
          <ExternalDoc href="https://console.cloud.google.com/apis/library">
            Abrir biblioteca de APIs
          </ExternalDoc>
        </Step>

        <Step number={3} title="Adicione os escopos OAuth">
          <p>Adicione os dois escopos abaixo à tela de consentimento:</p>
          <code className="bg-muted text-foreground block overflow-x-auto rounded-md border p-3 text-xs">
            {GOOGLE_SCOPES}
          </code>
          <p>
            O primeiro permite consultar a conta Google Ads; o segundo permite
            enviar as conversões pela Data Manager API.
          </p>
        </Step>

        <Step number={4} title="Crie o cliente OAuth Web">
          <ol className="list-decimal space-y-1 pl-5">
            <li>Crie uma credencial do tipo Aplicativo da Web.</li>
            <li>
              Adicione{' '}
              <code>https://developers.google.com/oauthplayground</code> como
              URI de redirecionamento autorizada.
            </li>
            <li>Guarde o Client ID e o Client Secret com segurança.</li>
          </ol>
        </Step>

        <Step number={5} title="Gere o Refresh Token">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Abra o{' '}
              <ExternalDoc href="https://developers.google.com/oauthplayground">
                OAuth 2.0 Playground
              </ExternalDoc>
              .
            </li>
            <li>
              Na engrenagem, marque{' '}
              <strong>Use your own OAuth credentials</strong> e informe o Client
              ID e o Client Secret.
            </li>
            <li>Cole os dois escopos do passo anterior.</li>
            <li>Clique em Authorize APIs e aceite as permissões.</li>
            <li>Troque o código por tokens e copie somente o Refresh Token.</li>
          </ol>
          <p>
            Se alterar os escopos depois, remova a conexão antiga em{' '}
            <ExternalDoc href="https://myaccount.google.com/connections">
              Conexões da Conta Google
            </ExternalDoc>{' '}
            e gere um novo token.
          </p>
        </Step>

        <Step number={6} title="Crie as ações de conversão">
          <p>
            No Google Ads, acesse{' '}
            <strong>
              Metas → Conversões → Resumo → Criar ação de conversão
            </strong>
            . Escolha conversões off-line/importação de CRM e rastreamento por
            cliques.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Crie uma ação na categoria <strong>Lead qualificado</strong>.
            </li>
            <li>
              Crie outra ação na categoria <strong>Lead convertido</strong>.
            </li>
          </ul>
          <p>
            Abra cada ação e copie o número de <code>ctId</code> da URL. Esse é
            o ID numérico usado nos campos do CRM. Aguarde de 4 a 6 horas antes
            do primeiro envio.
          </p>
          <ExternalDoc href="https://support.google.com/google-ads/answer/7012522">
            Instruções oficiais do Google Ads
          </ExternalDoc>
        </Step>

        <Step number={7} title="Preencha e valide no CRM">
          <ol className="list-decimal space-y-1 pl-5">
            <li>Informe o ID de 10 dígitos da conta de anúncios.</li>
            <li>Use o ID administrador somente quando houver uma conta MCC.</li>
            <li>Informe Client ID, Client Secret e Refresh Token.</li>
            <li>Informe os IDs de Lead qualificado e Venda.</li>
            <li>Salve e clique em Testar conexão.</li>
          </ol>
          <p>
            O Developer Token é opcional para contas já migradas ao novo modelo
            de acesso do Google Cloud.
          </p>
        </Step>

        <Step number={8} title="Para anúncios que abrem o WhatsApp direto">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Em <strong>Campanhas direto para WhatsApp</strong>, informe o
              telefone com DDI/DDD e a mensagem inicial.
            </li>
            <li>Clique em Salvar e gerar link.</li>
            <li>
              Copie a URL gerada como URL final do anúncio, preservando{' '}
              <code>{'{gclid}'}</code> e <code>{'{campaignid}'}</code>.
            </li>
          </ol>
          <p>
            A cada clique, o CRM cria cinco caracteres, como <code>AB7K2</code>,
            e abre o WhatsApp com esse protocolo. Quando a mensagem chega, o
            telefone fornecido pelo WhatsApp é associado ao identificador do
            clique armazenado no CRM.
          </p>
        </Step>

        <Step number={9} title="Para anúncios que passam pelo site ou LP">
          <p>
            No campo <strong>Sites e LPs autorizados</strong>, informe uma URL
            HTTPS por linha. Páginas do mesmo domínio precisam ser cadastradas
            apenas uma vez; subdomínios e domínios diferentes precisam de linhas
            próprias.
          </p>
          <code className="bg-muted text-foreground block rounded-md border p-3 text-xs whitespace-pre">
            {
              'https://cliente.com.br\nhttps://lp.cliente.com.br\nhttps://oferta-outro-dominio.com.br'
            }
          </code>
        </Step>

        <Step number={10} title="Instale o código nas páginas HTML">
          <div className="flex gap-3">
            <MonitorUp className="text-primary mt-0.5 size-5 shrink-0" />
            <div>
              <p>
                Copie o código gerado pelo CRM e cole exatamente antes de{' '}
                <code>&lt;/body&gt;</code> na home e em cada LP. Use o mesmo
                código em todas as páginas do mesmo cliente.
              </p>
              <p>
                Remova versões antigas para não duplicar o envio. Depois,
                publique os arquivos HTML no servidor.
              </p>
            </div>
          </div>
        </Step>

        <Step number={11} title="Ative e confira o fluxo">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Abra uma LP com um parâmetro de teste, como{' '}
              <code>?utm_source=teste</code>.
            </li>
            <li>Envie o formulário usando um telefone de teste.</li>
            <li>
              Confirme que o contato apareceu no CRM com a origem registrada.
            </li>
            <li>
              Após a espera de 4 a 6 horas, ative os envios de lead e venda.
            </li>
          </ol>
          <div className="text-foreground mt-3 flex items-center gap-2">
            <CheckCircle2 className="size-4 text-emerald-500" />A integração
            está pronta quando conexão, captura e atribuição forem validadas.
          </div>
        </Step>
      </div>

      <Card className="mt-5 p-5">
        <div className="flex gap-3">
          <KeyRound className="text-primary mt-0.5 size-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Ao cadastrar outro cliente</p>
            <p className="text-muted-foreground mt-1 text-sm leading-6">
              Crie a empresa, selecione-a no menu e repita o guia. Nunca
              reutilize o webhook nem as ações de conversão de outra empresa. As
              credenciais OAuth só podem ser compartilhadas quando pertencem ao
              mesmo aplicativo da agência e acessam os clientes por uma MCC.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
