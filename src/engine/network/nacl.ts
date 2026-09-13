// Generic Network ACL rule evaluator: first-match, ascending rule-number order, implicit final
// DENY (rule 32767) - the exact semantics real AWS NACLs use. This is the same matching logic
// `networkFirewalls.ts` already implemented inline; it is extracted here so it has one
// independently-testable definition, and `networkFirewalls.ts` now calls this module instead of
// duplicating the match rules. Behavior is unchanged - see test/network-engine.test.ts and the
// existing NACL tests in test/engine.test.ts (31, 32, 40, 43, 44), which must all still pass.
import type { NaclRule } from '../../types/index.ts';
import { cidrsOverlap } from './cidr.ts';
import { parsePortRange, portInRange } from './cidr.ts';

export interface NaclRuleEvaluation {
  rule: NaclRule;
  matched: boolean;
  why: string;
}

export interface NaclEvaluation {
  blocked: boolean;
  /** The rule that decided the outcome - a real configured rule, or a synthetic representation
   *  of AWS's immutable final rule 32767 when nothing else matched. */
  decidingRule: NaclRule;
  reason: string;
  /** Every configured rule that was checked, in evaluation order, each explaining why it did or
   *  didn't match - the "why alternative routes/rules were not selected" explainability the
   *  simulator now surfaces for NACLs, not just routes. */
  evaluatedRules: NaclRuleEvaluation[];
}

const IMPLICIT_DENY_RULE: NaclRule = {
  ruleNumber: 32767,
  type: 'ALL TRAFFIC',
  protocol: 'ALL',
  portRange: 'All',
  cidr: '0.0.0.0/0',
  action: 'DENY'
};

function ruleMatchesProtocol(rule: NaclRule, protocol: string): boolean {
  const p = protocol.toLowerCase();
  return (
    rule.type.toLowerCase().includes(p) ||
    (protocol === 'SQL' && (rule.portRange.includes('3306') || rule.type.includes('MySQL'))) ||
    (protocol === 'HTTP' && (rule.portRange.includes('80') || rule.type.includes('HTTP'))) ||
    (protocol === 'HTTPS' && (rule.portRange.includes('443') || rule.type.includes('HTTPS'))) ||
    rule.portRange === 'All'
  );
}

function ruleMatchesPort(rule: NaclRule, port?: number): boolean {
  if (port === undefined) return true;
  return portInRange(port, parsePortRange(rule.portRange));
}

function ruleMatchesSource(rule: NaclRule, sourceCidr?: string): boolean {
  if (!sourceCidr) return true; // source not modeled for this call site - match on protocol/port only
  return cidrsOverlap(rule.cidr, sourceCidr);
}

/**
 * Evaluates one ordered list of NACL rules (a subnet's inbound OR outbound rules - the caller
 * picks which) against one packet's protocol/port/source. Rules are sorted ascending by
 * `ruleNumber` and the first match wins, exactly like real AWS; if nothing matches, the implicit
 * final DENY (rule 32767) applies - NACLs deny by default, they never fail open.
 */
export function evaluateNaclRules(
  rules: NaclRule[],
  protocol: string,
  opts?: { port?: number; sourceCidr?: string }
): NaclEvaluation {
  const sorted = [...rules].sort((a, b) => a.ruleNumber - b.ruleNumber);
  const evaluatedRules: NaclRuleEvaluation[] = [];

  for (const rule of sorted) {
    const protocolMatch = ruleMatchesProtocol(rule, protocol);
    const portMatch = ruleMatchesPort(rule, opts?.port);
    const sourceMatch = ruleMatchesSource(rule, opts?.sourceCidr);
    const matched = protocolMatch && portMatch && sourceMatch;

    evaluatedRules.push({
      rule,
      matched,
      why: matched
        ? `Rule ${rule.ruleNumber} matches ${protocol} traffic (${rule.cidr}, port ${rule.portRange}) - first match wins, evaluation stops here.`
        : !protocolMatch
          ? `Rule ${rule.ruleNumber} does not match protocol ${protocol}.`
          : !portMatch
            ? `Rule ${rule.ruleNumber} does not cover the requested port.`
            : `Rule ${rule.ruleNumber} does not cover source ${opts?.sourceCidr}.`
    });

    if (matched) {
      return {
        blocked: rule.action === 'DENY',
        decidingRule: rule,
        reason: rule.action === 'DENY'
          ? `Rule ${rule.ruleNumber} explicitly DENIES this traffic.`
          : `Rule ${rule.ruleNumber} explicitly ALLOWS this traffic.`,
        evaluatedRules
      };
    }
  }

  // No configured rule matched - AWS's immutable final rule 32767 denies everything.
  evaluatedRules.push({
    rule: IMPLICIT_DENY_RULE,
    matched: true,
    why: 'No earlier rule matched, so the implicit final DENY (rule 32767, matches all traffic) applies. NACLs deny by default.'
  });

  return {
    blocked: true,
    decidingRule: IMPLICIT_DENY_RULE,
    reason: 'No explicit rule matched; the implicit final DENY (rule 32767) applies.',
    evaluatedRules
  };
}
