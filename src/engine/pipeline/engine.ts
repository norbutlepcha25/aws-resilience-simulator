// The 13-step unified pipeline. Every per-hop decision that used to be a hardcoded serviceId
// array in adapters/networkPath.ts (VPC_HOSTED_INGRESS_SERVICE_IDS, INGRESS_PROXY_SERVICE_IDS,
// MANAGED_EVENT_TARGET_SERVICE_IDS, ENDPOINT_SERVICE_IDS) is instead resolved through
// `resolveServiceModel(id).resolveEndpoints(node)` (Phase 7); everything about how a specific
// service actually behaves (ALB target-health, RDS Multi-AZ failover, NAT SNAT, WAF inspection,
// CloudFront caching, compute auto-scaling...) is delegated entirely to that service's own
// `processRequest()` (step 10) - this module has no branch that names a specific service by id
// for a BEHAVIORAL decision. The handful of places a literal serviceId string still appears
// (`'internet_gateway'`, `'nat_gateway'`) are singleton-resource lookups ("find THE Internet
// Gateway on this canvas"), not service-classification shortcuts - see
// docs/aws-behavior/UNIFIED_PIPELINE_DEVIATIONS.md §1 for the full accounting.
import type { Node, Edge } from '@xyflow/react';
import type { ConnectionData, ServiceNodeData } from '../../types/index.ts';
import { checkNetworkFirewalls, checkCustomNaclReturn } from '../simulation/networkFirewalls.ts';
import { evaluateAuthorization } from '../iam/evaluate.ts';
import type { ResourceRef } from '../iam/types.ts';
import { resolveServiceModel } from '../service/registry.ts';
import type { ServiceNodeSnapshot } from '../service/types.ts';
import type { HopCheck, HopTrace, PipelineResult, PipelineResultStatus, UnifiedRequest } from './types.ts';

const MAX_HOPS = 40;

function toSnapshot(node: Node<ServiceNodeData>): ServiceNodeSnapshot {
  return node.data;
}

function legacyStatusCodeFor(status: PipelineResultStatus): number {
  switch (status) {
    case 'SUCCESS': return 200;
    case 'DENIED': return 403;
    case 'BLOCKED': return 403;
    case 'MISCONFIGURED': return 400;
    case 'UNAVAILABLE': return 503;
    case 'TIMEOUT': return 504;
    case 'UNSUPPORTED': return 502;
  }
}

class HopBuilder {
  nodeId: string;
  label: string;
  serviceId: string;
  checks: HopCheck[] = [];
  constructor(nodeId: string, label: string, serviceId: string) {
    this.nodeId = nodeId;
    this.label = label;
    this.serviceId = serviceId;
  }
  add(check: HopCheck) { this.checks.push(check); return check; }
  build(outcome: HopTrace['outcome']): HopTrace {
    return { nodeId: this.nodeId, label: this.label, serviceId: this.serviceId, checks: this.checks, outcome };
  }
}

export function runUnifiedPipeline(
  nodes: Node<ServiceNodeData>[],
  edges: Edge<ConnectionData>[],
  request: UnifiedRequest
): PipelineResult {
  const hops: HopTrace[] = [];
  const boundaryNodes = nodes.filter(n => n.type === 'boundaryNode');
  const serviceNodes = nodes.filter(n => n.type === 'serviceNode' || (!n.type && (n.data as any)?.serviceId));

  const fail = (status: PipelineResultStatus, reason: string): PipelineResult =>
    ({ status, reason, hops, legacyStatusCode: legacyStatusCodeFor(status) });

  // ---- Step 1: Resolve source ----
  let currentNode = serviceNodes.find(n => n.id === request.source);
  if (!currentNode) {
    // Fallback heuristic for an invalid/omitted source id - a UX bootstrap concern (which node to
    // start FROM), not a per-service behavioral shortcut. Prefers a node with no incoming edges
    // and a global (non-VPC) subnet - "an unprompted actor", the structural definition of an
    // ingress origin, rather than naming specific serviceIds.
    currentNode = serviceNodes.find(n => n.data.subnet === 'global' && !edges.some(e => e.target === n.id)) || serviceNodes[0];
  }
  if (!currentNode) {
    return fail('UNSUPPORTED', 'Canvas has no service nodes to simulate a request against.');
  }

  const sourceHop = new HopBuilder(currentNode.id, currentNode.data.label, currentNode.data.serviceId);
  sourceHop.add({ step: 'resolve-source', label: 'Resolve source', passed: true, detail: `${currentNode.data.label} resolved as the request's entry point.` });
  hops.push(sourceHop.build('passed'));

  const visited = new Set<string>();
  const traversedPath: Node<ServiceNodeData>[] = [currentNode];
  let hopCount = 0;

  while (currentNode) {
    if (++hopCount > MAX_HOPS) {
      return fail('UNSUPPORTED', `Routing loop detected: traversed more than ${MAX_HOPS} hops without reaching a terminal service.`);
    }
    visited.add(currentNode.id);

    const outgoingEdges = edges.filter(e => e.source === currentNode!.id && (e.data as any)?.signalType !== 'outbound_response');
    const downstreamNodes = nodes.filter(
      n => outgoingEdges.some(e => e.target === n.id) && n.type !== 'boundaryNode' && (n.data as any)?.serviceId
    ) as Node<ServiceNodeData>[];
    // A routing service (ALB/NLB/API Gateway) as the CURRENT node must advance to whichever
    // target its own health-based selection would actually pick (first healthy, matching
    // `evaluateLoadBalancing` in models/edge.ts) - not just the first unvisited downstream node,
    // which could be a failed sibling of the one this hop's own service-behavior check already
    // evaluated as healthy.
    const currentPerformsRouting: boolean = resolveServiceModel(currentNode!.data.serviceId)?.resolveEndpoints(currentNode!.data).performsTargetRouting ?? false;
    const nextNode: Node<ServiceNodeData> | undefined = currentPerformsRouting
      ? downstreamNodes.find(n => n.data.health === 'healthy' && !visited.has(n.id)) || downstreamNodes.find(n => !visited.has(n.id)) || downstreamNodes[0]
      : downstreamNodes.find(n => !visited.has(n.id)) || downstreamNodes[0];

    if (!nextNode) {
      // End of the chain - structural, not a failure. Real AWS traffic terminates at a data
      // store or a fire-and-forget target with no "next hop" of its own.
      return evaluateReturnPath(boundaryNodes, traversedPath, {
        status: 'SUCCESS',
        reason: `${currentNode.data.label} completed processing - end of the request chain.`,
        hops,
        legacyStatusCode: 200
      });
    }

    const edge = outgoingEdges.find(e => e.target === nextNode.id);
    const protocol = request.protocol || (edge?.data as any)?.protocol || 'HTTP';
    const hop = new HopBuilder(nextNode.id, nextNode.data.label, nextNode.data.serviceId);

    // ---- Step 2: Resolve destination (via the Phase 7 Service Model registry) ----
    const destModel = resolveServiceModel(nextNode.data.serviceId);
    if (!destModel) {
      hop.add({ step: 'resolve-destination', label: 'Resolve destination', passed: false, detail: `No service model resolves for serviceId "${nextNode.data.serviceId}".` });
      hops.push(hop.build('failed'));
      return fail('UNSUPPORTED', `Unknown service "${nextNode.data.serviceId}" on node ${nextNode.data.label} - the request cannot be resolved further.`);
    }
    hop.add({ step: 'resolve-destination', label: 'Resolve destination', passed: true, detail: `${nextNode.data.label} resolved to service model "${destModel.id}" (Tier ${destModel.tier}).` });

    // ---- Step 3: Resolve identity/principal ----
    hop.add(request.principal
      ? { step: 'resolve-identity', label: 'Resolve identity', passed: true, detail: `Principal ${request.principal.id} carried on the request.` }
      : { step: 'resolve-identity', label: 'Resolve identity', passed: true, detail: 'No principal supplied - IAM evaluation is skipped for this request (see UNIFIED_PIPELINE_DEVIATIONS.md).' }
    );

    // ---- Step 4 + 5: Resolve network path / routes (capability-flag-driven, not serviceId lists) ----
    const destCaps = destModel.resolveEndpoints(nextNode.data);
    const sourceModelForHop = resolveServiceModel(currentNode.data.serviceId);
    const sourceCaps = sourceModelForHop?.resolveEndpoints(currentNode.data);
    // A node that itself performs target-group health-based routing (ALB/NLB/API Gateway) is
    // never "raw public origin" traffic when it's the one forwarding onward - it IS the approved
    // ingress mediator. A true unmediated client, or an edge service that does NOT select among
    // targets (CloudFront), still counts as public origin.
    const isPublicOrigin = currentNode.data.subnet === 'global' && !sourceCaps?.performsTargetRouting;
    const isVpcHostedPublicTarget = nextNode.data.subnet === 'public' && destCaps.requiresEni;
    const isPrivateTarget = nextNode.data.subnet === 'private' || nextNode.data.subnet === 'isolated';
    const isPrivateSource = currentNode.data.subnet === 'private' || currentNode.data.subnet === 'isolated';
    const isEventTrigger = protocol === 'Event' && destCaps.isManagedEventTarget;

    if (isPublicOrigin && isVpcHostedPublicTarget) {
      const igw = serviceNodes.find(n => n.data.serviceId === 'internet_gateway');
      if (!igw) {
        hop.add({ step: 'resolve-network-path', label: 'Internet Gateway attachment', passed: false, detail: `The VPC has no Internet Gateway attached - ${nextNode.data.label} sits in a public subnet but has no route in from the internet.` });
        hops.push(hop.build('failed'));
        return fail('MISCONFIGURED', `VPC has no Internet Gateway attached; ${nextNode.data.label} cannot be reached from outside the VPC.`);
      }
      if (igw.data.health === 'failed') {
        hop.add({ step: 'resolve-network-path', label: 'Internet Gateway attachment', passed: false, detail: `Internet Gateway [${igw.data.label}] is unhealthy - the VPC has lost its only path to and from the internet.` });
        hops.push(hop.build('failed'));
        return fail('UNAVAILABLE', `Internet Gateway ${igw.data.label} is offline.`);
      }
      hop.add({ step: 'resolve-network-path', label: 'Internet Gateway attachment', passed: true, detail: `Internet Gateway [${igw.data.label}] is attached and healthy.` });
    } else if (isEventTrigger) {
      hop.add({ step: 'resolve-network-path', label: 'Managed event delivery', passed: true, detail: `${currentNode.data.label} delivers over the AWS managed event control plane - no customer-owned network path applies.` });
    } else if (isPublicOrigin && isPrivateTarget && !destCaps.isIngressProxy) {
      hop.add({ step: 'resolve-network-path', label: 'Direct public ingress to private subnet', passed: false, detail: `Unsolicited public traffic cannot reach ${nextNode.data.label} in a private subnet - private route tables have no default route to an Internet Gateway.` });
      hops.push(hop.build('failed'));
      return fail('BLOCKED', `Direct public ingress into private subnet [${nextNode.data.label}] has no route - it must be mediated by an ingress proxy (e.g. a load balancer or API Gateway) in a public subnet.`);
    } else if (isPrivateSource && (nextNode.data.subnet === 'global') && destCaps.isVpcEndpoint === null && !['rds', 'dynamodb'].includes(nextNode.data.serviceId)) {
      // Private-subnet egress toward a fully-managed/global service with no VPC Endpoint modeled
      // for it - needs a NAT Gateway. (`isVpcEndpoint === null` means "not a VPC endpoint node
      // itself", so this branch does not fire when the next hop already IS the endpoint.)
      const vpcEndpoint = serviceNodes.find(n => (resolveServiceModel(n.data.serviceId)?.resolveEndpoints(n.data).isVpcEndpoint) && n.data.health !== 'failed');
      const natGateway = serviceNodes.find(n => n.data.serviceId === 'nat_gateway');

      if (vpcEndpoint) {
        hop.add({ step: 'resolve-routes', label: 'VPC Endpoint route', passed: true, detail: `Routed via ${vpcEndpoint.data.label} over the AWS private backbone - no NAT Gateway needed.` });
      } else if (!natGateway) {
        hop.add({ step: 'resolve-routes', label: 'NAT Gateway route', passed: false, detail: `No NAT Gateway (or VPC Endpoint) exists for private-subnet egress from ${currentNode.data.label}.` });
        hops.push(hop.build('failed'));
        return fail('MISCONFIGURED', `Private subnet instance ${currentNode.data.label} has no NAT Gateway or VPC Endpoint for internet egress.`);
      } else if (natGateway.data.health === 'failed') {
        hop.add({ step: 'resolve-routes', label: 'NAT Gateway route', passed: false, detail: `NAT Gateway [${natGateway.data.label}] is unhealthy.` });
        hops.push(hop.build('failed'));
        return fail('UNAVAILABLE', `NAT Gateway ${natGateway.data.label} is offline - private subnet egress dropped.`);
      } else {
        hop.add({ step: 'resolve-routes', label: 'NAT Gateway route', passed: true, detail: `Routed via NAT Gateway [${natGateway.data.label}] (SNAT).` });
      }
    } else {
      hop.add({ step: 'resolve-network-path', label: 'Direct path', passed: true, detail: `${currentNode.data.label} forwards directly to ${nextNode.data.label}.` });
      hop.add({ step: 'resolve-routes', label: 'Route resolution', passed: true, detail: 'Resolved via subnet-derived reachability (no explicit Route Table entity modeled yet - see NETWORK_ENGINE_DEVIATIONS.md §2).' });
    }

    // ---- Step 6 + 7: Evaluate NACL, then Security Group ----
    const firewall = checkNetworkFirewalls(protocol, nextNode, boundaryNodes, currentNode);
    if (firewall.nacl.evaluated) {
      hop.add({ step: 'evaluate-nacl', label: 'Network ACL', passed: !firewall.nacl.blocked, detail: firewall.nacl.note || '' });
      if (firewall.nacl.blocked) {
        hops.push(hop.build('failed'));
        return fail('BLOCKED', firewall.nacl.note || `Network ACL blocked ${protocol} traffic to ${nextNode.data.label}.`);
      }
    }
    if (firewall.securityGroup.evaluated) {
      hop.add({ step: 'evaluate-security-group', label: 'Security Group', passed: !firewall.securityGroup.blocked, detail: firewall.securityGroup.note || '' });
      if (firewall.securityGroup.blocked) {
        hops.push(hop.build('failed'));
        return fail('BLOCKED', firewall.securityGroup.note || `Security Group blocked ${protocol} traffic to ${nextNode.data.label}.`);
      }
    }

    // ---- Step 8: Evaluate service endpoint (configuration/placement validity) ----
    if (nextNode.data.subnet === 'unassigned') {
      hop.add({ step: 'evaluate-service-endpoint', label: 'Endpoint configuration', passed: false, detail: `${nextNode.data.label} is not placed inside any VPC subnet - every ENI-backed resource must sit in exactly one.` });
      hops.push(hop.build('failed'));
      return fail('MISCONFIGURED', `${nextNode.data.label} is not placed inside any VPC subnet.`);
    }
    const configIssues = destModel.validateConfiguration(nextNode.data);
    if (configIssues.length > 0) {
      hop.add({ step: 'evaluate-service-endpoint', label: 'Endpoint configuration', passed: false, detail: configIssues.map(i => i.message).join('; ') });
      hops.push(hop.build('failed'));
      return fail('MISCONFIGURED', configIssues.map(i => i.message).join('; '));
    }
    hop.add({ step: 'evaluate-service-endpoint', label: 'Endpoint configuration', passed: true, detail: `${nextNode.data.label}'s configuration is valid.` });

    // ---- Step 9: Evaluate IAM authorization (only when the request actually carries one) ----
    // "Terminal" here means "the hop this request's action/resource actually pertains to" -
    // either the explicit `request.destination`, or (when none is given) the last node in the
    // chain, matching the worked example's Lambda -> S3 shape where the IAM check is meaningful
    // only at the resource actually being accessed, not every intermediate hop.
    const isTerminalHop = request.destination
      ? nextNode.id === request.destination
      : edges.filter(e => e.source === nextNode.id && (e.data as any)?.signalType !== 'outbound_response').length === 0;
    if (request.principal && request.action && isTerminalHop) {
      const resource: ResourceRef = request.resource
        ? { arn: request.resource, accountId: request.principal.accountId }
        : { arn: `arn:aws:${nextNode.data.serviceId}:::${nextNode.id}`, accountId: request.principal.accountId };
      const decision = evaluateAuthorization({ principal: request.principal, action: request.action, resource, context: request.context });
      hop.add({ step: 'evaluate-iam', label: 'IAM authorization', passed: decision.effect === 'Allow', detail: decision.finalReason });
      if (decision.effect === 'Deny') {
        hops.push(hop.build('failed'));
        return fail('DENIED', decision.finalReason);
      }
    } else {
      hop.add({ step: 'evaluate-iam', label: 'IAM authorization', passed: true, detail: 'Not evaluated (no principal/action supplied for this hop).' });
    }

    // ---- Step 10: Execute service behavior (the destination's own ServiceModel decides) ----
    const isRoutingHop = destCaps.performsTargetRouting ?? false;
    // A routing service's OWN downstream targets (edges FROM nextNode) - NOT `downstreamNodes`
    // above, which is downstream of `currentNode` (this hop's source) and would wrongly include
    // nextNode itself as its only "sibling".
    const destOutgoingEdges = edges.filter(e => e.source === nextNode.id && (e.data as any)?.signalType !== 'outbound_response');
    const destDownstreamNodes = nodes.filter(
      n => destOutgoingEdges.some(e => e.target === n.id) && n.type !== 'boundaryNode' && (n.data as any)?.serviceId
    ) as Node<ServiceNodeData>[];
    const siblingNodes: ServiceNodeSnapshot[] = isRoutingHop
      ? destDownstreamNodes.map(toSnapshot)
      : serviceNodes.map(toSnapshot);

    const outcome = destModel.processRequest({
      target: toSnapshot(nextNode),
      caller: toSnapshot(currentNode),
      siblingNodes,
      action: request.action || protocol,
      trafficLevel: request.trafficLevel,
      path: request.path
    });

    if (outcome.status === 'failure') {
      hop.add({ step: 'execute-service-behavior', label: 'Service behavior', passed: false, detail: outcome.reason });
      hops.push(hop.build('failed'));
      const status: PipelineResultStatus = outcome.statusCode === 504 ? 'TIMEOUT' : 'UNAVAILABLE';
      return fail(status, outcome.reason);
    }
    hop.add({ step: 'execute-service-behavior', label: 'Service behavior', passed: true, detail: outcome.detail });
    hop.add({ step: 'generate-response', label: 'Response generated', passed: true, detail: `${nextNode.data.label} produced a response.` });

    hops.push(hop.build('passed'));

    if (request.destination && nextNode.id === request.destination) {
      return evaluateReturnPath(boundaryNodes, [...traversedPath, nextNode], {
        status: 'SUCCESS',
        reason: outcome.detail,
        hops,
        legacyStatusCode: 200
      });
    }

    currentNode = nextNode;
    traversedPath.push(currentNode);
  }

  return evaluateReturnPath(boundaryNodes, traversedPath, { status: 'SUCCESS', reason: 'Request completed.', hops, legacyStatusCode: 200 });
}

/** Step 12: Evaluate the return path (stateless NACL return leg) - reuses the exact same
 *  Phase-5-fixed `checkCustomNaclReturn` the pre-Phase-8 engine already uses, scoped to the
 *  compute<->database pair actually traversed by this request. Step 13 (produce final result) is
 *  simply returning the resulting `PipelineResult` unchanged when this check passes. */
function evaluateReturnPath(boundaryNodes: Node<any>[], traversedPath: Node<ServiceNodeData>[], provisional: PipelineResult): PipelineResult {
  if (provisional.status !== 'SUCCESS') return provisional;

  const webComputeNode = traversedPath.find(n => resolveServiceModel(n.data.serviceId) && !resolveServiceModel(n.data.serviceId)!.resolveEndpoints(n.data).isVpcEndpoint && ['ec2', 'ecs', 'lambda', 'fargate'].includes(n.data.serviceId));
  const dbNode = traversedPath.find(n => ['rds', 'aurora', 'dynamodb'].includes(n.data.serviceId));

  if (!webComputeNode || !dbNode) return provisional;

  const returnCheck = checkCustomNaclReturn(webComputeNode, dbNode, boundaryNodes);
  if (!returnCheck.evaluated) return provisional;

  if (returnCheck.blocked) {
    provisional.hops.push({
      nodeId: dbNode.id,
      label: dbNode.data.label,
      serviceId: dbNode.data.serviceId,
      checks: [{ step: 'evaluate-return-path', label: 'Stateless return path', passed: false, detail: returnCheck.note || '' }],
      outcome: 'failed'
    });
    return { status: 'TIMEOUT', reason: returnCheck.note || 'Stateless NACL return path blocked.', hops: provisional.hops, legacyStatusCode: legacyStatusCodeFor('TIMEOUT') };
  }

  provisional.hops.push({
    nodeId: dbNode.id,
    label: dbNode.data.label,
    serviceId: dbNode.data.serviceId,
    checks: [{ step: 'evaluate-return-path', label: 'Stateless return path', passed: true, detail: returnCheck.note || '' }],
    outcome: 'passed'
  });
  return provisional;
}
