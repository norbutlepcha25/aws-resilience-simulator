import type { Node } from '@xyflow/react';
import { getAttachedSecurityGroups, findContainingSubnetBoundary } from '../layout/containment.ts';

export interface FirewallLayerResult {
  /** True only when this boundary has explicit rules configured - an undecorated boundary
   *  (the vast majority of diagrams) is not evaluated at all and produces no step. */
  evaluated: boolean;
  blocked: boolean;
  boundaryLabel?: string;
  note?: string;
}

export interface FirewallCheckResult {
  /** Network ACL: stateless, subnet-wide, evaluated first - checked against an explicit
   *  DENY list, so anything not listed passes through. */
  nacl: FirewallLayerResult;
  /** Security Group: stateful, instance-level, evaluated second (only reached if the NACL let
   *  the packet through) - checked against an explicit ALLOW list. */
  securityGroup: FirewallLayerResult;
}

const NOT_EVALUATED: FirewallLayerResult = { evaluated: false, blocked: false };

/**
 * Evaluates the two independent firewall layers AWS puts between a request and its target, in
 * the order a real packet actually crosses them: the subnet's Network ACL first, then the
 * target's own Security Group. Each layer's result is returned separately (rather than
 * collapsed into one blocked/allowed flag) so the caller can show both being evaluated even
 * when only one of them ends up blocking the traffic.
 */
export function checkNetworkFirewalls(
  protocol: string,
  targetNode: Node<any>,
  boundaryNodes: Node<any>[]
): FirewallCheckResult {
  const subnet = findContainingSubnetBoundary(targetNode, boundaryNodes);
  const denyInbound: string[] | undefined = subnet && (subnet.data as any)?.naclDenyInbound;
  const naclLabel = subnet && ((subnet.data as any)?.label || 'Network ACL');

  const nacl: FirewallLayerResult =
    denyInbound && denyInbound.length > 0
      ? denyInbound.includes(protocol)
        ? {
            evaluated: true,
            blocked: true,
            boundaryLabel: naclLabel,
            note: `${naclLabel}'s Network ACL has an explicit DENY rule for ${protocol} traffic. NACLs are stateless and evaluate every packet against numbered rules regardless of connection state - unlike a Security Group, an explicit deny here cannot be overridden by any other rule.`
          }
        : {
            evaluated: true,
            blocked: false,
            boundaryLabel: naclLabel,
            note: `${naclLabel}'s Network ACL evaluated ${protocol} traffic against its DENY rules (${denyInbound.join(', ')}) and let it through - no matching rule.`
          }
      : NOT_EVALUATED;

  // A NACL deny stops the packet before it ever reaches the instance's Security Group.
  if (nacl.blocked) {
    return { nacl, securityGroup: NOT_EVALUATED };
  }

  // An instance can have several Security Groups attached at once, exactly like real AWS - the
  // rules are unioned (allowed if ANY attached group permits it), and only groups that have
  // actually been configured (`allowedProtocols` explicitly set, even to an empty list) count.
  // A newly-attached, still-default group behaves like the wide-open SG AWS creates for you.
  const attachedGroups = getAttachedSecurityGroups(targetNode, boundaryNodes);
  const configuredGroups = attachedGroups.filter(sg => (sg.data as any)?.allowedProtocols !== undefined);

  let sgResult: FirewallLayerResult = NOT_EVALUATED;
  if (configuredGroups.length > 0) {
    const labels = configuredGroups.map(sg => (sg.data as any)?.label || 'Security Group');
    const boundaryLabel = labels.join(', ');
    const anyGroupAllows = configuredGroups.some(sg => ((sg.data as any).allowedProtocols as string[]).includes(protocol));

    if (anyGroupAllows) {
      sgResult = {
        evaluated: true,
        blocked: false,
        boundaryLabel,
        note: `${boundaryLabel} has an inbound rule allowing ${protocol} - traffic permitted.`
      };
    } else {
      const ruleSummary = configuredGroups
        .map(sg => `${(sg.data as any)?.label || 'Security Group'} (allows: ${((sg.data as any).allowedProtocols as string[]).join(', ') || 'nothing - all inbound denied'})`)
        .join('; ');
      sgResult = {
        evaluated: true,
        blocked: true,
        boundaryLabel,
        note: `No Security Group attached to ${((targetNode.data as any)?.label) || 'this resource'} allows ${protocol} - ${ruleSummary}. Security Groups are stateful and allow-list only: once a connection is permitted in, its return traffic is automatically allowed back out.`
      };
    }
  }

  return { nacl, securityGroup: sgResult };
}
