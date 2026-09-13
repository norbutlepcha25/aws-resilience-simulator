// Real Security Group semantics: protocol + port/range + (CIDR or security-group reference),
// separate inbound/outbound rule sets, and statefulness (an allowed connection's return traffic
// never needs a matching rule of its own - unlike a NACL, which must permit both directions
// explicitly). This is deliberately NOT "a list of allowed service names" - see
// docs/aws-behavior/NETWORKING_BEHAVIOR.md §9 and docs/audit/NETWORKING_GAPS.md.
//
// This module is additive: `networkFirewalls.ts` uses it when a security_group boundary node
// carries the new `securityGroupRules` field, and falls back to the legacy `allowedProtocols`
// simple-list behavior when it doesn't - so every existing reference architecture (none of which
// set this field) is completely unaffected.
import { cidrContains, parsePortRange, portInRange } from './cidr.ts';

export type SecurityGroupRuleSource =
  | { type: 'cidr'; cidr: string }
  | { type: 'securityGroup'; securityGroupId: string };

export interface SecurityGroupRule {
  protocol: string; // 'TCP' | 'UDP' | 'ICMP' | 'ALL', or one of this app's ProtocolType values
  portRange: string; // '443', '1024-65535', or 'ALL'
  source: SecurityGroupRuleSource;
  description?: string;
}

export interface SecurityGroupRules {
  inbound: SecurityGroupRule[];
  outbound: SecurityGroupRule[];
}

export type ConnectionState = 'new' | 'established';

export interface SecurityGroupEvalInput {
  direction: 'inbound' | 'outbound';
  protocol: string;
  port?: number;
  /** Synthetic source CIDR for this packet - see NETWORK_ENGINE_DEVIATIONS.md for why this is a
   *  derived/synthetic value rather than a real client IP. */
  sourceCidr?: string;
  /** Security Group ids attached to the peer resource on the other end of this connection - lets
   *  a rule reference another Security Group instead of a CIDR, exactly like real AWS. */
  peerSecurityGroupIds?: string[];
  /** 'established' models AWS's stateful return traffic: once a connection has been allowed in
   *  one direction, its reply is automatically permitted without needing its own matching rule. */
  connectionState: ConnectionState;
}

export interface SecurityGroupDecision {
  allowed: boolean;
  matchedRule?: SecurityGroupRule;
  reason: string;
}

function ruleMatchesProtocol(rule: SecurityGroupRule, protocol: string): boolean {
  return rule.protocol.toUpperCase() === 'ALL' || rule.protocol.toUpperCase() === protocol.toUpperCase();
}

function ruleMatchesSource(rule: SecurityGroupRule, sourceCidr?: string, peerSgIds?: string[]): boolean {
  if (rule.source.type === 'cidr') {
    // sourceCidr is the packet's own (single) source address, so containment - "is this address
    // inside the rule's allowed block" - is the correct test, not overlap between two ranges.
    return sourceCidr ? cidrContains(rule.source.cidr, sourceCidr) : true;
  }
  return (peerSgIds || []).includes(rule.source.securityGroupId);
}

/**
 * Evaluates one Security Group's rule set for one packet. Security Groups are allow-list only
 * (there is no explicit DENY rule type in real AWS) - if no rule matches, the traffic is denied
 * by omission, not by an explicit deny entry.
 */
export function evaluateSecurityGroup(
  rules: SecurityGroupRules,
  input: SecurityGroupEvalInput
): SecurityGroupDecision {
  if (input.connectionState === 'established') {
    return {
      allowed: true,
      reason: 'Security Groups are stateful: this connection was already permitted in the originating direction, so its return traffic is automatically allowed regardless of any rule.'
    };
  }

  const ruleSet = input.direction === 'inbound' ? rules.inbound : rules.outbound;

  for (const rule of ruleSet) {
    const protocolOk = ruleMatchesProtocol(rule, input.protocol);
    const portOk = input.port === undefined || portInRange(input.port, parsePortRange(rule.portRange));
    const sourceOk = ruleMatchesSource(rule, input.sourceCidr, input.peerSecurityGroupIds);

    if (protocolOk && portOk && sourceOk) {
      const sourceDescription = rule.source.type === 'cidr' ? rule.source.cidr : `security group ${rule.source.securityGroupId}`;
      return {
        allowed: true,
        matchedRule: rule,
        reason: `${input.direction === 'inbound' ? 'Inbound' : 'Outbound'} rule allows ${rule.protocol} ${rule.portRange} from ${sourceDescription}.`
      };
    }
  }

  return {
    allowed: false,
    reason: ruleSet.length === 0
      ? `No ${input.direction} rules are configured on this Security Group - allow-list only, so nothing is permitted by default.`
      : `No ${input.direction} rule matches ${input.protocol}${input.port !== undefined ? ` port ${input.port}` : ''} from this source.`
  };
}

/** Converts this app's legacy `allowedProtocols: string[]` shape (no ports, no CIDR, no SG
 *  references - just protocol names) into the real rule shape, so both representations can be
 *  evaluated by the same function. Every legacy rule is modeled as "ALL ports, from anywhere"
 *  since that's the only thing the legacy shape ever expressed. */
export function legacyAllowedProtocolsToRules(allowedProtocols: string[]): SecurityGroupRules {
  const inbound: SecurityGroupRule[] = allowedProtocols.map(protocol => ({
    protocol,
    portRange: 'ALL',
    source: { type: 'cidr', cidr: '0.0.0.0/0' },
    description: 'Migrated from legacy allowedProtocols list.'
  }));
  return { inbound, outbound: [] };
}
