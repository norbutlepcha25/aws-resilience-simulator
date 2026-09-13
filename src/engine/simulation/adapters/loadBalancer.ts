import { ecsHasAvailableTasks } from '../../service/models/ecs.ts';
import type { AdapterContext, AdapterSignal } from './types.ts';
import { CONTINUE, TERMINATE, advanceTo } from './types.ts';

const LOAD_BALANCER_SERVICE_IDS = ['alb', 'nlb', 'api_gateway'];
const COMPUTE_TARGET_SERVICE_IDS = ['ecs', 'ec2', 'lambda', 'fargate'];

/**
 * ALB / NLB / API Gateway target-group health evaluation. NLB performs its own target health
 * checks at the connection/TCP level, conceptually parallel to ALB's HTTP-level checks - it must
 * not be silently skipped here.
 */
export const loadBalancerAdapter = (ctx: AdapterContext): AdapterSignal => {
  const { trace, node, nodes, downstreamNodes, pushFirewallBlockIfAny } = ctx;

  if (!LOAD_BALANCER_SERVICE_IDS.includes(node.data.serviceId)) {
    return CONTINUE;
  }

  const computeTargets = downstreamNodes.filter(n => COMPUTE_TARGET_SERVICE_IDS.includes(n.data.serviceId));
  const targetList = computeTargets.length > 0 ? computeTargets : downstreamNodes;

  const targetsEvaluation = targetList.map(t => ({
    id: t.id,
    name: t.data.label,
    health: t.data.health,
    selected: false
  }));

  const healthyTargets = targetList.filter(t => t.data.health === 'healthy' && (t.data.serviceId !== 'ecs' || ecsHasAvailableTasks(t.data)));

  if (healthyTargets.length === 0) {
    trace.pushStep({
      sourceNodeId: node.id,
      targetNodeId: node.id,
      sourceNodeName: node.data.label,
      targetNodeName: node.data.label,
      protocol: 'HTTP',
      action: 'Target Health Check: ALL TARGETS FAILED',
      status: 'failed',
      // Real AWS ELB uses 503 Service Unavailable for "no healthy targets in the target group";
      // 502 Bad Gateway is reserved for a malformed response FROM a target, a different
      // condition entirely.
      explanation: `HTTP 503 Service Unavailable: ${node.data.label} evaluated registered targets in target group. All ${targetList.length} targets failed health checks! No healthy endpoints available to route traffic.`,
      targetHealth: 'failed',
      latencyMs: 250,
      details: {
        targetsEvaluated: targetsEvaluation,
        statusCode: 503,
        failureReason: 'All registered compute targets are unhealthy or unresponsive.'
      }
    });
    trace.fail(503, `${node.data.label} returned 503 Service Unavailable: No healthy compute targets available.`);
    return TERMINATE;
  }

  const selectedTarget = healthyTargets[0];

  if (pushFirewallBlockIfAny(node, selectedTarget, 'HTTP')) {
    return TERMINATE;
  }

  const failedTargets = targetList.filter(t => t.data.health === 'failed');

  const evaluatedDetails = targetsEvaluation.map(t => ({
    ...t,
    selected: t.id === selectedTarget.id
  }));

  let albExplanation = `${node.data.label} evaluated ${targetList.length} registered target(s). Selected healthy target [${selectedTarget.data.label}].`;
  if (failedTargets.length > 0) {
    albExplanation += ` Health check detected ${failedTargets.length} FAILED target(s) (${failedTargets.map(f => f.data.label).join(', ')}) and removed them from active rotation. Resilience maintained!`;

    // ELB target-health rerouting is immediate and is its own, separate mechanism from whatever
    // actually REPLACES the failed target - and that replacement mechanism differs by compute
    // type. EC2 recovery is an Auto Scaling Group's concern (and only applies if one is actually
    // present on the canvas); ECS/Fargate task recovery is the ECS service scheduler's concern,
    // inherent to running an ECS service, not an optional add-on the way an ASG is for EC2;
    // Lambda has no persistent instance to replace at all.
    const failedComputeType = failedTargets[0].data.serviceId;
    const hasAutoScalingGroup = nodes.some(n => n.data.serviceId === 'ec2_auto_scaling' && n.data.health !== 'failed');
    if (failedComputeType === 'ec2' && hasAutoScalingGroup) {
      albExplanation += ` The Auto Scaling Group's own health check will independently mark ${failedTargets.map(f => f.data.label).join(', ')} unhealthy, terminate it, and launch a replacement instance to restore full capacity - all without any user-visible impact.`;
    } else if (failedComputeType === 'ecs' || failedComputeType === 'fargate') {
      albExplanation += ` The ECS service scheduler will independently detect ${failedTargets.map(f => f.data.label).join(', ')} as unhealthy, stop it, and start a replacement task to restore the service's desired count - a separate system from the ALB's own health check.`;
    }
  }

  trace.pushStep({
    sourceNodeId: node.id,
    targetNodeId: selectedTarget.id,
    sourceNodeName: node.data.label,
    targetNodeName: selectedTarget.data.label,
    protocol: 'HTTP',
    action: `Route to ${selectedTarget.data.label}`,
    status: 'success',
    explanation: albExplanation,
    targetHealth: selectedTarget.data.health,
    latencyMs: 12,
    details: {
      targetsEvaluated: evaluatedDetails,
      recoveryApplied: failedTargets.length > 0 ? `Traffic safely steered away from failed ${failedTargets[0].data.label}` : undefined
    }
  });

  trace.advanceTime(12);
  return advanceTo(selectedTarget);
};
