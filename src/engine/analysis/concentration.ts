import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData } from '../../types/index.ts';
import { makeFinding, type Finding } from '../findings.ts';
import { getUpstreamCallers } from '../failure/dependencyGraph.ts';

const CONCENTRATION_THRESHOLD = 3;

/**
 * A node with many distinct upstream callers is a concentration point: whatever it does badly (an
 * outage, a slow query, a bad deploy) is shared by everything depending on it at once. This is a
 * purely structural graph observation (fan-in count) - it says nothing about whether the resource
 * itself is configured validly, only that its failure blast radius is inherently wide.
 */
export function detectDependencyConcentration(
  nodes: Node<ServiceNodeData>[],
  edges: Edge<ConnectionData>[]
): Finding[] {
  const findings: Finding[] = [];
  const serviceNodes = nodes.filter(n => n.type !== 'boundaryNode');

  for (const node of serviceNodes) {
    const callers = getUpstreamCallers(node.id, edges)
      .map(id => serviceNodes.find(n => n.id === id))
      .filter((n): n is Node<ServiceNodeData> => Boolean(n));

    if (callers.length >= CONCENTRATION_THRESHOLD) {
      findings.push(makeFinding('architecture', 'dependency_concentration', {
        severity: callers.length >= CONCENTRATION_THRESHOLD + 2 ? 'HIGH' : 'MEDIUM',
        resource: node.data.label,
        resourceId: node.id,
        problem: `${callers.length} distinct resources all depend directly on ${node.data.label} (${callers.map(c => c.data.label).join(', ')}).`,
        whyItMatters: 'Every one of those callers shares the same fate as this single resource - a misconfiguration, capacity limit, or outage here impacts all of them simultaneously, not just one request path.',
        awsRule: 'A shared dependency should be scaled, isolated (e.g. per-tenant or per-workload), or made redundant in proportion to how many independent workloads rely on it.',
        recommendation: `Confirm ${node.data.label} is scaled and made redundant for the combined load of all ${callers.length} dependents, or consider splitting it per workload.`
      }));
    }
  }

  return findings;
}
