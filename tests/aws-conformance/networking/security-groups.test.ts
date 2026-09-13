import { runConformanceCases, type ConformanceCase } from '../harness.ts';
import { evaluateSecurityGroup, legacyAllowedProtocolsToRules, type SecurityGroupRules } from '../../../src/engine/network/securityGroup.ts';

interface Result { allowed: boolean }

const rdsSgRules: SecurityGroupRules = {
  inbound: [{ protocol: 'SQL', portRange: '5432', source: { type: 'cidr', cidr: '10.0.1.0/24' } }],
  outbound: []
};

const CASES: ConformanceCase<Result>[] = [
  {
    id: 'NET-SG-CIDR-001',
    awsBehavior: 'A Security Group inbound rule with a CIDR source permits traffic from any address within that CIDR block.',
    reference: 'Amazon VPC User Guide - "Security groups for your VPC": security group rules',
    scenario: 'A request from 10.0.1.55 (inside the allowed CIDR 10.0.1.0/24) attempts SQL traffic to RDS.',
    configuration: { inboundRule: 'SQL 5432 from 10.0.1.0/24' },
    request: { protocol: 'SQL', port: 5432, sourceCidr: '10.0.1.55' },
    expected: { allowed: true },
    run: () => ({ allowed: evaluateSecurityGroup(rdsSgRules, { direction: 'inbound', protocol: 'SQL', port: 5432, sourceCidr: '10.0.1.55', connectionState: 'new' }).allowed }),
    explain: (actual) => actual.allowed
      ? 'The simulator correctly allows traffic from an address inside the rule\'s CIDR range.'
      : 'The simulator denied traffic that falls squarely within the allowed CIDR range.'
  },
  {
    id: 'NET-SG-CIDR-002',
    awsBehavior: 'A Security Group is allow-list only (no explicit DENY rule type exists) - traffic not matching ANY rule is denied by omission.',
    reference: 'Amazon VPC User Guide - "Security groups for your VPC": security groups are stateful and allow rules only',
    scenario: 'A request from 172.31.0.5 (outside the allowed CIDR 10.0.1.0/24) attempts SQL traffic to RDS.',
    configuration: { inboundRule: 'SQL 5432 from 10.0.1.0/24' },
    request: { protocol: 'SQL', port: 5432, sourceCidr: '172.31.0.5' },
    expected: { allowed: false },
    run: () => ({ allowed: evaluateSecurityGroup(rdsSgRules, { direction: 'inbound', protocol: 'SQL', port: 5432, sourceCidr: '172.31.0.5', connectionState: 'new' }).allowed }),
    explain: (actual) => !actual.allowed
      ? 'The simulator correctly denies traffic from an address outside the configured CIDR range.'
      : 'The simulator allowed traffic from an address never granted by any rule - Security Groups deny by omission, not just by explicit rule.'
  },
  {
    id: 'NET-SG-REF-001',
    awsBehavior: 'A Security Group rule can reference another Security Group instead of a CIDR - traffic is allowed from ANY resource that currently has the referenced group attached, regardless of its IP.',
    reference: 'Amazon VPC User Guide - "Security groups for your VPC": security group referencing',
    scenario: 'An RDS Security Group\'s inbound rule references "EC2-SG"; a request arrives from a resource with EC2-SG attached.',
    configuration: { inboundRule: 'SQL 5432 from security group EC2-SG' },
    request: { protocol: 'SQL', peerSecurityGroupIds: ['EC2-SG'] },
    expected: { allowed: true },
    run: () => {
      const rules: SecurityGroupRules = { inbound: [{ protocol: 'SQL', portRange: 'ALL', source: { type: 'securityGroup', securityGroupId: 'EC2-SG' } }], outbound: [] };
      return { allowed: evaluateSecurityGroup(rules, { direction: 'inbound', protocol: 'SQL', peerSecurityGroupIds: ['EC2-SG'], connectionState: 'new' }).allowed };
    },
    explain: (actual) => actual.allowed
      ? 'The simulator correctly allows traffic based on Security Group membership rather than requiring a fixed IP/CIDR.'
      : 'The simulator failed to recognize a valid Security-Group-to-Security-Group reference.'
  },
  {
    id: 'NET-SG-REF-002',
    awsBehavior: 'A Security Group reference rule only matches the SPECIFIC referenced group - membership in a different, unrelated group does not satisfy it.',
    reference: 'Amazon VPC User Guide - "Security groups for your VPC": security group referencing',
    scenario: 'An RDS Security Group\'s inbound rule references "EC2-SG"; a request arrives from a resource with only "Public-Web-SG" attached.',
    configuration: { inboundRule: 'SQL 5432 from security group EC2-SG' },
    request: { protocol: 'SQL', peerSecurityGroupIds: ['Public-Web-SG'] },
    expected: { allowed: false },
    run: () => {
      const rules: SecurityGroupRules = { inbound: [{ protocol: 'SQL', portRange: 'ALL', source: { type: 'securityGroup', securityGroupId: 'EC2-SG' } }], outbound: [] };
      return { allowed: evaluateSecurityGroup(rules, { direction: 'inbound', protocol: 'SQL', peerSecurityGroupIds: ['Public-Web-SG'], connectionState: 'new' }).allowed };
    },
    explain: (actual) => !actual.allowed
      ? 'The simulator correctly denies traffic from a group that was never named in the rule.'
      : 'The simulator incorrectly allowed traffic from an unrelated Security Group.'
  },
  {
    id: 'NET-SG-STATEFUL-001',
    awsBehavior: 'Security Groups are STATEFUL: once a connection is allowed in one direction, its return traffic is automatically permitted, with no matching rule required in the other direction.',
    reference: 'Amazon VPC User Guide - "Security groups for your VPC": security groups are stateful',
    scenario: 'A connection already established inbound now needs its response permitted outbound, with zero outbound rules configured.',
    configuration: { outboundRules: [], connectionState: 'established' },
    request: { direction: 'outbound', protocol: 'HTTPS' },
    expected: { allowed: true },
    run: () => ({ allowed: evaluateSecurityGroup({ inbound: [], outbound: [] }, { direction: 'outbound', protocol: 'HTTPS', connectionState: 'established' }).allowed }),
    explain: (actual) => actual.allowed
      ? 'The simulator correctly auto-permits return traffic for an already-established connection with no matching rule needed.'
      : 'The simulator incorrectly required an explicit outbound rule for return traffic - Security Groups are stateful, unlike NACLs.'
  },
  {
    id: 'NET-SG-STATEFUL-002',
    awsBehavior: 'Statefulness applies only to an ALREADY-ESTABLISHED connection\'s return traffic - a genuinely NEW connection in the reverse direction still needs its own matching rule.',
    reference: 'Amazon VPC User Guide - "Security groups for your VPC": security groups are stateful',
    scenario: 'A brand-new (not established) outbound connection is attempted with zero outbound rules configured.',
    configuration: { outboundRules: [], connectionState: 'new' },
    request: { direction: 'outbound', protocol: 'HTTPS' },
    expected: { allowed: false },
    run: () => ({ allowed: evaluateSecurityGroup({ inbound: [], outbound: [] }, { direction: 'outbound', protocol: 'HTTPS', connectionState: 'new' }).allowed }),
    explain: (actual) => !actual.allowed
      ? 'The simulator correctly requires an explicit rule for a genuinely new connection, not just any traffic in that direction.'
      : 'The simulator conflated "stateful return traffic" with "all traffic in that direction is free" - these are not the same thing in real AWS.'
  },
  {
    id: 'NET-SG-LEGACY-001',
    awsBehavior: 'A simplified/legacy allow-list of protocol names should still evaluate through the same underlying allow-list semantics as an explicit rule set.',
    reference: 'Amazon VPC User Guide - "Security groups for your VPC" (simulator-internal regression guard for its own legacy shorthand)',
    scenario: 'A Security Group configured with the simulator\'s legacy `allowedProtocols: ["HTTPS"]` shorthand receives an HTTPS request.',
    configuration: { allowedProtocols: ['HTTPS'] },
    request: { protocol: 'HTTPS' },
    expected: { allowed: true },
    run: () => ({ allowed: evaluateSecurityGroup(legacyAllowedProtocolsToRules(['HTTPS']), { direction: 'inbound', protocol: 'HTTPS', connectionState: 'new' }).allowed }),
    explain: (actual) => actual.allowed
      ? 'The legacy shorthand correctly translates into a real allow rule for the matching protocol.'
      : 'The legacy shorthand translation is broken - a configured protocol was denied.'
  }
];

runConformanceCases(CASES);
