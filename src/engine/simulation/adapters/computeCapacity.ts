import { ecsModel } from '../../service/models/ecs.ts';
import type { AdapterContext, AdapterSignal } from './types.ts';
import { CONTINUE, TERMINATE } from './types.ts';
import { evaluateCapacity } from '../../service/models/compute.ts';

const COMPUTE_SERVICE_IDS = ['ec2', 'ecs', 'lambda', 'fargate', 'app_runner'];
const SERVERLESS_SERVICE_IDS = ['lambda', 'fargate', 'app_runner'];

/**
 * Auto-scaling vs. capacity-saturation check for compute nodes under a traffic spike. The
 * decision itself (`evaluateCapacity`) now lives in `src/engine/service/models/compute.ts` -
 * this Phase 7 extraction, per the phase's own instruction to remove service-specific behavior
 * from generic request code. This adapter's only remaining job is translating that decision into
 * the trace steps the traversal loop expects; the decision logic is identical to before and
 * shared with the standalone Service Behavior Engine (see `test/service-engine.test.ts`).
 */
export const computeCapacityAdapter = (ctx: AdapterContext): AdapterSignal => {
  const { trace, node, nodes, scenario } = ctx;

  if (node.data.serviceId === 'ecs') {
    const outcome = ecsModel.processRequest({ target: node.data, action: scenario.method });
    trace.pushStep({ sourceNodeId: node.id, targetNodeId: node.id,
      sourceNodeName: node.data.label, targetNodeName: node.data.label, protocol: 'HTTP',
      action: 'ECS running task availability', status: outcome.status === 'failure' ? 'failed' : 'success',
      explanation: outcome.status === 'failure' ? outcome.reason : outcome.detail,
      targetHealth: node.data.health, latencyMs: 0 });
    if (outcome.status === 'failure') { trace.fail(outcome.statusCode, outcome.reason); return TERMINATE; }
    return CONTINUE;
  }

  const isCompute = COMPUTE_SERVICE_IDS.includes(node.data.serviceId);
  if (!isCompute) {
    return CONTINUE;
  }

  const isServerless = SERVERLESS_SERVICE_IDS.includes(node.data.serviceId);
  const verdict = evaluateCapacity(node.data, nodes.map(n => n.data), scenario.trafficLevel, isServerless);

  if (verdict.decision === 'pass-through') {
    return CONTINUE;
  }

  if (verdict.decision === 'scaled-out') {
    const currentCount = node.data.replicas || 1;
    trace.pushStep({
      sourceNodeId: node.id,
      targetNodeId: node.id,
      sourceNodeName: node.data.label,
      targetNodeName: node.data.label,
      protocol: 'HTTP',
      action: isServerless ? 'Serverless Elastic Concurrency Scaling' : 'Auto Scaling Group: Dynamic Scale-Out',
      status: 'success',
      explanation: isServerless
        ? `${node.data.label} detected traffic surge (${scenario.trafficLevel.toUpperCase()}). Serverless control plane instantly provisioned concurrent execution environments without provisioning servers.`
        : `High traffic (${scenario.trafficLevel.toUpperCase()}) breached CloudWatch alarm (CPU > 75%). Auto Scaling Group launched +${verdict.scaledCount - currentCount} instances across Availability Zones (Total: ${verdict.scaledCount} targets). Load successfully balanced!`,
      targetHealth: 'healthy',
      latencyMs: 30,
      details: {
        recoveryApplied: `Dynamic Auto Scaling expanded capacity to ${verdict.scaledCount} targets, preventing saturation.`
      }
    });
    trace.advanceTime(30);
    return CONTINUE;
  }

  // verdict.decision === 'saturated'
  trace.pushStep({
    sourceNodeId: node.id,
    targetNodeId: node.id,
    sourceNodeName: node.data.label,
    targetNodeName: node.data.label,
    protocol: 'HTTP',
    action: 'Instance Capacity Saturation (No Auto-Scaling)',
    status: 'failed',
    explanation: `CRITICAL BOTTLENECK: ${node.data.label} is deployed as a single instance (replicas: 1) without an Auto Scaling Group. Under ${scenario.trafficLevel.toUpperCase()} load surge, CPU hit 100% and connection thread pool was completely exhausted. Request timed out (504 Gateway Timeout).`,
    targetHealth: 'failed',
    latencyMs: 5000,
    details: {
      statusCode: 504,
      failureReason: 'Compute instance saturated. No Auto Scaling Group configured.'
    }
  });
  trace.addBottleneck(`${node.data.label} single instance saturated under ${scenario.trafficLevel} load.`);
  trace.fail(504, `${node.data.label} capacity saturated: Configure an Auto Scaling Group or increase replicas.`);
  trace.cascadeOccurred = true;
  return TERMINATE;
};
