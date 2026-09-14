import { describe, expect, it } from 'vitest';
import {
  normalizeCustomReportResult,
  serializeCustomReportResult,
} from './result';

describe('normalizeCustomReportResult', () => {
  it('accepts fenced JSON and sanitizes chart values', () => {
    const result = normalizeCustomReportResult(`\`\`\`json
      {"title":"Funil","summary":"Visão geral","metrics":[{"label":"Receita","value":"R$ 12.000"}],"charts":[{"title":"Por etapa","type":"pie","data":[{"label":"Novo","value":12},{"label":"Inválido","value":"x"}]}],"sections":[]}
    \`\`\``);

    expect(result.title).toBe('Funil');
    expect(result.metrics).toHaveLength(1);
    expect(result.charts[0]).toEqual({
      title: 'Por etapa',
      type: 'pie',
      data: [{ label: 'Novo', value: 12 }],
    });
  });

  it('keeps legacy Markdown as a textual section', () => {
    const result = normalizeCustomReportResult('# Resultado\n\nTexto antigo');

    expect(result.charts).toEqual([]);
    expect(result.sections[0].content).toContain('Texto antigo');
    expect(JSON.parse(serializeCustomReportResult('# Antigo')).version).toBe(1);
  });
});
