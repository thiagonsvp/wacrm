export type CustomReportChartType = 'bar' | 'line' | 'pie';

export interface CustomReportMetric {
  label: string;
  value: string;
  detail?: string;
}

export interface CustomReportChart {
  title: string;
  type: CustomReportChartType;
  data: Array<{ label: string; value: number }>;
}

export interface CustomReportSection {
  title: string;
  content: string;
}

export interface CustomReportResult {
  version: 1;
  title: string;
  summary: string;
  metrics: CustomReportMetric[];
  charts: CustomReportChart[];
  sections: CustomReportSection[];
}

const MAX_METRICS = 8;
const MAX_CHARTS = 4;
const MAX_POINTS = 16;
const MAX_SECTIONS = 8;

function text(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function extractJson(raw: string): unknown {
  const withoutFence = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('JSON ausente');
  return JSON.parse(withoutFence.slice(start, end + 1));
}

/**
 * Convert the model output into the small, safe contract consumed by the UI.
 * Invalid/legacy output remains useful as a textual report instead of making
 * a successful AI request look like an error to the user.
 */
export function normalizeCustomReportResult(raw: string): CustomReportResult {
  try {
    const parsed = extractJson(raw) as Record<string, unknown>;
    const metrics = Array.isArray(parsed.metrics)
      ? parsed.metrics
          .slice(0, MAX_METRICS)
          .map((item) => {
            const row = item as Record<string, unknown>;
            return {
              label: text(row.label, 80),
              value: text(row.value, 80),
              detail: text(row.detail, 140) || undefined,
            };
          })
          .filter((item) => item.label && item.value)
      : [];

    const charts = Array.isArray(parsed.charts)
      ? parsed.charts
          .slice(0, MAX_CHARTS)
          .map((item) => {
            const chart = item as Record<string, unknown>;
            const requestedType = text(chart.type, 10);
            const type: CustomReportChartType = ['bar', 'line', 'pie'].includes(
              requestedType
            )
              ? (requestedType as CustomReportChartType)
              : 'bar';
            const data = Array.isArray(chart.data)
              ? chart.data
                  .slice(0, MAX_POINTS)
                  .map((point) => {
                    const row = point as Record<string, unknown>;
                    return {
                      label: text(row.label, 60),
                      value: Number(row.value),
                    };
                  })
                  .filter(
                    (point) => point.label && Number.isFinite(point.value)
                  )
              : [];
            return { title: text(chart.title, 120), type, data };
          })
          .filter((chart) => chart.title && chart.data.length > 0)
      : [];

    const sections = Array.isArray(parsed.sections)
      ? parsed.sections
          .slice(0, MAX_SECTIONS)
          .map((item) => {
            const row = item as Record<string, unknown>;
            return {
              title: text(row.title, 120),
              content: text(row.content, 4000),
            };
          })
          .filter((item) => item.title && item.content)
      : [];

    const title = text(parsed.title, 140);
    const summary = text(parsed.summary, 2000);
    if (!title && !summary && !metrics.length && !charts.length && !sections.length) {
      throw new Error('Relatório estruturado vazio');
    }

    return {
      version: 1,
      title: title || 'Relatório personalizado',
      summary,
      metrics,
      charts,
      sections,
    };
  } catch {
    return {
      version: 1,
      title: 'Relatório personalizado',
      summary: '',
      metrics: [],
      charts: [],
      sections: [{ title: 'Análise', content: raw.trim() }],
    };
  }
}

export function serializeCustomReportResult(raw: string): string {
  return JSON.stringify(normalizeCustomReportResult(raw));
}

