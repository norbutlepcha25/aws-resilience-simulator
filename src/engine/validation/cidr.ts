import type { Node } from '@xyflow/react';
import { makeFinding, type Finding } from '../findings.ts';
import { parseCidr, cidrsOverlap } from '../network/cidr.ts';
import { findContainingVpc } from '../layout/containment.ts';

interface CidrBoundary {
  node: Node<any>;
  cidr: string;
}

function label(n: Node<any>): string {
  return (n.data as any)?.label || n.id;
}

/**
 * Validates every boundary's own address space: does its `cidr` actually parse, and does it
 * overlap another boundary that must never share addresses with it (sibling VPCs, or sibling
 * subnets carved from the same VPC)? This is pure structural correctness - AWS itself refuses to
 * create either of these, regardless of how "good" or "bad" the resulting design would be.
 */
export function validateCidrs(nodes: Node<any>[]): Finding[] {
  const findings: Finding[] = [];
  const boundaries = nodes.filter(n => n.type === 'boundaryNode');
  const withCidr: CidrBoundary[] = boundaries
    .filter(n => typeof (n.data as any)?.cidr === 'string' && (n.data as any).cidr.length > 0)
    .map(n => ({ node: n, cidr: (n.data as any).cidr }));

  for (const { node, cidr } of withCidr) {
    if (!parseCidr(cidr)) {
      findings.push(makeFinding('validation', 'cidr', {
        severity: 'CRITICAL',
        resource: label(node),
        resourceId: node.id,
        problem: `"${cidr}" is not a valid CIDR block.`,
        whyItMatters: 'A VPC or subnet cannot be created with an address block AWS cannot parse - every dependent subnet allocation and route resolution downstream of this boundary is meaningless until this is fixed.',
        awsRule: 'A VPC/subnet CIDR must be valid IPv4 CIDR notation (e.g. 10.0.0.0/16), with a prefix length between /16 and /28 for a VPC and up to /28 for a subnet.',
        recommendation: `Set ${label(node)}'s CIDR to a valid block, e.g. 10.0.0.0/16.`
      }));
    }
  }

  const vpcs = withCidr.filter(b => (b.node.data as any)?.boundaryType === 'vpc');
  for (let i = 0; i < vpcs.length; i++) {
    for (let j = i + 1; j < vpcs.length; j++) {
      if (!parseCidr(vpcs[i].cidr) || !parseCidr(vpcs[j].cidr)) continue;
      if (cidrsOverlap(vpcs[i].cidr, vpcs[j].cidr)) {
        findings.push(makeFinding('validation', 'cidr', {
          severity: 'CRITICAL',
          resource: `${label(vpcs[i].node)} / ${label(vpcs[j].node)}`,
          resourceId: vpcs[i].node.id,
          problem: `${label(vpcs[i].node)} (${vpcs[i].cidr}) and ${label(vpcs[j].node)} (${vpcs[j].cidr}) have overlapping address ranges.`,
          whyItMatters: 'Two VPCs with overlapping CIDRs cannot be peered or connected via Transit Gateway, and routing between them is ambiguous even within this diagram.',
          awsRule: 'Each VPC must have a CIDR block that does not overlap with any VPC it may need to route to or peer with.',
          recommendation: `Assign ${label(vpcs[j].node)} a non-overlapping block (e.g. a different /16 such as 10.1.0.0/16).`
        }));
      }
    }
  }

  const subnets = withCidr.filter(b => ['public_subnet', 'private_subnet'].includes((b.node.data as any)?.boundaryType));
  for (let i = 0; i < subnets.length; i++) {
    for (let j = i + 1; j < subnets.length; j++) {
      const a = subnets[i];
      const b = subnets[j];
      if (!parseCidr(a.cidr) || !parseCidr(b.cidr)) continue;
      const vpcA = findContainingVpc(a.node, boundaries)?.id;
      const vpcB = findContainingVpc(b.node, boundaries)?.id;
      if (!vpcA || vpcA !== vpcB) continue; // only sibling subnets of the SAME VPC must be disjoint
      if (cidrsOverlap(a.cidr, b.cidr)) {
        findings.push(makeFinding('validation', 'cidr', {
          severity: 'CRITICAL',
          resource: `${label(a.node)} / ${label(b.node)}`,
          resourceId: a.node.id,
          problem: `${label(a.node)} (${a.cidr}) and ${label(b.node)} (${b.cidr}) overlap, but both are carved from the same VPC.`,
          whyItMatters: 'Overlapping subnet CIDRs within one VPC make routing ambiguous - AWS rejects this at subnet-creation time, so a resource placed in either subnet has no well-defined route table.',
          awsRule: 'Every subnet CIDR within a VPC must be a non-overlapping subset of the VPC CIDR.',
          recommendation: `Re-carve one of the subnets to a disjoint block (e.g. ${a.cidr} and a separate /24 for ${label(b.node)}).`
        }));
      }
    }
  }

  return findings;
}
