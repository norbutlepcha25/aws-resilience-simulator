import { authorizeApplicationHop } from '../iam/applicationHop.ts';
import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData } from '../../types/index.ts';
import type { TraceEntry, TraceDecision } from './types.ts';
import { findContainingSubnetBoundary, findContainingVpc, getAttachedSecurityGroups } from '../layout/containment.ts';
import { evaluateNaclRules } from '../network/nacl.ts';
import { evaluateSecurityGroup, legacyAllowedProtocolsToRules, type SecurityGroupRules } from '../network/securityGroup.ts';
import { resolveServiceModel } from '../service/registry.ts';
import type { ServiceNodeSnapshot } from '../service/types.ts';
import { getDownstreamTargets, findNode } from '../failure/dependencyGraph.ts';

/** Load balancers don't fail because THEY are unhealthy - they fail when NONE of their registered
 *  targets are. Matches `simulation/adapters/loadBalancer.ts`'s own `LOAD_BALANCER_SERVICE_IDS`,
 *  so this trace's Service verdict never disagrees with what `runSimulation` actually decided. */
const LOAD_BALANCER_SERVICE_IDS = ['alb', 'nlb', 'api_gateway'];

function toSnapshot(node: Node<ServiceNodeData>): ServiceNodeSnapshot {
  return {
    serviceId: node.data.serviceId,
    label: node.data.label,
    health: node.data.health,
    subnet: node.data.subnet,
    az: node.data.az,
    replicas: node.data.replicas,
    multiAz: node.data.multiAz,
    securityGroupIds: node.data.securityGroupIds,
    customConfig: node.data.customConfig
  };
}

interface HopParams {
  order: number;
  component: TraceEntry['component'];
  resource: string;
  operation: string;
  input: Record<string, unknown>;
  decision: TraceDecision;
  reason: string;
  simpleExplanation: string;
  awsRule: string;
  metadata?: Record<string, unknown>;
}

function entry(p: HopParams): TraceEntry {
  return { ...p, metadata: p.metadata || {} };
}

/**
 * Produces the full explainable decision trace for exactly one hop (`source` -> `target` over
 * `protocol`[:`port`]) - Source, Destination, Route, NACL, Security Group, IAM, Service, in that
 * order, each backed by the real evaluator for that domain. This is the engine behind the spec's
 * own worked example (EC2-A -> RDS:5432): every one of those seven steps is a real decision made
 * by real AWS-accurate logic already tested elsewhere in this codebase, not narrated fiction.
 */
export function explainHop(
  nodes: Node<ServiceNodeData>[],
  edges: Edge<ConnectionData>[],
  source: Node<ServiceNodeData>,
  target: Node<ServiceNodeData>,
  protocol: string,
  opts?: { port?: number; action?: string }
): TraceEntry[] {
  const boundaryNodes = nodes.filter(n => n.type === 'boundaryNode');
  const entries: TraceEntry[] = [];
  let order = 0;

  // 1. Source
  entries.push(entry({
    order: order++,
    component: 'Source',
    resource: source.data.label,
    operation: 'resolve-source',
    input: { nodeId: source.id, serviceId: source.data.serviceId },
    decision: 'INFO',
    reason: `${source.data.label} (${source.data.serviceId}) initiates the connection to ${target.data.label}.`,
    simpleExplanation: `${source.data.label} is where this request starts.`,
    awsRule: 'A request originates from the network interface of the initiating resource.',
    metadata: { health: source.data.health }
  }));

  // 2. Destination
  entries.push(entry({
    order: order++,
    component: 'Destination',
    resource: target.data.label,
    operation: 'resolve-destination',
    input: { nodeId: target.id, serviceId: target.data.serviceId },
    decision: 'INFO',
    reason: `${target.data.label} (${target.data.serviceId}) resolved as the destination for ${protocol}${opts?.port ? `:${opts.port}` : ''}.`,
    simpleExplanation: `${target.data.label} is where this request is headed.`,
    awsRule: 'A connection must resolve to a specific, addressable destination resource.',
    metadata: {}
  }));

  // 3. Route - real VPC route-table semantics: an implicit "local" route covers all subnets of
  // the SAME VPC; anything else (a managed/edge service reached over the AWS backbone, or a
  // genuinely separate VPC with no peering modeled) is not a customer route-table decision at all.
  const sourceSubnet = findContainingSubnetBoundary(source, boundaryNodes);
  const targetSubnet = findContainingSubnetBoundary(target, boundaryNodes);
  const sourceVpc = sourceSubnet ? findContainingVpc(sourceSubnet, boundaryNodes) : null;
  const targetVpc = targetSubnet ? findContainingVpc(targetSubnet, boundaryNodes) : null;

  if (!sourceSubnet || !targetSubnet) {
    entries.push(entry({
      order: order++,
      component: 'Route',
      resource: 'N/A',
      operation: 'resolve-route',
      input: { sourceSubnet: sourceSubnet?.id, targetSubnet: targetSubnet?.id },
      decision: 'INFO',
      reason: `${!sourceSubnet ? source.data.label : target.data.label} is a fully-managed/edge service reached over the AWS backbone, not a customer VPC route table.`,
      simpleExplanation: 'This connection does not go through a VPC route table at all.',
      awsRule: 'Fully-managed and edge services (e.g. CloudFront, Route 53, DynamoDB, Lambda, S3) are reached over the AWS network, not a customer-owned route table.',
      metadata: {}
    }));
  } else {
    const sameVpc = Boolean(sourceVpc && targetVpc && sourceVpc.id === targetVpc.id);
    const sourceCidr = (sourceSubnet.data as any)?.cidr || (sourceVpc?.data as any)?.cidr || 'unknown';
    const targetCidr = (targetSubnet.data as any)?.cidr || (targetVpc?.data as any)?.cidr || 'unknown';
    entries.push(entry({
      order: order++,
      component: 'Route',
      resource: (targetVpc?.data as any)?.label || 'VPC route table',
      operation: 'resolve-route',
      input: { sourceCidr, targetCidr },
      decision: sameVpc ? 'ALLOW' : 'DENY',
      reason: sameVpc
        ? `${sourceCidr} -> local: both resources are in the same VPC, covered by its implicit local route.`
        : `${sourceCidr} -> ${targetCidr}: no route exists between separate VPCs without VPC Peering or a Transit Gateway attachment.`,
      simpleExplanation: sameVpc
        ? 'Both sides are in the same virtual network, so there is always a path between them.'
        : 'These two resources are in different virtual networks with no connection between them.',
      awsRule: 'Every VPC route table has an implicit, immutable "local" route for the VPC\'s own CIDR block; reaching a different VPC requires an explicit peering or Transit Gateway route.',
      metadata: { sourceVpcId: sourceVpc?.id, targetVpcId: targetVpc?.id }
    }));
  }

  // 4. NACL - stateless, subnet-wide, first-match-wins, evaluated on the DESTINATION's subnet.
  const customNacl = (targetSubnet?.data as any)?.customNacl;
  const legacyDenyInbound: string[] | undefined = (targetSubnet?.data as any)?.naclDenyInbound;

  if (customNacl?.inboundRules) {
    const evaluation = evaluateNaclRules(customNacl.inboundRules, protocol, { port: opts?.port });
    const isImplicitDeny = evaluation.decidingRule.ruleNumber === 32767;
    entries.push(entry({
      order: order++,
      component: 'NACL',
      resource: customNacl.naclName || 'Subnet NACL',
      operation: 'evaluate-nacl',
      input: { protocol, port: opts?.port, rule: `Rule ${evaluation.decidingRule.ruleNumber}` },
      decision: evaluation.blocked ? 'DENY' : 'ALLOW',
      reason: evaluation.reason,
      simpleExplanation: evaluation.blocked
        ? `The subnet's firewall (NACL) has no rule letting this traffic in, so it's blocked.`
        : `The subnet's firewall (NACL) has a rule that allows this traffic.`,
      awsRule: isImplicitDeny
        ? 'NACLs are stateless and deny by default: if no explicit rule matches, the implicit final rule (32767) denies all traffic.'
        : 'NACLs evaluate rules in ascending rule-number order and apply the first match; they are stateless, so return traffic needs its own explicit rule.',
      metadata: { decidingRule: evaluation.decidingRule, evaluatedRules: evaluation.evaluatedRules }
    }));
  } else if (legacyDenyInbound && legacyDenyInbound.length > 0) {
    const blocked = legacyDenyInbound.includes(protocol);
    entries.push(entry({
      order: order++,
      component: 'NACL',
      resource: (targetSubnet?.data as any)?.label || 'Subnet NACL',
      operation: 'evaluate-nacl',
      input: { protocol, denyList: legacyDenyInbound },
      decision: blocked ? 'DENY' : 'ALLOW',
      reason: blocked
        ? `This subnet's NACL has an explicit DENY rule for ${protocol} traffic.`
        : `This subnet's NACL has no DENY rule for ${protocol}; the traffic passes through.`,
      simpleExplanation: blocked ? 'The subnet firewall explicitly blocks this kind of traffic.' : 'The subnet firewall does not block this kind of traffic.',
      awsRule: 'NACLs are stateless and evaluate every packet against numbered rules regardless of connection state.',
      metadata: { denyList: legacyDenyInbound }
    }));
  } else {
    entries.push(entry({
      order: order++,
      component: 'NACL',
      resource: (targetSubnet?.data as any)?.label || 'Default NACL',
      operation: 'evaluate-nacl',
      input: { protocol, port: opts?.port },
      decision: 'ALLOW',
      reason: 'No custom NACL is configured on this subnet - the default NACL allows all inbound and outbound traffic.',
      simpleExplanation: 'No custom firewall rules are set up here, so traffic is allowed through by default.',
      awsRule: 'A VPC\'s default NACL allows all traffic in both directions until a rule is explicitly added to restrict it.',
      metadata: {}
    }));
  }

  // 5. Security Group - stateful, instance-level, allow-list only, evaluated on the DESTINATION.
  const attachedGroups = getAttachedSecurityGroups(target, boundaryNodes);
  const configuredGroups = attachedGroups.filter(sg => {
    const d = sg.data as any;
    return d?.allowedProtocols !== undefined || d?.securityGroupRules !== undefined;
  });

  if (configuredGroups.length > 0) {
    const peerSecurityGroupIds: string[] = source.data.securityGroupIds || [];
    const decisions = configuredGroups.map(sg => {
      const d = sg.data as any;
      const rules: SecurityGroupRules = d.securityGroupRules ?? legacyAllowedProtocolsToRules(d.allowedProtocols || []);
      return { sg, decision: evaluateSecurityGroup(rules, { direction: 'inbound', protocol, port: opts?.port, peerSecurityGroupIds, connectionState: 'new' }) };
    });
    const allowed = decisions.find(d => d.decision.allowed);
    const label = configuredGroups.map(sg => (sg.data as any)?.label || 'Security Group').join(', ');

    entries.push(entry({
      order: order++,
      component: 'Security Group',
      resource: label,
      operation: 'evaluate-security-group',
      input: { protocol, port: opts?.port, sourceSecurityGroups: peerSecurityGroupIds },
      decision: allowed ? 'ALLOW' : 'DENY',
      reason: allowed ? allowed.decision.reason : `${label} has no inbound rule allowing ${protocol}${opts?.port ? ` ${opts.port}` : ''} from the source.`,
      simpleExplanation: allowed
        ? `${target.data.label}'s Security Group has a rule allowing this connection.`
        : `${target.data.label}'s Security Group has no inbound rule allowing the source.`,
      awsRule: 'Security Groups are stateful and allow-list only: traffic is denied unless an explicit inbound rule allows it, and once allowed, its return traffic is automatically permitted.',
      metadata: { matchedRule: allowed?.decision.matchedRule, decisions: decisions.map(d => d.decision) }
    }));
  } else {
    entries.push(entry({
      order: order++,
      component: 'Security Group',
      resource: `${target.data.label} (default)`,
      operation: 'evaluate-security-group',
      input: { protocol, port: opts?.port },
      decision: 'ALLOW',
      reason: `No Security Group rules are configured on ${target.data.label} in this diagram - treated as open for simulation purposes.`,
      simpleExplanation: 'No specific firewall rules are set on this resource, so the connection is allowed through.',
      awsRule: 'Every ENI has an attached Security Group; a newly-created default Security Group allows all outbound traffic and (for the default VPC Security Group) traffic from members of itself.',
      metadata: {}
    }));
  }

  // 6. IAM - only actually in scope for real AWS-API calls (S3, DynamoDB, SQS, SNS, Lambda, KMS,
  // Secrets Manager); a raw network/database-protocol connection is authorized by SG/NACL alone.
  entries.push({ ...authorizeApplicationHop(source, target, protocol, opts?.action), order: order++ });

  // 7. Service - is the destination itself actually up and able to accept this? For a load
  // balancer, "up" means having at least one healthy registered target, not just being healthy
  // itself - an ALB with zero healthy targets returns 503 even though the ALB resource is fine.
  const model = resolveServiceModel(target.data.serviceId);
  const snapshot = toSnapshot(target);
  const configIssues = model?.validateConfiguration(snapshot) || [];
  const isHealthy = target.data.health !== 'failed';

  let noHealthyTargets = false;
  if (isHealthy && LOAD_BALANCER_SERVICE_IDS.includes(target.data.serviceId)) {
    const downstreamTargets = getDownstreamTargets(target.id, edges)
      .map(id => findNode(nodes, id))
      .filter((n): n is Node<ServiceNodeData> => Boolean(n) && n!.type !== 'boundaryNode');
    noHealthyTargets = downstreamTargets.every(n => n.data.health === 'failed');
  }

  const failed = !isHealthy || noHealthyTargets || configIssues.length > 0;

  entries.push(entry({
    order: order++,
    component: 'Service',
    resource: target.data.label,
    operation: 'evaluate-service-endpoint',
    input: { health: target.data.health, protocol },
    decision: failed ? 'FAILURE' : 'SUCCESS',
    reason: !isHealthy
      ? (target.data.failureReason || `${target.data.label} is offline/unresponsive.`)
      : noHealthyTargets
        ? `${target.data.label} has no healthy registered targets to route to.`
        : configIssues.length > 0
          ? configIssues.map(i => i.message).join(' ')
          : `${target.data.label}'s endpoint is available and ready to accept the connection.`,
    simpleExplanation: !isHealthy
      ? `${target.data.label} is down right now.`
      : noHealthyTargets
        ? `${target.data.label} has nowhere healthy left to send this request.`
        : configIssues.length > 0
          ? `${target.data.label} is misconfigured and can't actually serve this.`
          : `${target.data.label} is up and ready.`,
    awsRule: noHealthyTargets
      ? 'A load balancer with no healthy registered targets returns HTTP 503 Service Unavailable, even though the load balancer itself is healthy.'
      : 'A resource must be in a healthy, correctly-configured state to accept and process a connection, independent of whether the network path to it is allowed.',
    metadata: { configIssues, noHealthyTargets }
  }));

  return entries;
}

/** Builds the top-level SUCCESS/DENIED verdict and its one-sentence WHY, exactly matching the
 *  spec's own worked failure example's shape ("FINAL: DENIED" / "WHY: ..."). */
export function finalizeTrace(entries: TraceEntry[]): { final: 'SUCCESS' | 'DENIED'; why: string } {
  const blocking = entries.find(e => e.decision === 'DENY' || e.decision === 'FAILURE');
  if (blocking) {
    return { final: 'DENIED', why: `${blocking.resource} (${blocking.component}): ${blocking.reason}` };
  }
  return { final: 'SUCCESS', why: 'Every check along the path allowed this request through.' };
}
