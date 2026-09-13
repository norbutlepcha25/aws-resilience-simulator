import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData } from '../../types/index.ts';
import type { Failure, FailureImpactAnalysis } from './types.ts';
import { isEdgeBlockingFailureType } from './types.ts';
import { analyzeFailureImpact } from './propagation.ts';

export interface EffectiveArchitectureState {
  nodes: Node<ServiceNodeData>[];
  edges: Edge<ConnectionData>[];
  impacts: FailureImpactAnalysis[];
}

/**
 * Merges every currently-active `Failure` onto the canvas's own nodes/edges, so `runSimulation`
 * (which only ever reads `node.data.health` / `edge.data.isFailing`) sees the real, propagated
 * consequence of each injected failure - not just its direct target. A node manually set to
 * 'failed' via `setNodeHealth`/`toggleNodeFailure`/`failAvailabilityZone` is untouched here (no
 * active `Failure` targets it), so both mechanisms compose without conflict. When more than one
 * active failure marks the same node 'degraded' vs 'failed', 'failed' always wins.
 */
export function computeEffectiveArchitectureState(
  nodes: Node<ServiceNodeData>[],
  edges: Edge<ConnectionData>[],
  failures: Failure[]
): EffectiveArchitectureState {
  const activeFailures = failures.filter(f => f.state === 'active');
  if (activeFailures.length === 0) {
    return { nodes, edges, impacts: [] };
  }

  const impacts = activeFailures.map(f => analyzeFailureImpact(nodes, edges, f));

  const failedIds = new Set<string>();
  const degradedIds = new Set<string>();
  const reasonsByNode = new Map<string, string[]>();
  const blockedEdgeIds = new Set<string>();

  for (const impact of impacts) {
    const reason = impact.failure.reason || `${impact.failure.failureType.replace(/_/g, ' ')} injected`;
    // Most edge-blocking failure types (NACL/SG/IAM/route/DNS/network) sever reachability to a
    // resource without that resource itself being unhealthy - real AWS never marks a target "down"
    // because a policy denies one caller. `nat_failure` is the one exception: its direct target
    // IS the NAT Gateway resource, which really has gone down.
    const targetIsGenuinelyUnhealthy = !isEdgeBlockingFailureType(impact.failure.failureType) || impact.failure.failureType === 'nat_failure';
    const genuinelyFailedIds = targetIsGenuinelyUnhealthy
      ? [...impact.directlyFailedNodeIds, ...impact.cascadingFailedNodeIds]
      : impact.cascadingFailedNodeIds;
    for (const id of genuinelyFailedIds) {
      failedIds.add(id);
      const list = reasonsByNode.get(id) || [];
      list.push(reason);
      reasonsByNode.set(id, list);
    }
    for (const id of impact.degradedNodeIds) degradedIds.add(id);
    for (const edgeId of impact.blockedEdgeIds) blockedEdgeIds.add(edgeId);
  }

  const effectiveNodes = nodes.map(n => {
    if (failedIds.has(n.id) && n.data.health !== 'failed') {
      return { ...n, data: { ...n.data, health: 'failed' as const, failureReason: reasonsByNode.get(n.id)!.join('; ') } };
    }
    if (degradedIds.has(n.id) && n.data.health === 'healthy') {
      return { ...n, data: { ...n.data, health: 'degraded' as const } };
    }
    return n;
  });

  const effectiveEdges = edges.map(e => {
    if (blockedEdgeIds.has(e.id)) {
      return { ...e, data: { ...(e.data as ConnectionData), isFailing: true } };
    }
    return e;
  });

  return { nodes: effectiveNodes, edges: effectiveEdges, impacts };
}
