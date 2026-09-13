// Condition evaluation: the narrow, documented subset of real AWS condition operators this
// engine supports (StringEquals, StringNotEquals, StringLike, IpAddress, Bool) - see
// IAM_ENGINE_DEVIATIONS.md §2 for what's deliberately not implemented (Numeric*, Date*, ArnEquals,
// the *IfExists / ForAllValues / ForAnyValue qualifiers, and any condition key this simulator has
// no real data source for).
import type { AuthorizationContext, ConditionBlock, ConditionOperator } from './types.ts';
import { wildcardMatch } from './glob.ts';
import { cidrContains } from '../network/cidr.ts';

export interface ConditionEvaluation {
  satisfied: boolean;
  detail: string[];
}

/** Resolves one condition key against the request context. Named keys map to their real
 *  corresponding context field (so callers write conditions the way real IAM policies do, using
 *  `aws:SourceVpc` etc. rather than reaching into internal field names); anything else falls
 *  through to a direct lookup on the context object, so a caller can still exercise an
 *  arbitrary/custom condition key in a test without this module needing to know about it ahead
 *  of time. */
function resolveContextValue(key: string, context: AuthorizationContext | undefined): unknown {
  if (!context) return undefined;
  if (key === 'aws:SourceVpc') return context.sourceVpc;
  if (key === 'aws:SourceIp') return context.sourceIp;
  if (key === 'aws:Region') return context.region;
  if (key.startsWith('aws:PrincipalTag/')) return context.principalTags?.[key.slice('aws:PrincipalTag/'.length)];
  if (key.startsWith('aws:ResourceTag/')) return context.resourceTags?.[key.slice('aws:ResourceTag/'.length)];
  return context[key];
}

function evaluateOperator(operator: ConditionOperator, actual: unknown, expected: string | string[] | boolean): boolean {
  const expectedList = Array.isArray(expected) ? expected : [expected];

  switch (operator) {
    case 'StringEquals':
      return typeof actual === 'string' && expectedList.some(v => v === actual);
    case 'StringNotEquals':
      return typeof actual === 'string' && expectedList.every(v => v !== actual);
    case 'StringLike':
      return typeof actual === 'string' && expectedList.some(v => typeof v === 'string' && wildcardMatch(v, actual));
    case 'IpAddress':
      return typeof actual === 'string' && expectedList.some(v => typeof v === 'string' && cidrContains(v, actual));
    case 'Bool': {
      const expectedBool = typeof expected === 'boolean' ? expected : expected === 'true';
      return typeof actual === 'boolean' ? actual === expectedBool : String(actual) === String(expectedBool);
    }
    default:
      return false;
  }
}

/** A statement with no `condition` block is unconditionally satisfied - the common case. When a
 *  condition block IS present, EVERY operator/key pair in it must hold (AND semantics across the
 *  whole block, matching real AWS) - a missing context value fails the condition rather than
 *  being treated as a wildcard match, since this simulator doesn't support the `...IfExists`
 *  qualifier that would be needed to make "absent" a valid pass. */
export function evaluateCondition(
  block: ConditionBlock | undefined,
  context: AuthorizationContext | undefined
): ConditionEvaluation {
  if (!block || Object.keys(block).length === 0) {
    return { satisfied: true, detail: ['No condition attached - unconditionally applies.'] };
  }

  const detail: string[] = [];
  let satisfied = true;

  for (const [operatorKey, keyMap] of Object.entries(block)) {
    const operator = operatorKey as ConditionOperator;
    for (const [contextKey, expected] of Object.entries(keyMap || {})) {
      const actual = resolveContextValue(contextKey, context);
      const ok = evaluateOperator(operator, actual, expected as string | string[] | boolean);
      detail.push(`${operator} ${contextKey} ${ok ? 'satisfied' : 'NOT satisfied'} (actual: ${JSON.stringify(actual)}, expected: ${JSON.stringify(expected)})`);
      if (!ok) satisfied = false;
    }
  }

  return { satisfied, detail };
}
