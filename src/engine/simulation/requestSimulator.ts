import { authorizeApplicationHop } from '../iam/applicationHop.ts';
import { IAM_CALLER_SERVICE_IDS, IAM_AUTHENTICATED_ACTIONS } from '../capability/iamCoverage.ts';
import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData, SimulationScenario, SimulationResult } from '../../types/index.ts';
import { checkNetworkFirewalls, checkCustomNaclReturn } from './networkFirewalls.ts';
import { SimulationTrace, SIMULATION_PIPELINE } from './adapters/index.ts';
import type { AdapterContext } from './adapters/index.ts';

/**
 * Traces one request through the architecture graph, hop by hop, until it terminates
 * (success or failure). Each hop runs the ordered `SIMULATION_PIPELINE` of behavior adapters
 * (WAF inspection, auto-scaling, NAT translation, CloudFront caching, load-balancer routing,
 * data-tier interaction, VPC endpoint routing, and the generic network-path/firewall
 * resolution) - see `src/engine/simulation/adapters/` for each one. This function itself only
 * owns start-node resolution, the loop/cycle guard, the two structural per-hop checks that apply
 * before any adapter runs (node health, subnet placement), and the post-loop stateless-NACL
 * return check and response-journey step, none of which are service-specific.
 */
export function runSimulation(
  nodes: Node<ServiceNodeData>[],
  edges: Edge<ConnectionData>[],
  scenario: SimulationScenario,
  options: { enforceIam?: boolean } = {}
): SimulationResult {
  const trace = new SimulationTrace();

  const boundaryNodes = nodes.filter(n => n.type === 'boundaryNode');

  // Find start node strictly among service nodes (never a boundary container)
  const serviceNodes = nodes.filter(n => n.type === 'serviceNode' || (!n.type && (n.data as any)?.serviceId));
  let startNode = serviceNodes.find(n => n.id === scenario.startNodeId);
  if (!startNode) {
    startNode = serviceNodes.find(n => ['user', 'client_ui', 'api_client'].includes(n.data?.serviceId))
      || serviceNodes.find(n => ['internet_gateway', 'cloudfront', 'route53', 'alb', 'api_gateway'].includes(n.data?.serviceId))
      || serviceNodes[0];
  }

  if (!startNode) {
    return {
      scenario,
      steps: [],
      success: false,
      totalLatencyMs: 0,
      statusCode: 400,
      summary: 'Canvas has no active AWS services. Add services and connect them to simulate requests.',
      bottlenecksDetected: [],
      path: [],
      cascadeOccurred: false
    };
  }

  // Traversal tracker
  const visited = new Set<string>();
  // Hop budget guards against routing cycles. Counting unique visited nodes is not
  // enough: a cycle such as A -> B -> A never grows `visited`, so it would spin forever.
  const MAX_HOPS = 40;
  let hops = 0;
  let currentNode = startNode;
  // The actual ordered sequence of nodes this specific request traversed. Post-loop checks that
  // need "the compute node" or "the database" on THIS run must search this, not the full node
  // list - a canvas can have several compute/DB nodes, and only the ones this request actually
  // hit are relevant to a check about this request's return path.
  const path: Node<ServiceNodeData>[] = [startNode];

  // Step 1: User initiated request
  trace.pushStep({
    sourceNodeId: 'client-env',
    targetNodeId: currentNode.id,
    sourceNodeName: 'Client Application',
    targetNodeName: currentNode.data.label,
    protocol: 'HTTPS',
    action: `Issued ${scenario.method} ${scenario.path}`,
    status: 'success',
    explanation: `Client initiated ${scenario.method} ${scenario.path} under ${scenario.trafficLevel.toUpperCase()} traffic load.`,
    targetHealth: currentNode.data.health,
    latencyMs: 5
  });
  trace.advanceTime(5);

  // Shared by every hop that can be gated by a Network ACL or Security Group (load-balancer to
  // target, compute to database, VPC endpoint hops, and the generic direct-connection path).
  // Pushes one step per configured layer that actually gets evaluated (NACL first, then Security
  // Group, matching real packet order) - a failure step for whichever layer blocks first, or an
  // informational "allowed" step when a layer has explicit rules and lets the traffic through,
  // so the mechanism is visible in the trace either way. A layer with no rules configured
  // produces no step at all, so every other reference architecture (none of which set these
  // fields) is unaffected. Returns whether the caller should stop traversal.
  const pushFirewallBlockIfAny = (source: Node<ServiceNodeData>, target: Node<ServiceNodeData>, protocol: string): boolean => {
    const firewall = checkNetworkFirewalls(protocol, target, boundaryNodes, source);

    for (const layer of [
      { name: 'Network ACL' as const, result: firewall.nacl },
      { name: 'Security Group' as const, result: firewall.securityGroup }
    ]) {
      if (!layer.result.evaluated) continue;

      trace.pushStep({
        sourceNodeId: source.id,
        targetNodeId: target.id,
        sourceNodeName: source.data.label,
        targetNodeName: target.data.label,
        protocol: protocol as any,
        action: layer.result.blocked ? `${layer.name} Blocked Traffic` : `${layer.name}: Traffic Allowed`,
        status: layer.result.blocked ? 'failed' : 'success',
        explanation: layer.result.blocked ? `PACKET BLOCKED: ${layer.result.note}` : layer.result.note!,
        targetHealth: layer.result.blocked ? 'failed' : target.data.health,
        latencyMs: layer.result.blocked ? 5 : 2,
        details: layer.result.blocked
          ? { statusCode: 403, failureReason: layer.result.note }
          : undefined
      });

      if (layer.result.blocked) {
        trace.fail(403, `Request blocked by ${layer.name} on ${layer.result.boundaryLabel}: ${target.data.label} never received the ${protocol} request.`);
        return true;
      }

      trace.advanceTime(2);
    }

    if (options.enforceIam && IAM_AUTHENTICATED_ACTIONS[target.data.serviceId]) {
      // Preserve the application identity through transparent NAT/endpoint hops.
      const caller = IAM_CALLER_SERVICE_IDS.includes(source.data.serviceId) ? source
        : [...path].reverse().find(n => IAM_CALLER_SERVICE_IDS.includes(n.data.serviceId));
      if (caller) {
        const edge = edges.find(e => e.source === source.id && e.target === target.id);
        const decision = authorizeApplicationHop(caller, target, protocol, edge?.data?.action as string | undefined);
        trace.pushStep({ sourceNodeId: source.id, targetNodeId: target.id,
          sourceNodeName: source.data.label, targetNodeName: target.data.label,
          protocol: protocol as any, action: 'IAM authorization',
          status: decision.decision === 'DENY' ? 'failed' : 'success',
          explanation: decision.reason, targetHealth: target.data.health, latencyMs: 0,
          details: { decision, statusCode: decision.decision === 'DENY' ? 403 : undefined } });
        if (decision.decision === 'DENY') { trace.fail(403, decision.reason); return true; }
      }
    }
    return false;
  };

  while (currentNode) {
    if (++hops > MAX_HOPS) {
      trace.pushStep({
        sourceNodeId: currentNode.id,
        targetNodeId: currentNode.id,
        sourceNodeName: currentNode.data.label,
        targetNodeName: currentNode.data.label,
        protocol: 'HTTP',
        action: 'Routing Loop Detected',
        status: 'failed',
        explanation: `Loop detected: Request traversed more than ${MAX_HOPS} hops without reaching a terminal service. Check your connections for a cycle (for example A -> B -> A).`,
        targetHealth: 'failed',
        latencyMs: 10,
        details: { statusCode: 508, failureReason: 'Infinite loop in architecture routing.' }
      });
      trace.fail(508, 'Routing loop detected in architecture.');
      break;
    }

    visited.add(currentNode.id);

    // Check if current node is failed
    if (currentNode.data.health === 'failed') {
      const failReason = currentNode.data.failureReason || `${currentNode.data.label} is offline / unresponsive.`;
      trace.pushStep({
        sourceNodeId: currentNode.id,
        targetNodeId: currentNode.id,
        sourceNodeName: currentNode.data.label,
        targetNodeName: currentNode.data.label,
        protocol: 'HTTP',
        action: 'Service Down Failure',
        status: 'failed',
        explanation: `FAILED: Request halted at ${currentNode.data.label}. Reason: ${failReason}`,
        targetHealth: 'failed',
        latencyMs: 100,
        details: {
          statusCode: 503,
          failureReason: failReason
        }
      });
      trace.fail(503, `Request failed at ${currentNode.data.label}: Node is marked as FAILED.`);
      break;
    }

    // Check current node's actual canvas placement. A node's `subnet` is derived live from
    // whichever Public/Private subnet boundary it geometrically sits inside (see
    // engine/layout/containment.ts) - 'unassigned' means it is not inside any subnet at all,
    // which AWS would never allow for a resource that requires an ENI in a subnet.
    if (currentNode.data.subnet === 'unassigned') {
      trace.pushStep({
        sourceNodeId: currentNode.id,
        targetNodeId: currentNode.id,
        sourceNodeName: currentNode.data.label,
        targetNodeName: currentNode.data.label,
        protocol: 'TCP',
        action: 'Invalid Placement: Not Inside Any Subnet',
        status: 'failed',
        explanation: `ARCHITECTURE ERROR: ${currentNode.data.label} is not placed inside any Public or Private subnet boundary on the canvas. Every VPC-hosted resource must have its network interface in exactly one subnet - drag it into a subnet box to make it reachable.`,
        targetHealth: 'failed',
        latencyMs: 0,
        details: {
          statusCode: 400,
          failureReason: `${currentNode.data.label} is not geometrically placed inside a subnet boundary.`
        }
      });
      trace.fail(400, `Request failed: ${currentNode.data.label} is not placed inside any VPC subnet.`);
      break;
    }

    // Find outgoing edges (excluding return signal lines which represent response journeys),
    // and the downstream service nodes they resolve to (boundary containers excluded) - computed
    // once per hop, before running the pipeline, since several adapters need them and none of
    // the adapters that run earlier in the pipeline depend on or mutate them.
    const sourceEdges = edges.filter(e => e.source === currentNode!.id && (e.data as any)?.signalType !== 'outbound_response');
    const outgoingEdges = sourceEdges.filter(e => e.data?.traversal !== 'dependency');
    const dependencyEdges = sourceEdges.filter(e => e.data?.traversal === 'dependency');
    const downstreamNodeIds = outgoingEdges.map(e => e.target);
    const downstreamNodes = nodes.filter(n => downstreamNodeIds.includes(n.id) && n.type !== 'boundaryNode' && (n.data as any)?.serviceId);

    const ctx: AdapterContext = {
      trace,
      nodes,
      node: currentNode,
      outgoingEdges,
      dependencyEdges,
      downstreamNodes,
      visited,
      scenario,
      enforceIam: options.enforceIam,
      pushFirewallBlockIfAny
    };

    let advancedTo: Node<ServiceNodeData> | null = null;
    let terminated = false;

    for (const adapter of SIMULATION_PIPELINE) {
      const signal = adapter(ctx);
      if (signal.type === 'terminate') {
        terminated = true;
        break;
      }
      if (signal.type === 'advance') {
        advancedTo = signal.nextNode;
        break;
      }
      // 'continue' - fall through to the next adapter in the pipeline for this same hop.
    }

    if (terminated) {
      break;
    }

    // networkPathAdapter (always last in the pipeline) always terminates or advances, so
    // `advancedTo` is always set here - but guard defensively rather than assume.
    if (!advancedTo) {
      break;
    }

    currentNode = advancedTo;
    path.push(currentNode);
  }

  // Evaluate stateless NACL return journey (e.g. Database response returning to Web Server).
  // Both nodes are looked up on `path` - the sequence THIS request actually traversed - not the
  // full canvas. A diagram can contain several compute nodes or several databases; only the ones
  // this specific run actually hit are the correct pair to check the return leg for.
  if (trace.overallSuccess) {
    const webComputeNode = path.find(n => ['ec2', 'ecs', 'lambda', 'fargate'].includes(n.data.serviceId)) || startNode;
    const dbNode = path.find(n => ['rds', 'aurora', 'dynamodb'].includes(n.data.serviceId));

    if (webComputeNode && dbNode) {
      const returnCheck = checkCustomNaclReturn(webComputeNode, dbNode, boundaryNodes);
      if (returnCheck.evaluated) {
        if (returnCheck.blocked) {
          trace.pushStep({
            timestampMs: trace.currentTimestamp + 15,
            sourceNodeId: dbNode.id,
            targetNodeId: webComputeNode.id,
            sourceNodeName: dbNode.data.label,
            targetNodeName: webComputeNode.data.label,
            protocol: 'TCP',
            action: 'Stateless Return Blocked: Missing Ephemeral Rule',
            status: 'failed',
            explanation: `PACKET DROPPED (STATELESS BLOCK): ${returnCheck.note}`,
            targetHealth: 'failed',
            latencyMs: 30000,
            details: {
              statusCode: 504,
              failureReason: returnCheck.note
            }
          });
          trace.fail(504, `Connection Timeout (504): ${returnCheck.boundaryLabel} dropped response packet on client ephemeral ports.`);
          // The step itself reports a 30s latencyMs (a real stateless-NACL timeout), so the
          // client-visible total must account for it - not just whatever hop latency had
          // already accumulated before this post-loop check ran.
          trace.advanceTime(30000);
        } else {
          trace.pushStep({
            timestampMs: trace.currentTimestamp + 10,
            sourceNodeId: dbNode.id,
            targetNodeId: webComputeNode.id,
            sourceNodeName: dbNode.data.label,
            targetNodeName: webComputeNode.data.label,
            protocol: 'TCP',
            action: 'Stateless Return Allowed: Ephemeral Rule Present',
            status: 'success',
            explanation: returnCheck.note!,
            targetHealth: 'healthy',
            latencyMs: 10
          });
          trace.advanceTime(10);
        }
      }
    }
  }

  // Response journey step if request was successful
  if (trace.overallSuccess && trace.steps.length > 1) {
    trace.pushStep({
      timestampMs: trace.currentTimestamp + 15,
      sourceNodeId: currentNode ? currentNode.id : 'backend',
      targetNodeId: startNode.id,
      sourceNodeName: currentNode ? currentNode.data.label : 'Origin Backend',
      targetNodeName: startNode.data.label,
      protocol: 'HTTPS',
      action: `HTTP ${trace.finalStatusCode} Response Delivered`,
      status: 'success',
      explanation: `Full roundtrip complete. Client received HTTP ${trace.finalStatusCode} in ${trace.currentTimestamp + 15}ms.`,
      targetHealth: 'healthy',
      latencyMs: 15,
      details: { statusCode: trace.finalStatusCode }
    });
  }

  return {
    scenario,
    steps: trace.steps,
    success: trace.overallSuccess,
    totalLatencyMs: trace.currentTimestamp + (trace.overallSuccess ? 15 : 0),
    statusCode: trace.finalStatusCode,
    summary: trace.finalSummary,
    bottlenecksDetected: trace.bottlenecksDetected,
    cascadeOccurred: trace.cascadeOccurred,
    path: path.map(n => n.id)
  };
}
