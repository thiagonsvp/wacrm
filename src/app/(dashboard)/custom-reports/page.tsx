'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Clipboard,
  FileChartColumn,
  Loader2,
  Plus,
  Printer,
  Save,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface CustomReport {
  id: string;
  name: string;
  prompt: string;
  last_result: string | null;
  last_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

const EXAMPLES = [
  'Mostre o valor do pipeline por etapa, destaque os maiores negócios em aberto e sugira as próximas ações comerciais.',
  'Compare leads por origem, taxa de avanço no pipeline e receita ganha. Aponte onde estamos perdendo oportunidades.',
  'Crie um resumo executivo dos negócios dos últimos 30 dias, com riscos, oportunidades e prioridades para esta semana.',
];

async function responseJson(response: Response) {
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(json?.error ?? 'Não foi possível concluir a operação.');
  }
  return json;
}

function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, index) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={index}>{part.slice(2, -2)}</strong>
      ) : (
        part
      )
    );
}

function ReportContent({ value }: { value: string }) {
  return (
    <div className="text-foreground space-y-2 text-sm leading-7 sm:text-base">
      {value.split('\n').map((raw, index) => {
        const line = raw.trim();
        if (!line) return <div key={index} className="h-2" />;
        if (line.startsWith('### ')) {
          return (
            <h4 key={index} className="pt-3 text-base font-semibold">
              {inline(line.slice(4))}
            </h4>
          );
        }
        if (line.startsWith('## ')) {
          return (
            <h3 key={index} className="pt-4 text-lg font-semibold">
              {inline(line.slice(3))}
            </h3>
          );
        }
        if (line.startsWith('# ')) {
          return (
            <h2 key={index} className="pt-2 text-xl font-bold">
              {inline(line.slice(2))}
            </h2>
          );
        }
        if (/^[-*]\s/.test(line)) {
          return (
            <div key={index} className="flex gap-2 pl-2">
              <span className="text-primary">•</span>
              <p>{inline(line.slice(2))}</p>
            </div>
          );
        }
        return <p key={index}>{inline(line)}</p>;
      })}
    </div>
  );
}

export default function CustomReportsPage() {
  const [reports, setReports] = useState<CustomReport[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState('');
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const selectReport = useCallback((report: CustomReport) => {
    setSelectedId(report.id);
    setName(report.name);
    setPrompt(report.prompt);
    setResult(report.last_result ?? '');
    setGeneratedAt(report.last_generated_at);
  }, []);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const json = await responseJson(await fetch('/api/custom-reports'));
      const rows = (json.reports ?? []) as CustomReport[];
      setReports(rows);
      if (rows.length) selectReport(rows[0]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao carregar relatórios.'
      );
    } finally {
      setLoading(false);
    }
  }, [selectReport]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  function newReport() {
    setSelectedId(null);
    setName('');
    setPrompt('');
    setResult('');
    setGeneratedAt(null);
  }

  function mergeReport(report: CustomReport) {
    setReports((current) => {
      const next = current.filter((item) => item.id !== report.id);
      return [report, ...next];
    });
    selectReport(report);
  }

  async function persist(showSuccess: boolean): Promise<CustomReport | null> {
    if (!name.trim()) {
      toast.error('Dê um nome ao relatório.');
      return null;
    }
    if (prompt.trim().length < 10) {
      toast.error('Descreva o relatório com pelo menos 10 caracteres.');
      return null;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/custom-reports', {
        method: selectedId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId, name, prompt }),
      });
      const json = await responseJson(response);
      const saved = json.report as CustomReport;
      mergeReport(saved);
      if (showSuccess) toast.success('Prompt salvo.');
      return saved;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao salvar.');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function generate() {
    setGenerating(true);
    try {
      const saved = await persist(false);
      if (!saved) return;
      const json = await responseJson(
        await fetch('/api/custom-reports/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reportId: saved.id }),
        })
      );
      const generated = json.report as CustomReport;
      mergeReport(generated);
      toast.success('Relatório gerado com os dados atuais.');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao gerar relatório.'
      );
    } finally {
      setGenerating(false);
    }
  }

  async function copyResult() {
    await navigator.clipboard.writeText(result);
    toast.success('Relatório copiado.');
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <FileChartColumn className="text-primary h-6 w-6" />
            Relatório Personalizado
          </h1>
          <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
            Salve uma pergunta ou instrução e transforme os dados atuais do CRM
            em um relatório feito pela IA.
          </p>
        </div>
        <Button variant="outline" onClick={newReport}>
          <Plus className="mr-2 h-4 w-4" />
          Novo relatório
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Prompts salvos</CardTitle>
            <CardDescription>
              Escolha um modelo para editar ou gerar novamente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <div className="text-muted-foreground flex items-center gap-2 py-6">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
              </div>
            ) : reports.length === 0 ? (
              <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
                Nenhum relatório salvo ainda.
              </p>
            ) : (
              reports.map((report) => (
                <button
                  key={report.id}
                  type="button"
                  onClick={() => selectReport(report)}
                  className={cn(
                    'hover:bg-muted/60 w-full rounded-lg border p-3 text-left transition-colors',
                    selectedId === report.id && 'border-primary bg-primary/5'
                  )}
                >
                  <span className="block truncate font-medium">
                    {report.name}
                  </span>
                  <span className="text-muted-foreground mt-1 line-clamp-2 block text-xs">
                    {report.prompt}
                  </span>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuração do relatório</CardTitle>
              <CardDescription>
                O prompt é salvo para toda a empresa e pode ser reutilizado com
                dados atualizados.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="report-name">Nome</Label>
                <Input
                  id="report-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  placeholder="Ex.: Resumo comercial semanal"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="report-prompt">Prompt</Label>
                <Textarea
                  id="report-prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  maxLength={4000}
                  className="min-h-40 resize-y"
                  placeholder="Descreva os indicadores, comparações e análises que deseja receber..."
                />
                <div className="text-muted-foreground flex justify-between text-xs">
                  <span>
                    Use datas, etapas e objetivos específicos para obter uma
                    análise melhor.
                  </span>
                  <span>{prompt.length}/4.000</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((example, index) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setPrompt(example)}
                    className="text-muted-foreground hover:border-primary hover:text-foreground rounded-full border px-3 py-1.5 text-xs transition-colors"
                  >
                    Exemplo {index + 1}
                  </button>
                ))}
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  onClick={() => void persist(true)}
                  disabled={saving || generating}
                >
                  {saving && !generating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Salvar prompt
                </Button>
                <Button
                  onClick={() => void generate()}
                  disabled={saving || generating}
                >
                  {generating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  {generating ? 'Gerando...' : 'Gerar relatório'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Resultado</CardTitle>
                  <CardDescription>
                    {generatedAt
                      ? `Gerado em ${new Date(generatedAt).toLocaleString('pt-BR')}`
                      : 'O relatório aparecerá aqui após a geração.'}
                  </CardDescription>
                </div>
                {result ? (
                  <div className="flex gap-2 print:hidden">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void copyResult()}
                    >
                      <Clipboard className="mr-2 h-4 w-4" /> Copiar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.print()}
                    >
                      <Printer className="mr-2 h-4 w-4" /> Imprimir
                    </Button>
                  </div>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              {generating ? (
                <div className="bg-muted/20 flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center">
                  <Loader2 className="text-primary h-8 w-8 animate-spin" />
                  <div>
                    <p className="font-medium">Analisando os dados do CRM</p>
                    <p className="text-muted-foreground text-sm">
                      A IA está montando o relatório conforme o prompt salvo.
                    </p>
                  </div>
                </div>
              ) : result ? (
                <div className="bg-background rounded-lg border p-5 sm:p-7">
                  <ReportContent value={result} />
                </div>
              ) : (
                <div className="bg-muted/20 flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center">
                  <Sparkles className="text-muted-foreground mb-3 h-8 w-8" />
                  <p className="font-medium">Pronto para criar sua análise</p>
                  <p className="text-muted-foreground mt-1 max-w-md text-sm">
                    Salve um prompt ou escolha um exemplo e clique em Gerar
                    relatório.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
