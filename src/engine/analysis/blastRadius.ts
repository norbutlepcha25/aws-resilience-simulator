import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData } from '../../types/index.ts';
import { makeFinding, type Finding } from '../findings.ts';
import { createFailure, analyzeFailureImpact } from '../failure/propagation.ts';

const BLAST_RADIUS_RATIO_THRESHOLD = 0.2;
const BLAST_RADIUS_COUNT_THRESHOLD = 1;

/**
 * Reuses the Phase 9 Failure Simulation Engine's own real propagation/redundancy reasoning
 * (`analyzeFailureImpact`) instead of re-deriving "what would happen if this failed" from scratch:
 * for every resource, asks how far a failure would actually cascade (respecting Multi-AZ failover,
 * cache fallback, and target-group failover exactly like Phase 9 does), and flags the ones whose
 * blast radius is disproportionately large relative to the rest of the architecture.
 */
export function detectBlastRadius(
  nodes: Node<ServiceNodeData>[],
  edges: Edge<ConnectionData>[]
): Finding[] {
  const findings: Finding[] = [];
  const serviceNodes = nodes.filter(n => n.type !== 'boundaryNode');
  if (serviceNodes.length < 3) return findings;

  for (const node of serviceNodes) {
    const failure = createFailure({
      targetResourceId: node.id,
      failureType: 'service_unavailable',
      severity: 'high',
      trigger: 'manual',
      reason: `Hypothetical failure of ${node.data.label} (architectural blast-radius analysis)`
    });

    const impact = analyzeFailureImpact(nodes, edges, failure);
    const blastCount = impact.cascadingFailedNodeIds.length;
    const ratio = blastCount / serviceNodes.length;

    if (blastCount >= BLAST_RADIUS_COUNT_THRESHOLD && ratio >= BLAST_RADIUS_RATIO_THRESHOLD) {
      const cascadedLabels = impact.cascadingFailedNodeIds
        .map(id => serviceNodes.find(n => n.id === id)?.data.label || id);

      findings.push(makeFinding('architecture', 'blast_radius', {
        severity: ratio >= 0.5 ? 'CRITICAL' : 'HIGH',
        resource: node.data.label,
        resourceId: node.id,
        problem: `A failure of ${node.data.label} would cascade, with no redundancy absorbing it, to ${blastCount} other resource(s): ${cascadedLabels.join(', ')}.`,
        whyItMatters: `That is ${Math.round(ratio * 100)}% of the architecture's resources going down from a single failure, because none of them had an alternate path, standby, or fallback that this engine's propagation analysis (Multi-AZ failover, cache fallback, target-group failover) could find.`,
        awsRule: 'A well-isolated architecture contains a failure\'s consequences to the smallest possible set of dependents via redundancy at each tier, not just at the point of failure.',
        recommendation: `Add redundancy (Multi-AZ, a cache fallback, or a second healthy target) somewhere along the dependency chain into ${node.data.label} so its failure stops propagating.`
      }));
    }
  }

  return findings;
}
