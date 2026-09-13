import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData } from '../../types/index.ts';

/**
 * An edge's `source -> target` is the direction a request actually flows (client to server, one
 * hop), so `target` DEPENDS ON `source` sending it work, and `source` DEPENDS ON `target` to
 * fulfill it. "Who is harmed if this node goes down" is therefore always the SOURCE side of every
 * edge pointing at it - its upstream callers, whose own requests now have nowhere to go.
 *
 * Return/response signal edges (`signalType === 'outbound_response'`) are UI-only annotations of
 * the reverse leg of an already-drawn forward edge, not a second independent dependency - they are
 * excluded everywhere in this module, matching `requestSimulator.ts`'s own `outgoingEdges` filter.
 */
export function requestEdges(edges: Edge<ConnectionData>[]): Edge<ConnectionData>[] {
  return edges.filter(e => (e.data as any)?.signalType !== 'outbound_response');
}

/** Nodes with an outgoing edge into `nodeId` - i.e. callers who depend on `nodeId` being up. */
export function getUpstreamCallers(nodeId: string, edges: Edge<ConnectionData>[]): string[] {
  const rEdges = requestEdges(edges);
  return [...new Set(rEdges.filter(e => e.target === nodeId).map(e => e.source))];
}

/** Nodes `nodeId` sends requests to - what `nodeId` itself depends on. */
export function getDownstreamTargets(nodeId: string, edges: Edge<ConnectionData>[]): string[] {
  const rEdges = requestEdges(edges);
  return [...new Set(rEdges.filter(e => e.source === nodeId).map(e => e.target))];
}

export function findNode(nodes: Node<ServiceNodeData>[], id: string): Node<ServiceNodeData> | undefined {
  return nodes.find(n => n.id === id);
}

/**
 * Pure routing/edge infrastructure - AWS never takes one of these "down" because something it
 * routes to is unhealthy (an ALB with zero healthy targets returns 503 to ITS callers; the ALB
 * itself, and everything upstream of it, stays up). Propagation therefore never marks one of
 * these `cascadingFailed`, and never continues walking past it to ITS OWN upstream callers - the
 * observable failure is fully explained by "this hop returned an error," not by chain-failing
 * every box on the request's path back to the client.
 */
export const NETWORK_INFRA_SERVICE_IDS = [
  'internet_gateway', 'nat_gateway', 'alb', 'nlb', 'elb', 'api_gateway',
  'cloudfront', 'route53', 'privatelink', 's3_gateway_endpoint', 'vpc'
];

export function isNetworkInfraNode(node: Node<ServiceNodeData>): boolean {
  return NETWORK_INFRA_SERVICE_IDS.includes(node.data.serviceId);
}
