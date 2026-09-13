import type { AdapterContext, AdapterSignal } from './types.ts';
import { CONTINUE, TERMINATE, advanceTo } from './types.ts';

const ENDPOINT_SERVICE_IDS = ['s3_gateway_endpoint', 'privatelink'];

/**
 * Explicit VPC Endpoint hop: a private-subnet resource wired directly to a Gateway/Interface
 * Endpoint node on the canvas (rather than straight to S3/DynamoDB), the architecturally correct
 * way to draw it.
 */
export const vpcEndpointAdapter = (ctx: AdapterContext): AdapterSignal => {
  const { trace, node, downstreamNodes, pushFirewallBlockIfAny } = ctx;

  const endpointTarget = downstreamNodes.find(n => ENDPOINT_SERVICE_IDS.includes(n.data.serviceId));
  const sourceIsPrivate = node.data.subnet === 'private' || node.data.subnet === 'isolated';

  if (!endpointTarget || !sourceIsPrivate) {
    return CONTINUE;
  }

  const isGatewayEndpoint = endpointTarget.data.serviceId === 's3_gateway_endpoint';

  // A Gateway VPC Endpoint has no ENI at all (a route-table/prefix-list construct) - nothing for
  // a Security Group to attach to, so no firewall check applies. An Interface VPC Endpoint
  // (privatelink) IS ENI-based and is subject to Security Groups exactly like any other
  // ENI-backed resource, same as real AWS PrivateLink.
  if (!isGatewayEndpoint && pushFirewallBlockIfAny(node, endpointTarget, 'HTTPS')) {
    return TERMINATE;
  }

  trace.pushStep({
    sourceNodeId: node.id,
    targetNodeId: endpointTarget.id,
    sourceNodeName: node.data.label,
    targetNodeName: endpointTarget.data.label,
    protocol: 'HTTPS',
    action: isGatewayEndpoint ? 'AWS VPC Gateway Endpoint Route' : 'AWS VPC Interface Endpoint Route',
    status: 'success',
    explanation: `${node.data.label} in a private subnet routed directly to ${endpointTarget.data.label} over the AWS private backbone. Zero internet exposure, and no NAT Gateway data-processing charges.`,
    targetHealth: endpointTarget.data.health,
    latencyMs: 4
  });
  trace.advanceTime(4);
  return advanceTo(endpointTarget);
};
