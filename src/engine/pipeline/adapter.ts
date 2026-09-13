// UI compatibility: converts a PipelineResult into the exact `SimulationResult`/`SimulationStep`
// shape the existing Task Flow / Send Request UI already renders (EventTimeline.tsx,
// NodeStatusModal.tsx, SimulationControls.tsx) - so this engine can be adopted by that UI with
// zero component changes, per this phase's "do not unnecessarily redesign the UI" instruction.
import type { ProtocolType, SimulationResult, SimulationScenario, SimulationStep } from '../../types/index.ts';
import type { PipelineResult } from './types.ts';

function statusFromHop(passed: boolean): SimulationStep['status'] {
  return passed ? 'success' : 'failed';
}

export function toSimulationResult(scenario: SimulationScenario, result: PipelineResult): SimulationResult {
  const steps: SimulationStep[] = [];
  let stepNumber = 1;
  let timestampMs = 0;

  for (let i = 1; i < result.hops.length; i++) {
    const source = result.hops[i - 1];
    const target = result.hops[i];
    const decisiveCheck = target.checks.find(c => !c.passed) || target.checks[target.checks.length - 1];
    const latencyMs = target.outcome === 'failed' ? 50 : 15;
    timestampMs += latencyMs;

    steps.push({
      id: `unified-step-${stepNumber}`,
      stepNumber: stepNumber++,
      timestampMs,
      sourceNodeId: source.nodeId,
      targetNodeId: target.nodeId,
      sourceNodeName: source.label,
      targetNodeName: target.label,
      protocol: (scenario as any).protocol || 'HTTP' as ProtocolType,
      action: decisiveCheck?.label || 'Forward request',
      status: statusFromHop(target.outcome !== 'failed'),
      explanation: target.checks.map(c => c.detail).filter(Boolean).join(' '),
      targetHealth: target.outcome === 'failed' ? 'failed' : 'healthy',
      latencyMs,
      details: target.outcome === 'failed' ? { statusCode: result.legacyStatusCode, failureReason: result.reason } : undefined
    });
  }

  return {
    scenario,
    steps,
    success: result.status === 'SUCCESS',
    totalLatencyMs: timestampMs,
    statusCode: result.legacyStatusCode,
    summary: result.reason,
    bottlenecksDetected: result.status === 'TIMEOUT' || result.status === 'UNAVAILABLE' ? [result.reason] : [],
    cascadeOccurred: false,
    path: result.hops.map(h => h.nodeId)
  };
}
