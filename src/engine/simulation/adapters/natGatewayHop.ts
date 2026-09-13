import type { AdapterContext, AdapterSignal } from './types.ts';
import { CONTINUE, TERMINATE } from './types.ts';
import { validateNatGatewayPlacement } from '../../network/nat.ts';

/** NAT Gateway packet translation - must be placed in a public subnet to have any path to the
 *  Internet Gateway at all; a NAT Gateway itself is never an inbound path. Decision logic lives
 *  in src/engine/network/nat.ts, shared with networkPathAdapter's egress check. */
export const natGatewayAdapter = (ctx: AdapterContext): AdapterSignal => {
  const { trace, node } = ctx;

  if (node.data.serviceId !== 'nat_gateway') {
    return CONTINUE;
  }

  const decision = validateNatGatewayPlacement(node.data.label, node.data.subnet);

  if (decision.outcome === 'misplaced') {
    trace.pushStep({
      sourceNodeId: node.id,
      targetNodeId: node.id,
      sourceNodeName: node.data.label,
      targetNodeName: node.data.label,
      protocol: 'TCP',
      action: 'NAT Gateway Misconfiguration in Private Subnet',
      status: 'failed',
      explanation: decision.explanation,
      targetHealth: 'failed',
      latencyMs: 50,
      details: {
        statusCode: decision.statusCode,
        failureReason: 'NAT Gateway deployed in private subnet instead of public subnet.'
      }
    });
    trace.fail(decision.statusCode, 'NAT Gateway misconfigured: Must be located in a public subnet.');
    return TERMINATE;
  }

  trace.pushStep({
    sourceNodeId: node.id,
    targetNodeId: node.id,
    sourceNodeName: node.data.label,
    targetNodeName: node.data.label,
    protocol: 'TCP',
    action: 'SNAT: Private IP -> Elastic IP (EIP)',
    status: 'success',
    explanation: decision.explanation,
    targetHealth: 'healthy',
    latencyMs: 12
  });
  trace.advanceTime(12);
  return CONTINUE;
};
