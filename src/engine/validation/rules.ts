import type { Node } from '@xyflow/react';
import type { NaclRule, SubnetNaclConfig } from '../../types/index.ts';
import type { SecurityGroupRule } from '../network/securityGroup.ts';
import { makeFinding, type Finding } from '../findings.ts';
import { parseCidr } from '../network/cidr.ts';

function label(n: Node<any>): string {
  return (n.data as any)?.label || n.id;
}

const PORT_SYNTAX = /^(\d{1,5})(-(\d{1,5}))?$/;
const MAX_PORT = 65535;

function invalidPortReason(portRange: string | undefined): string | null {
  if (!portRange || /^all$/i.test(portRange.trim())) return null;
  const m = PORT_SYNTAX.exec(portRange.trim());
  if (!m) return `"${portRange}" is not a valid port or port range.`;
  const min = Number(m[1]);
  const max = m[3] !== undefined ? Number(m[3]) : min;
  if (min > MAX_PORT || max > MAX_PORT) return `"${portRange}" exceeds the maximum valid port number (${MAX_PORT}).`;
  if (min > max) return `"${portRange}" has a start port greater than its end port.`;
  return null;
}

const EPHEMERAL_PATTERN = /1024-65535/;

function hasEphemeralReturnRule(rules: NaclRule[]): boolean {
  return rules.some(r =>
    r.action === 'ALLOW' &&
    (EPHEMERAL_PATTERN.test(r.portRange) || r.portRange.toLowerCase() === 'all' || /ephemeral/i.test(r.type)) &&
    !r.isMissingReturn
  );
}

/** Validates one subnet's custom NACL rule table: well-formed rule fields, no duplicate rule
 *  numbers (AWS rejects this outright), rule numbers within AWS's valid 1-32766 range, and an
 *  inbound path for stateless return traffic - a structural correctness question, independent of
 *  whether the NACL's actual allow/deny choices make for good security posture. */
function validateNaclConfig(boundary: Node<any>, config: SubnetNaclConfig, findings: Finding[]): void {
  for (const [direction, rules] of [['inbound', config.inboundRules], ['outbound', config.outboundRules]] as const) {
    const seenNumbers = new Map<number, NaclRule>();
    for (const rule of rules) {
      if (rule.ruleNumber === 32767) continue; // AWS's own reserved implicit-deny rule, never user-authored

      if (rule.ruleNumber < 1 || rule.ruleNumber > 32766 || !Number.isInteger(rule.ruleNumber)) {
        findings.push(makeFinding('validation', 'nacl', {
          severity: 'HIGH',
          resource: `${label(boundary)} (${direction})`,
          resourceId: boundary.id,
          problem: `Rule number ${rule.ruleNumber} is outside the valid range.`,
          whyItMatters: 'AWS refuses to create a NACL rule with an out-of-range number - this rule would simply fail to save in a real VPC.',
          awsRule: 'Custom NACL rule numbers must be integers between 1 and 32766 (32767 is reserved for the implicit final DENY).',
          recommendation: `Renumber this rule to a value between 1 and 32766.`
        }));
      }

      const dup = seenNumbers.get(rule.ruleNumber);
      if (dup) {
        findings.push(makeFinding('validation', 'nacl', {
          severity: 'HIGH',
          resource: `${label(boundary)} (${direction})`,
          resourceId: boundary.id,
          problem: `Rule number ${rule.ruleNumber} is used by more than one ${direction} rule.`,
          whyItMatters: 'Rule numbers must be unique within a direction - AWS uses the number itself to order evaluation, so a duplicate is ambiguous and cannot be created.',
          awsRule: 'Each inbound/outbound rule number in a Network ACL must be unique.',
          recommendation: `Give each ${direction} rule a distinct rule number.`
        }));
      }
      seenNumbers.set(rule.ruleNumber, rule);

      if (!parseCidr(rule.cidr)) {
        findings.push(makeFinding('validation', 'nacl', {
          severity: 'CRITICAL',
          resource: `${label(boundary)} (${direction})`,
          resourceId: boundary.id,
          problem: `Rule ${rule.ruleNumber} has an invalid CIDR: "${rule.cidr}".`,
          whyItMatters: 'A rule with an unparsable CIDR cannot be evaluated - AWS validates CIDR syntax at rule-creation time.',
          awsRule: 'A NACL rule\'s CIDR must be valid IPv4/IPv6 CIDR notation.',
          recommendation: `Fix rule ${rule.ruleNumber}'s CIDR to valid notation, e.g. 0.0.0.0/0 or 10.0.1.0/24.`
        }));
      }

      const portIssue = invalidPortReason(rule.portRange);
      if (portIssue) {
        findings.push(makeFinding('validation', 'nacl', {
          severity: 'HIGH',
          resource: `${label(boundary)} (${direction})`,
          resourceId: boundary.id,
          problem: `Rule ${rule.ruleNumber}: ${portIssue}`,
          whyItMatters: 'An unparsable port range cannot be evaluated against real traffic - this rule would never match anything, silently defeating its own purpose.',
          awsRule: 'A NACL rule\'s port range must be a single port or a valid MIN-MAX range, both within 0-65535.',
          recommendation: `Fix rule ${rule.ruleNumber}'s port range.`
        }));
      }
    }
  }

  if (config.isCustom && !hasEphemeralReturnRule(config.inboundRules)) {
    findings.push(makeFinding('validation', 'nacl', {
      severity: 'HIGH',
      resource: label(boundary),
      resourceId: boundary.id,
      problem: `${label(boundary)} has no inbound rule allowing ephemeral return ports (1024-65535).`,
      whyItMatters: 'NACLs are stateless: a reply to a connection this subnet itself initiated is not automatically permitted back in - without an explicit ephemeral-port inbound rule, every such reply is dropped and the connection times out.',
      awsRule: 'A custom Network ACL must explicitly allow inbound traffic on ephemeral ports (1024-65535) from any peer this subnet\'s resources initiate outbound connections to.',
      recommendation: `Add an inbound ALLOW rule for ports 1024-65535 from the relevant peer CIDR to ${label(boundary)}.`
    }));
  }
}

/** Validates one Security Group's explicit rule set (the real `securityGroupRules` shape, not the
 *  legacy `allowedProtocols` shorthand, which has no CIDR/port fields to malform). */
function validateSecurityGroupRules(boundary: Node<any>, rules: { inbound: SecurityGroupRule[]; outbound: SecurityGroupRule[] }, allNodes: Node<any>[], findings: Finding[]): void {
  const sgIds = new Set(allNodes.filter(n => (n.data as any)?.boundaryType === 'security_group').map(n => n.id));

  for (const [direction, ruleList] of [['inbound', rules.inbound], ['outbound', rules.outbound]] as const) {
    for (const rule of ruleList) {
      if (!rule.protocol || rule.protocol.trim().length === 0) {
        findings.push(makeFinding('validation', 'security_group', {
          severity: 'HIGH',
          resource: `${label(boundary)} (${direction})`,
          resourceId: boundary.id,
          problem: 'A rule is missing a protocol.',
          whyItMatters: 'A Security Group rule with no protocol cannot be evaluated against any traffic.',
          awsRule: 'Every Security Group rule must specify a protocol (TCP, UDP, ICMP, or ALL).',
          recommendation: 'Set an explicit protocol on this rule.'
        }));
      }

      const portIssue = invalidPortReason(rule.portRange);
      if (portIssue) {
        findings.push(makeFinding('validation', 'security_group', {
          severity: 'HIGH',
          resource: `${label(boundary)} (${direction})`,
          resourceId: boundary.id,
          problem: portIssue,
          whyItMatters: 'An unparsable port range cannot be evaluated against real traffic - this rule would never match anything.',
          awsRule: 'A Security Group rule\'s port range must be a single port or a valid MIN-MAX range, both within 0-65535.',
          recommendation: 'Fix this rule\'s port range.'
        }));
      }

      if (rule.source.type === 'cidr' && !parseCidr(rule.source.cidr)) {
        findings.push(makeFinding('validation', 'security_group', {
          severity: 'CRITICAL',
          resource: `${label(boundary)} (${direction})`,
          resourceId: boundary.id,
          problem: `Rule has an invalid CIDR source: "${rule.source.cidr}".`,
          whyItMatters: 'A rule with an unparsable CIDR cannot be evaluated.',
          awsRule: 'A Security Group rule\'s CIDR source must be valid IPv4/IPv6 CIDR notation.',
          recommendation: 'Fix this rule\'s CIDR source.'
        }));
      }

      if (rule.source.type === 'securityGroup' && !sgIds.has(rule.source.securityGroupId)) {
        findings.push(makeFinding('validation', 'security_group', {
          severity: 'HIGH',
          resource: `${label(boundary)} (${direction})`,
          resourceId: boundary.id,
          problem: `Rule references Security Group id "${rule.source.securityGroupId}", which does not exist on this canvas.`,
          whyItMatters: 'A Security Group rule referencing a nonexistent peer group can never match any real traffic.',
          awsRule: 'A Security Group rule that references another Security Group must reference one that actually exists.',
          recommendation: 'Point this rule at a Security Group that exists on the canvas, or remove it.'
        }));
      }
    }
  }
}

/** Structural validity of every NACL and Security Group rule table on the canvas - malformed
 *  fields, illegal rule numbers, dangling references, and (for NACLs) a missing stateless-return
 *  path. Never opines on whether the rules chosen are a *good* security posture (a Security Group
 *  that legally allows 0.0.0.0/0 to a database is valid config and a bad idea at the same time -
 *  see `engine/analysis/publicExposure.ts` for the latter). */
export function validateRules(nodes: Node<any>[]): Finding[] {
  const findings: Finding[] = [];
  const boundaries = nodes.filter(n => n.type === 'boundaryNode');

  for (const boundary of boundaries) {
    const data = boundary.data as any;
    if (data?.customNacl) {
      validateNaclConfig(boundary, data.customNacl as SubnetNaclConfig, findings);
    }
    if (data?.securityGroupRules) {
      validateSecurityGroupRules(boundary, data.securityGroupRules, nodes, findings);
    }
  }

  return findings;
}
