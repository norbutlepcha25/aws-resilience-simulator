// NAT Gateway chain validation: private resource -> NAT Gateway -> Internet Gateway -> Internet.
// Pure decision functions shared by `adapters/natGatewayHop.ts` (the NAT Gateway node's own
// self-check when it is itself the current hop) and `adapters/networkPath.ts` (a private-subnet
// resource's outbound egress check when NAT is the next hop) - one definition of "is this NAT
// path actually valid", instead of two independently-maintained copies of the same rules.
export type NatDecision =
  | { outcome: 'misplaced'; statusCode: 502; explanation: string }
  | { outcome: 'missing'; statusCode: 504; explanation: string }
  | { outcome: 'failed'; statusCode: 504; explanation: string }
  | { outcome: 'ok'; explanation: string };

/** A NAT Gateway must itself be deployed in a public subnet (with its own route to an Internet
 *  Gateway) - otherwise it has no path to the internet to translate traffic onto. */
export function validateNatGatewayPlacement(natLabel: string, natSubnet: string): NatDecision {
  if (natSubnet !== 'public') {
    return {
      outcome: 'misplaced',
      statusCode: 502,
      explanation: `ROUTING ERROR: ${natLabel} is deployed in a private subnet! A NAT Gateway must be placed in a public subnet with a default route to an Internet Gateway (0.0.0.0/0 -> igw). Egress traffic cannot be dispatched.`
    };
  }
  return {
    outcome: 'ok',
    explanation: `${natLabel} in public subnet performed Source Network Address Translation (SNAT). Replaced private instance IP with public Elastic IP. Forwarding outbound packet to Internet Gateway.`
  };
}

/** Resolves whether a private-subnet resource's outbound egress can actually reach a NAT
 *  Gateway: no NAT Gateway anywhere in the architecture, or one that exists but is unhealthy, or
 *  a healthy one that completes the SNAT hop. */
export function resolveNatEgress(
  sourceLabel: string,
  destinationLabel: string,
  natGateway: { label: string; health: 'healthy' | 'degraded' | 'failed' } | undefined
): NatDecision {
  if (!natGateway) {
    return {
      outcome: 'missing',
      statusCode: 504,
      explanation: `EGRESS TIMEOUT: Instance [${sourceLabel}] in private subnet attempted external communication, but no NAT Gateway or VPC Endpoint exists in the route table. Outbound packets dropped.`
    };
  }
  if (natGateway.health === 'failed') {
    return {
      outcome: 'failed',
      statusCode: 504,
      explanation: `CRITICAL OUTAGE: NAT Gateway [${natGateway.label}] is offline/unhealthy. Private subnet outbound egress dropped.`
    };
  }
  return {
    outcome: 'ok',
    explanation: `Outbound egress routed through NAT Gateway [${natGateway.label}] in public subnet. Translated private IP to Elastic IP (EIP) via Source NAT (SNAT). Forwarding outbound traffic to ${destinationLabel}.`
  };
}
