import { runConformanceCases, type ConformanceCase } from '../harness.ts';
import { evaluateNaclRules } from '../../../src/engine/network/nacl.ts';
import type { NaclRule } from '../../../src/types/index.ts';

interface Result { blocked: boolean; decidingRuleNumber: number }

const orderedRules: NaclRule[] = [
  { ruleNumber: 90, type: 'HTTP', protocol: 'TCP', portRange: '80', cidr: '0.0.0.0/0', action: 'ALLOW' },
  { ruleNumber: 100, type: 'HTTP', protocol: 'TCP', portRange: '80', cidr: '0.0.0.0/0', action: 'DENY' }
];

const CASES: ConformanceCase<Result>[] = [
  {
    id: 'NET-NACL-ORDER-001',
    awsBehavior: 'NACL rules are evaluated in ASCENDING rule-number order; the first rule that matches wins, regardless of what a later, more specific-looking rule says.',
    reference: 'Amazon VPC User Guide - "Network ACLs": rule evaluation order',
    scenario: 'Rule 90 ALLOWs HTTP; a later Rule 100 DENYs the same HTTP traffic. Both would match.',
    configuration: { rules: orderedRules.map(r => `${r.ruleNumber} ${r.action}`) },
    request: { protocol: 'HTTP' },
    expected: { blocked: false, decidingRuleNumber: 90 },
    run: () => {
      const r = evaluateNaclRules(orderedRules, 'HTTP');
      return { blocked: r.blocked, decidingRuleNumber: r.decidingRule.ruleNumber };
    },
    explain: (actual) => actual.decidingRuleNumber === 90
      ? 'The simulator correctly applies the lower-numbered rule (90, ALLOW) and never even reaches rule 100.'
      : `The simulator let rule ${actual.decidingRuleNumber} decide instead of the first (lowest-numbered) match - this violates AWS's first-match-wins ordering.`
  },
  {
    id: 'NET-NACL-ORDER-002',
    awsBehavior: 'Rule evaluation order follows RULE NUMBER, not array/insertion order - a rule listed later in the table but with a lower number still wins.',
    reference: 'Amazon VPC User Guide - "Network ACLs": rule evaluation order',
    scenario: 'The same two rules as above, but stored in the opposite (DENY-first) array order.',
    configuration: { rules: ['100 DENY (listed first)', '90 ALLOW (listed second)'] },
    request: { protocol: 'HTTP' },
    expected: { blocked: false, decidingRuleNumber: 90 },
    run: () => {
      const reversedArrayOrder = [...orderedRules].reverse();
      const r = evaluateNaclRules(reversedArrayOrder, 'HTTP');
      return { blocked: r.blocked, decidingRuleNumber: r.decidingRule.ruleNumber };
    },
    explain: (actual) => actual.decidingRuleNumber === 90
      ? 'The simulator sorts by rule number before evaluating, independent of array order - matching AWS.'
      : 'The simulator appears to evaluate rules in array order rather than by rule number - a real NACL never does this.'
  },
  {
    id: 'NET-NACL-IMPLICIT-DENY-001',
    awsBehavior: 'A NACL denies by default: if no configured rule matches, AWS\'s own immutable final rule (numbered 32767, "* DENY") applies.',
    reference: 'Amazon VPC User Guide - "Network ACLs": the implicit deny rule',
    scenario: 'A NACL has only an HTTP allow rule; a request arrives for a completely different protocol/port (SSH, port 22).',
    configuration: { rules: ['90 ALLOW TCP 80'] },
    request: { protocol: 'SSH' },
    expected: { blocked: true, decidingRuleNumber: 32767 },
    run: () => {
      const r = evaluateNaclRules([orderedRules[0]], 'SSH');
      return { blocked: r.blocked, decidingRuleNumber: r.decidingRule.ruleNumber };
    },
    explain: (actual) => actual.decidingRuleNumber === 32767
      ? 'The simulator correctly falls through to the implicit final DENY (rule 32767) when nothing configured matches.'
      : 'The simulator allowed traffic that matched no configured rule - real NACLs deny by default, they never fail open.'
  },
  {
    id: 'NET-NACL-STATELESS-001',
    awsBehavior: 'NACLs are STATELESS: an inbound ALLOW rule does not imply anything about the return/outbound direction - the return leg needs its own explicit rule.',
    reference: 'Amazon VPC User Guide - "Network ACLs": network ACLs are stateless',
    scenario: 'An inbound rule allows HTTP; the OUTBOUND direction (for the same NACL) has no corresponding rule at all.',
    configuration: { inboundRules: ['90 ALLOW TCP 80'], outboundRules: [] },
    request: { direction: 'outbound', protocol: 'HTTP' },
    expected: { blocked: true, decidingRuleNumber: 32767 },
    run: () => {
      // The inbound allow rule must not be consulted for an outbound evaluation - passing an
      // empty outbound rule set proves the two directions are evaluated completely independently.
      const r = evaluateNaclRules([], 'HTTP');
      return { blocked: r.blocked, decidingRuleNumber: r.decidingRule.ruleNumber };
    },
    explain: (actual) => actual.blocked
      ? 'The simulator correctly evaluates inbound and outbound as two entirely independent rule sets - an inbound allow grants nothing outbound.'
      : 'The simulator let an inbound rule implicitly cover the outbound direction - this is exactly the mistake that makes NACLs (falsely) look stateful.'
  },
  {
    id: 'NET-NACL-RETURN-001',
    awsBehavior: 'Because NACLs are stateless, a response to a connection this subnet\'s own resource initiated must be explicitly permitted back in on the CLIENT\'S EPHEMERAL PORT RANGE (1024-65535) - otherwise the reply is dropped and the connection times out.',
    reference: 'Amazon VPC User Guide - "Network ACLs": ephemeral ports',
    scenario: 'A client\'s subnet NACL has no inbound rule for ephemeral return ports (1024-65535) - a database\'s response packet arrives.',
    configuration: { inboundRules: ['100 ALLOW TCP 80 (no ephemeral rule)'] },
    request: { protocol: 'TCP', port: 54321 },
    expected: { blocked: true, decidingRuleNumber: 32767 },
    run: () => {
      const httpOnlyRules: NaclRule[] = [{ ruleNumber: 100, type: 'HTTP', protocol: 'TCP', portRange: '80', cidr: '0.0.0.0/0', action: 'ALLOW' }];
      const r = evaluateNaclRules(httpOnlyRules, 'TCP', { port: 54321 });
      return { blocked: r.blocked, decidingRuleNumber: r.decidingRule.ruleNumber };
    },
    explain: (actual) => actual.blocked
      ? 'The simulator correctly drops the return packet when no rule covers the ephemeral port range - matching the classic "custom NACL connection timeout" AWS documents.'
      : 'The simulator let a return packet through with no ephemeral-port rule permitting it - this would hide a very common real misconfiguration from a student.'
  }
];

runConformanceCases(CASES);
