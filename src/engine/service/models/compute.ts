// Compute service models: EC2, ECS, Fargate, EKS (instance/task/node-group capacity), and Lambda
// (serverless invocation - no capacity concept at all). Capacity logic mirrors
// `adapters/computeCapacity.ts` exactly - this is the module that adapter now delegates to (see
// that file's own comment), the concrete "remove service-specific behavior from generic request
// code" this phase asked for.
import type {
  ConfigIssue,
  EndpointCapabilities,
  FailureModeDescriptor,
  ServiceModel,
  ServiceNodeSnapshot,
  ServiceRequestInput,
  ServiceRequestOutcome
} from '../types.ts';

const SPIKE_LOAD_LEVELS = ['high', 'very_high', '10x', '100x'];
const EXTREME_LOAD_LEVELS = ['10x', '100x'];

export type CapacityVerdict =
  | { decision: 'pass-through' }
  | { decision: 'scaled-out'; scaledCount: number; isServerless: boolean }
  | { decision: 'saturated' };

/**
 * The exact capacity/auto-scaling decision `adapters/computeCapacity.ts` implements: only
 * decides anything under spike-level traffic; auto-scaling is detected via serverless-by-nature,
 * multiple replicas, `multiAz`, or a healthy `ec2_auto_scaling` sibling node on the canvas.
 */
export function evaluateCapacity(
  node: ServiceNodeSnapshot,
  siblingNodes: ServiceNodeSnapshot[],
  trafficLevel: string | undefined,
  isServerless: boolean
): CapacityVerdict {
  const isSpikeLoad = !!trafficLevel && SPIKE_LOAD_LEVELS.includes(trafficLevel);
  if (!isSpikeLoad) return { decision: 'pass-through' };

  const hasAutoScaling =
    isServerless ||
    (node.replicas !== undefined && node.replicas > 1) ||
    !!node.multiAz ||
    siblingNodes.some(n => n.serviceId === 'ec2_auto_scaling' && n.health !== 'failed');

  if (hasAutoScaling) {
    const currentCount = node.replicas || 1;
    const multiplier = trafficLevel === '100x' ? 4 : trafficLevel === '10x' ? 3 : 2;
    const scaledCount = Math.min(12, currentCount * multiplier);
    return { decision: 'scaled-out', scaledCount, isServerless };
  }

  if (EXTREME_LOAD_LEVELS.includes(trafficLevel!)) {
    return { decision: 'saturated' };
  }

  return { decision: 'pass-through' };
}

function computeProcessRequest(isServerless: boolean) {
  return (input: ServiceRequestInput): ServiceRequestOutcome => {
    if (input.target.health === 'failed') {
      return { status: 'failure', statusCode: 503, reason: `${input.target.label} is marked FAILED.` };
    }

    const verdict = evaluateCapacity(input.target, input.siblingNodes || [], input.trafficLevel, isServerless);
    if (verdict.decision === 'saturated') {
      return {
        status: 'failure',
        statusCode: 504,
        reason: `${input.target.label} capacity saturated under ${input.trafficLevel} load - single instance, no Auto Scaling Group configured.`
      };
    }
    if (verdict.decision === 'scaled-out') {
      return {
        status: 'success',
        detail: `${input.target.label} accepted the request${isServerless ? ' via elastic concurrency scaling' : ` after scaling out to ${verdict.scaledCount} targets`}.`,
        recoveryApplied: isServerless
          ? 'Serverless control plane scaled concurrency automatically.'
          : `Auto Scaling Group expanded capacity to ${verdict.scaledCount} targets.`
      };
    }
    return { status: 'success', detail: `${input.target.label} accepted the request.` };
  };
}

function buildComputeModel(id: string, description: string, isServerless: boolean, dependencies: string[], failureModes: FailureModeDescriptor[]): ServiceModel {
  return {
    id,
    tier: 1,
    description,
    validateConfiguration(node: ServiceNodeSnapshot): ConfigIssue[] {
      const issues: ConfigIssue[] = [];
      if (!isServerless && node.subnet === 'unassigned') {
        issues.push({ field: 'subnet', message: `${id} must be placed inside a VPC subnet.` });
      }
      return issues;
    },
    resolveEndpoints(): EndpointCapabilities {
      return { requiresEni: !isServerless, isIngressProxy: false, isManagedEventTarget: id === 'lambda', isVpcEndpoint: null };
    },
    canReceive: () => ({ ok: true }),
    canSend: () => ({ ok: true }),
    processRequest: computeProcessRequest(isServerless),
    getDependencies: () => dependencies,
    getFailureModes: () => failureModes
  };
}

export const ec2Model = buildComputeModel('ec2', 'General purpose virtual machine compute.', false, ['rds', 's3'], [
  { id: 'ec2-asg-health-check', description: 'Instance fails ASG health check, is terminated and replaced.', detectionSystem: 'asg_health_check' },
  { id: 'ec2-hardware-retirement', description: 'Underlying hardware scheduled for retirement.', detectionSystem: 'manual' }
]);

export { ecsModel } from './ecs.ts';

export const fargateModel = buildComputeModel('fargate', 'Serverless compute engine for containers.', true, ['rds', 's3'], [
  { id: 'fargate-scheduler-task-failure', description: 'Task fails the ECS/EKS scheduler\'s health check, is stopped and replaced.', detectionSystem: 'ecs_scheduler' }
]);

export const eksModel = buildComputeModel('eks', 'Managed Kubernetes control plane and worker node orchestration.', false, ['rds', 's3'], [
  { id: 'eks-node-health-check', description: 'A worker node fails its kubelet health check; Kubernetes reschedules its pods onto healthy nodes.', detectionSystem: 'asg_health_check' }
]);

export const lambdaModel = buildComputeModel('lambda', 'Serverless event-driven compute functions.', true, ['dynamodb', 'rds', 'step_functions'], [
  { id: 'lambda-timeout', description: 'Function execution exceeds its configured timeout.', detectionSystem: 'manual' },
  { id: 'lambda-cold-start', description: 'Cold start latency on a new execution environment.', detectionSystem: 'manual' },
  { id: 'lambda-concurrency-exhaustion', description: 'Reserved/account concurrency limit exceeded.', detectionSystem: 'manual' }
]);
