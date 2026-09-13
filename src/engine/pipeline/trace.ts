// Renders a PipelineResult as the exact arrow/checkmark explainability format requested for this
// phase - a compact, human-readable trace independent of any UI framework.
import type { PipelineResult } from './types.ts';

export function renderTrace(result: PipelineResult): string {
  const lines: string[] = [];

  result.hops.forEach((hop, i) => {
    lines.push(hop.label);
    for (const check of hop.checks) {
      lines.push(` ${check.passed ? '✓' : '✗'} ${check.label}`);
    }
    if (i < result.hops.length - 1) lines.push(' ↓');
  });

  lines.push('');
  lines.push('FINAL:');
  lines.push(result.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED');
  lines.push('');
  lines.push('REASON:');
  lines.push(result.reason);

  return lines.join('\n');
}
