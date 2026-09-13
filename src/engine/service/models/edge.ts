// Edge / load-balancing models: ALB, NLB, API Gateway (target-health routing), CloudFront (edge
// caching), Route 53 (DNS resolution pass-through). Target-health selection mirrors
// `adapters/loadBalancer.ts` exactly; cache-hit heuristic mirrors `adapters/cloudFront.ts` exactly.
import type { ConfigIssue, EndpointCapabilities, ServiceModel, ServiceNodeSnapshot, ServiceRequestInput, ServiceRequestOutcome } from '../types.ts';

export interface LoadBalancingVerdict {
  selectedTarget: ServiceNodeSnapshot | null;
  healthyCount: number;
  failedCount: number;
  totalCount: number;
}

/** The exact ALB/NLB/API Gateway target-selection rule: first healthy target wins, or no
 *  selection at all ("no healthy targets" -> 503) if none are healthy. */
export function evaluateLoadBalancing(targets: ServiceNodeSnapshot[]): LoadBalancingVerdict {
  const healthyTargets = targets.filter(t => t.health === 'healthy');
  const failedTargets = targets.filter(t => t.health === 'failed');
  return {
    selectedTarget: healthyTargets[0] || null,
    healthyCount: healthyTargets.length,
    failedCount: failedTargets.length,
    totalCount: targets.length
  };
}

function loadBalancerProcessRequest(input: ServiceRequestInput): ServiceRequestOutcome {
  const targets = input.siblingNodes || [];
  if (targets.length === 0) {
    // No target list supplied - this model is being evaluated for its OWN health/config, not a
    // routing decision (interaction.ts is what supplies a real target list via siblingNodes).
    return input.target.health === 'failed'
      ? { status: 'failure', statusCode: 503, reason: `${input.target.label} is marked FAILED.` }
      : { status: 'success', detail: `${input.target.label} accepted the request.` };
  }

  const verdict = evaluateLoadBalancing(targets);
  if (!verdict.selectedTarget) {
    return { status: 'failure', statusCode: 503, reason: `${input.target.label}: no healthy targets available (${verdict.totalCount} evaluated, all unhealthy).` };
  }
  return {
    status: 'success',
    detail: `${input.target.label} routed to healthy target [${verdict.selectedTarget.label}]${verdict.failedCount > 0 ? ` after removing ${verdict.failedCount} failed target(s) from rotation` : ''}.`
  };
}

function buildEdgeModel(id: string, description: string, isIngressProxy: boolean, requiresEni: boolean, processRequest: (input: ServiceRequestInput) => ServiceRequestOutcome): ServiceModel {
  return {
    id,
    tier: 1,
    description,
    validateConfiguration(node: ServiceNodeSnapshot): ConfigIssue[] {
      if (requiresEni && node.subnet === 'unassigned') {
        return [{ field: 'subnet', message: `${id} must be placed inside a VPC subnet.` }];
      }
      return [];
    },
    resolveEndpoints(): EndpointCapabilities {
      // buildEdgeModel is only ever used for ALB/NLB/API Gateway - all three select among
      // multiple registered targets by health, unlike CloudFront/Route 53 below.
      return { requiresEni, isIngressProxy, isManagedEventTarget: false, isVpcEndpoint: null, performsTargetRouting: true };
    },
    canReceive: () => ({ ok: true }),
    canSend: () => ({ ok: true }),
    processRequest,
    getDependencies: () => [],
    getFailureModes: () => [
      { id: `${id}-no-healthy-targets`, description: 'All registered targets fail health checks.', detectionSystem: 'elb_health_check' }
    ]
  };
}

export const albModel = buildEdgeModel('alb', 'Layer 7 HTTP(S) load balancer with target-group health checks.', true, true, loadBalancerProcessRequest);
export const nlbModel = buildEdgeModel('nlb', 'Layer 4 TCP/UDP load balancer with connection-level health checks.', true, true, loadBalancerProcessRequest);
export const apiGatewayModel = buildEdgeModel('api_gateway', 'Fully managed API front door (REST/HTTP/WebSocket APIs).', true, false, (input: ServiceRequestInput): ServiceRequestOutcome =>
  input.target.health === 'failed'
    ? { status: 'failure', statusCode: 503, reason: `${input.target.label} is marked FAILED.` }
    : { status: 'success', detail: `${input.target.label} routed the request to its configured integration.` }
);

export const cloudFrontModel: ServiceModel = {
  id: 'cloudfront',
  tier: 1,
  description: 'Global content delivery network (CDN) with edge caching.',
  validateConfiguration: () => [],
  resolveEndpoints: () => ({ requiresEni: false, isIngressProxy: true, isManagedEventTarget: false, isVpcEndpoint: null }),
  canReceive: () => ({ ok: true }),
  canSend: () => ({ ok: true }),
  processRequest(input: ServiceRequestInput): ServiceRequestOutcome {
    const path = input.path || '';
    const isStaticPath = path.includes('/static') || path.endsWith('.png') || path.endsWith('.js') || path.endsWith('.css');
    if (isStaticPath) {
      return { status: 'success', detail: `${input.target.label} served from edge cache (HIT) - origin never contacted.` };
    }
    if (input.target.health === 'failed') {
      return { status: 'failure', statusCode: 503, reason: `${input.target.label} is marked FAILED.` };
    }
    return { status: 'success', detail: `${input.target.label} cache MISS for '${path}' - forwarding to origin.` };
  },
  getDependencies: () => [],
  getFailureModes: () => [{ id: 'cloudfront-origin-unreachable', description: 'Origin unreachable on a cache miss.', detectionSystem: 'manual' }]
};

export const route53Model: ServiceModel = {
  id: 'route53',
  tier: 1,
  description: 'Managed authoritative DNS with health-check-based routing policies.',
  validateConfiguration: () => [],
  resolveEndpoints: () => ({ requiresEni: false, isIngressProxy: false, isManagedEventTarget: false, isVpcEndpoint: null }),
  canReceive: () => ({ ok: true }),
  canSend: () => ({ ok: true }),
  processRequest(input: ServiceRequestInput): ServiceRequestOutcome {
    if (input.target.health === 'failed') {
      return { status: 'failure', statusCode: 503, reason: `${input.target.label} is marked FAILED.` };
    }
    return { status: 'success', detail: `${input.target.label} resolved the query.` };
  },
  getDependencies: () => [],
  getFailureModes: () => [{ id: 'route53-health-check-failure', description: 'A DNS health check target fails and is routed around.', detectionSystem: 'manual' }]
};
