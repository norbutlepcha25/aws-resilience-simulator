import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData } from '../../types/index.ts';
import { getDownstreamTargets, findNode } from './dependencyGraph.ts';

const DB_SERVICE_IDS = ['rds', 'aurora', 'dynamodb'];
/** Aurora and DynamoDB replicate/failover with no customer-facing outage window at all
 *  (docs/aws-behavior/FAILURE_BEHAVIOR.md) - they behave as inherently self-healing regardless of
 *  the `multiAz` flag on their node. */
const INHERENTLY_RESILIENT_DB_SERVICE_IDS = ['aurora', 'dynamodb'];

export interface RedundancyCheck {
  /** Every failed target this dependent needed was covered by some redundancy mechanism. */
  fullyCovered: boolean;
  /** At least one (but not all) failed targets were covered - the dependent keeps functioning in
   *  a reduced capacity rather than going fully down. */
  partiallyCovered: boolean;
  note: string;
  mechanism?: string;
}

/**
 * Checks whether `dependentNode` survives the failure of `failedTargetIds` (a subset of its own
 * downstream targets that are currently down), by looking for a real, structural alternative -
 * never a blanket assumption. Three concrete mechanisms are recognized, mirroring exactly what
 * `dataTierInteractionAdapter.ts` and `loadBalancerAdapter.ts` already do live per-request:
 *
 * 1. Multi-AZ / inherently-resilient database failover - the failed target itself recovers.
 * 2. A healthy ElastiCache node reachable from the dependent - circuit-breaker cache fallback.
 * 3. A healthy sibling node of the same service, reachable from the dependent via another edge -
 *    target-group failover (e.g. a second ECS task behind the same ALB).
 */
export function checkRedundancy(
  dependentNode: Node<ServiceNodeData>,
  failedTargetIds: string[],
  globallyFailedIds: Set<string>,
  nodes: Node<ServiceNodeData>[],
  edges: Edge<ConnectionData>[]
): RedundancyCheck {
  const dependentDownstream = getDownstreamTargets(dependentNode.id, edges);
  const covered: string[] = [];
  const uncovered: string[] = [];
  const mechanisms: string[] = [];

  for (const failedId of failedTargetIds) {
    const failedNode = findNode(nodes, failedId);
    if (!failedNode) {
      uncovered.push(failedId);
      continue;
    }

    if (DB_SERVICE_IDS.includes(failedNode.data.serviceId)) {
      const selfHeals =
        failedNode.data.multiAz ||
        failedNode.data.az === 'Multi-AZ' ||
        INHERENTLY_RESILIENT_DB_SERVICE_IDS.includes(failedNode.data.serviceId);

      if (selfHeals) {
        covered.push(failedId);
        mechanisms.push(`${failedNode.data.label} is Multi-AZ / inherently resilient and automatically fails over`);
        continue;
      }

      const cacheSibling = dependentDownstream
        .map(id => findNode(nodes, id))
        .find(n => n && n.data.serviceId === 'elasticache' && n.data.health === 'healthy' && !globallyFailedIds.has(n.id));

      if (cacheSibling) {
        covered.push(failedId);
        mechanisms.push(`${dependentNode.data.label} falls back to cache ${cacheSibling.data.label}`);
        continue;
      }

      uncovered.push(failedId);
      continue;
    }

    // Generic target-group / sibling failover: another downstream node of the same serviceId,
    // reachable from the same dependent, that is healthy and not itself down in this scenario.
    const sibling = dependentDownstream
      .filter(id => id !== failedId)
      .map(id => findNode(nodes, id))
      .find(n => n && n.data.serviceId === failedNode.data.serviceId && n.data.health === 'healthy' && !globallyFailedIds.has(n.id));

    if (sibling) {
      covered.push(failedId);
      mechanisms.push(`${dependentNode.data.label} routes around ${failedNode.data.label} to healthy sibling ${sibling.data.label}`);
      continue;
    }

    uncovered.push(failedId);
  }

  const fullyCovered = uncovered.length === 0;
  const partiallyCovered = covered.length > 0 && uncovered.length > 0;
  const note = fullyCovered
    ? `Fully redundant: ${mechanisms.join('; ')}.`
    : partiallyCovered
      ? `Partially redundant: ${mechanisms.join('; ')}; no alternative found for ${uncovered.length} target(s).`
      : `No redundancy found for ${dependentNode.data.label}'s dependency on ${failedTargetIds.length} failed target(s).`;

  return {
    fullyCovered,
    partiallyCovered,
    note,
    mechanism: mechanisms.length > 0 ? mechanisms.join('; ') : undefined
  };
}
