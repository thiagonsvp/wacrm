'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Clipboard,
  Download,
  FileChartColumn,
  Loader2,
  Plus,
  Save,
  Sparkles,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
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
import {
  normalizeCustomReportResult,
  type CustomReportChart,
} from '@/lib/custom-reports/result';
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

function RichText({ value }: { value: string }) {
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

const CHART_COLORS = [
  '#7c3aed',
  '#0891b2',
  '#16a34a',
  '#ea580c',
  '#dc2626',
  '#4f46e5',
  '#0d9488',
  '#ca8a04',
];

const chartNumber = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function ReportChart({ chart }: { chart: CustomReportChart }) {
  const hasLongLabels = chart.data.some((point) => point.label.length > 18);
  const useHorizontalBars =
    chart.type === 'bar' && (hasLongLabels || chart.data.length > 6);
  const usePie = chart.type === 'pie' && chart.data.length <= 6;
  const chartHeight = useHorizontalBars
    ? Math.max(288, chart.data.length * 48 + 40)
    : 320;
  const shortLabel = (value: unknown, maximum = 24) => {
    const label = String(value);
    return label.length > maximum ? `${label.slice(0, maximum - 1)}…` : label;
  };
  const common = {
    data: chart.data,
    margin: { top: 8, right: 36, bottom: 12, left: 0 },
  };

  return (
    <div className="break-inside-avoid rounded-xl border p-4">
      <h3 className="mb-4 font-semibold">{chart.title}</h3>
      <div className="w-full" style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          {usePie ? (
            <PieChart>
              <Pie
                data={chart.data}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="48%"
                outerRadius="68%"
                label={({ percent }) => `${Math.round((percent ?? 0) * 100)}%`}
              >
                {chart.data.map((point, index) => (
                  <Cell
                    key={`${point.label}-${index}`}
                    fill={CHART_COLORS[index % CHART_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => [Number(value).toLocaleString('pt-BR'), 'Valor']}
              />
              <Legend
                verticalAlign="bottom"
                formatter={(value) => shortLabel(value, 28)}
              />
            </PieChart>
          ) : chart.type === 'line' ? (
            <LineChart {...common}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                interval="preserveStartEnd"
                tickFormatter={(value) => shortLabel(value, 14)}
              />
              <YAxis tickFormatter={(value) => chartNumber.format(Number(value))} width={48} />
              <Tooltip
                formatter={(value) => [Number(value).toLocaleString('pt-BR'), 'Valor']}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={CHART_COLORS[0]}
                strokeWidth={3}
                dot={{ r: 3 }}
              />
            </LineChart>
          ) : useHorizontalBars || chart.type === 'pie' ? (
            <BarChart {...common} layout="vertical" margin={{ ...common.margin, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(value) => chartNumber.format(Number(value))}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={176}
                tick={{ fontSize: 11 }}
                tickFormatter={(value) => shortLabel(value, 26)}
              />
              <Tooltip
                formatter={(value) => [Number(value).toLocaleString('pt-BR'), 'Valor']}
              />
              <Bar dataKey="value" fill={CHART_COLORS[0]} radius={[0, 6, 6, 0]}>
                <LabelList
                  dataKey="value"
                  position="right"
                  formatter={(value: unknown) => chartNumber.format(Number(value))}
                  className="fill-foreground text-xs font-medium"
                />
              </Bar>
            </BarChart>
          ) : (
            <BarChart {...common}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                interval={0}
                tickFormatter={(value) => shortLabel(value, 12)}
              />
              <YAxis tickFormatter={(value) => chartNumber.format(Number(value))} width={48} />
              <Tooltip
                formatter={(value) => [Number(value).toLocaleString('pt-BR'), 'Valor']}
              />
              <Bar dataKey="value" fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]}>
                <LabelList
                  dataKey="value"
                  position="top"
                  formatter={(value: unknown) => chartNumber.format(Number(value))}
                  className="fill-foreground text-xs font-medium"
                />
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ReportContent({ value }: { value: string }) {
  const report = useMemo(() => normalizeCustomReportResult(value), [value]);

  return (
    <div className="space-y-7 text-foreground">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Dashboard comercial
        </p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight">{report.title}</h2>
        {report.summary ? (
          <p className="mt-3 max-w-4xl text-sm leading-6 text-muted-foreground sm:text-base">
            {report.summary}
          </p>
        ) : null}
      </div>

      {report.metrics.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {report.metrics.map((metric, index) => (
            <div
              key={`${metric.label}-${index}`}
              className="break-inside-avoid rounded-xl border bg-muted/20 p-4"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {metric.label}
              </p>
              <p className="mt-2 text-2xl font-bold">{metric.value}</p>
              {metric.detail ? (
                <p className="mt-1 text-xs text-muted-foreground">{metric.detail}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {report.charts.length ? (
        <div
          className={cn(
            'grid gap-4',
            report.charts.length > 1 && 'xl:grid-cols-2'
          )}
        >
          {report.charts.map((chart, index) => (
            <ReportChart key={`${chart.title}-${index}`} chart={chart} />
          ))}
        </div>
      ) : null}

      {report.sections.map((section, index) => (
        <section
          key={`${section.title}-${index}`}
          className="break-inside-avoid border-t pt-5"
        >
          <h3 className="mb-2 text-lg font-semibold">{section.title}</h3>
          <RichText value={section.content} />
        </section>
      ))}
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
  const [exportingPdf, setExportingPdf] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

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
    const parsed = normalizeCustomReportResult(result);
    const plainText = [
      parsed.title,
      parsed.summary,
      ...parsed.metrics.map((metric) => `${metric.label}: ${metric.value}`),
      ...parsed.sections.flatMap((section) => [section.title, section.content]),
    ]
      .filter(Boolean)
      .join('\n\n');
    await navigator.clipboard.writeText(plainText);
    toast.success('Relatório copiado.');
  }

  async function exportPdf() {
    if (!reportRef.current) return;
    setExportingPdf(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas-pro'),
        import('jspdf'),
      ]);
      const canvas = await html2canvas(reportRef.current, {
        backgroundColor: '#ffffff',
        scale: Math.min(window.devicePixelRatio || 1, 2),
        useCORS: true,
      });

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = 194;
      const pageHeight = 281;
      const sliceHeight = Math.floor((canvas.width * pageHeight) / pageWidth);
      let offset = 0;
      let page = 0;

      while (offset < canvas.height) {
        const height = Math.min(sliceHeight, canvas.height - offset);
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = height;
        const context = pageCanvas.getContext('2d');
        if (!context) throw new Error('Não foi possível montar a página do PDF.');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        context.drawImage(
          canvas,
          0,
          offset,
          canvas.width,
          height,
          0,
          0,
          canvas.width,
          height
        );
        if (page > 0) pdf.addPage();
        pdf.addImage(
          pageCanvas.toDataURL('image/jpeg', 0.94),
          'JPEG',
          8,
          8,
          pageWidth,
          (height * pageWidth) / canvas.width
        );
        offset += height;
        page += 1;
      }

      const filename = (name || 'relatorio-personalizado')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
      pdf.save(`${filename || 'relatorio-personalizado'}.pdf`);
      toast.success('PDF gerado com sucesso.');
    } catch (error) {
      console.error('[custom-report] PDF export failed:', error);
      toast.error('Não foi possível gerar o PDF. Tente novamente.');
    } finally {
      setExportingPdf(false);
    }
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
                      onClick={() => void exportPdf()}
                      disabled={exportingPdf}
                    >
                      {exportingPdf ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      {exportingPdf ? 'Gerando PDF...' : 'Baixar PDF'}
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
                <div
                  ref={reportRef}
                  className="bg-background rounded-lg border p-5 sm:p-7"
                >
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
