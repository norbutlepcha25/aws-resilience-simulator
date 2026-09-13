import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData } from '../../types/index.ts';
import { makeFinding, type Finding } from '../findings.ts';
import { requestEdges } from '../failure/dependencyGraph.ts';

/**
 * Structural integrity of the connections drawn between resources - a dangling reference, a
 * self-loop, or a connection to a boundary container instead of a service are all things that
 * cannot possibly represent real traffic, independent of whether the resulting topology (if it
 * COULD carry traffic) would be a good design.
 */
export function validateDependencies(
  nodes: Node<ServiceNodeData>[],
  edges: Edge<ConnectionData>[]
): Finding[] {
  const findings: Finding[] = [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const rEdges = requestEdges(edges);

  for (const edge of rEdges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);

    if (!source || !target) {
      findings.push(makeFinding('validation', 'dependency', {
        severity: 'CRITICAL',
        resource: edge.id,
        resourceId: edge.id,
        problem: `Connection "${edge.id}" references a node id that no longer exists on the canvas (${!source ? edge.source : edge.target}).`,
        whyItMatters: 'A dangling connection cannot carry any traffic and indicates the canvas graph is out of sync (e.g. a node was deleted without its edges).',
        awsRule: 'A connection must join two resources that both actually exist.',
        recommendation: 'Delete this connection or reconnect it to an existing resource.'
      }));
      continue;
    }

    if (edge.source === edge.target) {
      findings.push(makeFinding('validation', 'dependency', {
        severity: 'HIGH',
        resource: source.data.label,
        resourceId: source.id,
        problem: `${source.data.label} has a connection to itself.`,
        whyItMatters: 'A resource cannot depend on itself for request flow - this is never valid AWS topology.',
        awsRule: 'A request-flow connection must join two distinct resources.',
        recommendation: 'Remove this self-referencing connection.'
      }));
      continue;
    }

    for (const [role, node] of [['source', source], ['target', target]] as const) {
      if (node.type === 'boundaryNode') {
        findings.push(makeFinding('validation', 'dependency', {
          severity: 'HIGH',
          resource: (node.data as any)?.label || node.id,
          resourceId: node.id,
          problem: `A connection uses ${(node.data as any)?.label || node.id} (a ${role === 'source' ? 'VPC/subnet/security-group' : 'VPC/subnet/security-group'} boundary) as its ${role}.`,
          whyItMatters: 'Boundary containers (VPC, subnet, Availability Zone, Security Group) are visual grouping only - they have no network interface and cannot send or receive traffic.',
          awsRule: 'A request-flow connection must join two actual AWS service resources, never a container boundary.',
          recommendation: `Connect directly to the service resource inside ${(node.data as any)?.label || node.id} instead of the boundary itself.`
        }));
      }
    }
  }

  return findings;
}
