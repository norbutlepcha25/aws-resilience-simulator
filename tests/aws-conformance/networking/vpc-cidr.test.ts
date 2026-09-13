import { runConformanceCases, type ConformanceCase } from '../harness.ts';
import { parseCidr, cidrContains, cidrsOverlap } from '../../../src/engine/network/cidr.ts';

interface Result { valid: boolean; detail: string }

const CASES: ConformanceCase<Result>[] = [
  {
    id: 'NET-CIDR-001',
    awsBehavior: 'A VPC IPv4 CIDR block must be between /16 and /28 in size and be valid CIDR notation.',
    reference: 'Amazon VPC User Guide - "VPCs and subnets": VPC sizing',
    scenario: 'A VPC is created with a well-formed /16 CIDR block.',
    configuration: { vpcCidr: '10.0.0.0/16' },
    request: { operation: 'parse VPC CIDR' },
    expected: { valid: true, detail: 'parsed' },
    run: () => ({ valid: parseCidr('10.0.0.0/16') !== null, detail: 'parsed' }),
    explain: (actual) => actual.valid
      ? 'The simulator\'s CIDR parser accepts a standard /16 VPC block, matching AWS.'
      : 'The simulator rejected a valid /16 CIDR - this would incorrectly block a legal VPC configuration.'
  },
  {
    id: 'NET-CIDR-002',
    awsBehavior: 'A CIDR block with a prefix length outside 0-32 (IPv4) is not valid notation and cannot be assigned to a VPC or subnet.',
    reference: 'Amazon VPC User Guide - "VPCs and subnets": CIDR block association',
    scenario: 'An attempt to use "10.0.0.0/33" (an invalid prefix length) as a VPC CIDR.',
    configuration: { vpcCidr: '10.0.0.0/33' },
    request: { operation: 'parse VPC CIDR' },
    expected: { valid: false, detail: 'rejected' },
    run: () => ({ valid: parseCidr('10.0.0.0/33') !== null, detail: 'rejected' }),
    explain: (actual) => !actual.valid
      ? 'The simulator correctly rejects a malformed CIDR rather than silently accepting it.'
      : 'The simulator accepted an invalid /33 prefix - AWS would reject this at VPC-creation time.'
  },
  {
    id: 'NET-CIDR-003',
    awsBehavior: 'Every subnet\'s CIDR block must be a subset of its VPC\'s CIDR block - a subnet cannot span addresses outside its VPC.',
    reference: 'Amazon VPC User Guide - "VPCs and subnets": subnet CIDR blocks',
    scenario: 'A subnet CIDR of 10.0.1.0/24 is checked against its VPC\'s 10.0.0.0/16 block.',
    configuration: { vpcCidr: '10.0.0.0/16', subnetCidr: '10.0.1.0/24' },
    request: { operation: 'check subnet is subset of VPC' },
    expected: { valid: true, detail: 'contained' },
    run: () => ({ valid: cidrContains('10.0.0.0/16', '10.0.1.0/24'), detail: 'contained' }),
    explain: (actual) => actual.valid
      ? 'The simulator correctly recognizes 10.0.1.0/24 as a valid subset of 10.0.0.0/16.'
      : 'The simulator failed to recognize a legitimate subnet-of-VPC relationship.'
  },
  {
    id: 'NET-CIDR-004',
    awsBehavior: 'A subnet CIDR that falls OUTSIDE its VPC\'s CIDR block cannot be created - AWS rejects it at creation time.',
    reference: 'Amazon VPC User Guide - "VPCs and subnets": subnet CIDR blocks',
    scenario: 'A subnet CIDR of 10.1.0.0/24 is checked against a VPC CIDR of 10.0.0.0/16 (a different /16).',
    configuration: { vpcCidr: '10.0.0.0/16', subnetCidr: '10.1.0.0/24' },
    request: { operation: 'check subnet is subset of VPC' },
    expected: { valid: false, detail: 'not contained' },
    run: () => ({ valid: cidrContains('10.0.0.0/16', '10.1.0.0/24'), detail: 'not contained' }),
    explain: (actual) => !actual.valid
      ? 'The simulator correctly rejects a subnet CIDR that falls outside its VPC\'s address range.'
      : 'The simulator incorrectly treated an out-of-range subnet CIDR as valid.'
  },
  {
    id: 'NET-CIDR-005',
    awsBehavior: 'Two subnets within the same VPC must not have overlapping CIDR blocks - AWS rejects the second subnet\'s creation.',
    reference: 'Amazon VPC User Guide - "VPCs and subnets": subnet CIDR blocks must not overlap',
    scenario: 'Two sibling subnets are carved from the same VPC with overlapping ranges: 10.0.1.0/24 and 10.0.1.128/25.',
    configuration: { subnetA: '10.0.1.0/24', subnetB: '10.0.1.128/25' },
    request: { operation: 'check sibling subnets for overlap' },
    expected: { valid: false, detail: 'overlap detected' },
    run: () => ({ valid: !cidrsOverlap('10.0.1.0/24', '10.0.1.128/25'), detail: 'overlap detected' }),
    explain: (actual) => !actual.valid
      ? 'The simulator correctly detects that 10.0.1.128/25 is entirely contained within 10.0.1.0/24 and therefore overlaps.'
      : 'The simulator failed to detect an overlap between two subnet CIDRs that share every address in the smaller range.'
  },
  {
    id: 'NET-CIDR-006',
    awsBehavior: 'Two subnets with genuinely disjoint CIDR blocks (no shared addresses) are valid siblings of the same VPC.',
    reference: 'Amazon VPC User Guide - "VPCs and subnets"',
    scenario: 'Two sibling subnets are carved from the same VPC with disjoint ranges: 10.0.1.0/24 and 10.0.2.0/24.',
    configuration: { subnetA: '10.0.1.0/24', subnetB: '10.0.2.0/24' },
    request: { operation: 'check sibling subnets for overlap' },
    expected: { valid: true, detail: 'no overlap' },
    run: () => ({ valid: !cidrsOverlap('10.0.1.0/24', '10.0.2.0/24'), detail: 'no overlap' }),
    explain: (actual) => actual.valid
      ? 'The simulator correctly recognizes two disjoint /24 blocks as non-overlapping.'
      : 'The simulator incorrectly flagged two genuinely disjoint subnet CIDRs as overlapping.'
  }
];

runConformanceCases(CASES);
