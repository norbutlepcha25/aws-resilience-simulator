// Domain types for the IAM behavioral engine (Phase 6 of
// docs/target-architecture/MIGRATION_PLAN.md - see IAM_ENGINE.md for the original design).
// This is a standalone, deterministic evaluator: it is NOT wired into the live per-hop request
// simulator (see IAM_ENGINE_DEVIATIONS.md for exactly why and what would be required to do so).
// It exists to answer, precisely and explainably, the question real AWS answers on every API
// call: given a Principal, an Action, a Resource, and a Context, is this call allowed - and NOT
// the shallow "does this role's permission list contain this string" check this task explicitly
// asked NOT to build.

export type PrincipalKind = 'user' | 'role' | 'service' | 'account';

export type ConditionOperator = 'StringEquals' | 'StringNotEquals' | 'StringLike' | 'IpAddress' | 'Bool';

/** A condition block, keyed by operator then by condition key - e.g.
 *  `{ StringEquals: { 'aws:PrincipalTag/team': 'payments' }, IpAddress: { 'aws:SourceIp': '10.0.0.0/16' } }`.
 *  Only the operators listed in `ConditionOperator` are supported - see
 *  IAM_ENGINE_DEVIATIONS.md §2 for the full list of real AWS operators NOT implemented (Numeric*,
 *  Date*, ArnEquals, the `...IfExists` and `ForAllValues`/`ForAnyValue` qualifiers, etc). */
export type ConditionBlock = Partial<Record<ConditionOperator, Record<string, string | string[] | boolean>>>;

export interface PolicyStatement {
  sid?: string;
  effect: 'Allow' | 'Deny';
  /** Action patterns this statement covers, e.g. ['s3:GetObject', 's3:Put*']. Unused (empty) on a
   *  trust-policy statement, which instead uses `principals` - see roleAssumption.ts. */
  actions: string[];
  /** Resource ARN patterns, e.g. ['arn:aws:s3:::my-bucket/*']. Unused on a trust-policy statement. */
  resources: string[];
  /** Trust-policy-only: which principals (by Principal.id, Principal.accountId, or '*') may
   *  assume the role this statement is attached to. Ignored by ordinary identity/resource/scp/
   *  boundary/session policy evaluation. */
  principals?: string[];
  condition?: ConditionBlock;
}

export type PolicyKind = 'identity' | 'resource' | 'trust' | 'scp' | 'boundary' | 'session';

export interface Policy {
  id: string;
  kind: PolicyKind;
  statements: PolicyStatement[];
}

export interface Principal {
  id: string;
  kind: PrincipalKind;
  /** Single-account model unless a caller explicitly assigns different account ids to different
   *  principals to exercise a cross-account scenario - see IAM_ENGINE_DEVIATIONS.md §3. */
  accountId: string;
  /** Accepted for forward-compatibility with tag-based conditions, but never derived from canvas
   *  data - the simulator has no per-node tagging model today. See IAM_ENGINE_DEVIATIONS.md §1. */
  tags?: Record<string, string>;
  /** Required (by convention, not enforced) when kind === 'role' - who may assume this role. */
  trustPolicy?: Policy;
  identityPolicies: Policy[];
  permissionsBoundary?: Policy;
  /** Present only on a temporary session principal produced by `assumeRole()` when the caller
   *  supplied one - an inline policy that further restricts (never expands) what the session may
   *  do, exactly like a real STS session policy. */
  sessionPolicy?: Policy;
}

export interface ResourceRef {
  arn: string;
  accountId: string;
  tags?: Record<string, string>;
  resourcePolicy?: Policy;
}

export interface AuthorizationContext {
  /** Which VPC boundary the requesting resource's canvas node actually sits inside - genuine,
   *  derivable canvas data (see containment.ts), unlike sourceIp/region below. */
  sourceVpc?: string;
  /** Not derived from canvas data (no real per-node IP model exists - see the Networking engine's
   *  own NETWORK_ENGINE_DEVIATIONS.md §1). Accepted only so a caller can exercise an IpAddress
   *  condition directly against hand-supplied test data. */
  sourceIp?: string;
  /** Not modeled anywhere on canvas data today; accepted for extensibility only. */
  region?: string;
  principalTags?: Record<string, string>;
  resourceTags?: Record<string, string>;
  /** Any other `aws:*`-style condition key a caller wants to test directly - resolved as a
   *  plain passthrough lookup by conditions.ts when not one of the named keys above. */
  [key: string]: unknown;
}

export interface AuthorizationRequest {
  principal: Principal;
  action: string;
  resource: ResourceRef;
  context?: AuthorizationContext;
  /** Service Control Policies applicable to the principal's account - modeled as a flat list
   *  (a single effective SCP set), not an Organizational-Unit hierarchy - see
   *  IAM_ENGINE_DEVIATIONS.md §4. */
  organizationPolicies?: Policy[];
}

export interface StatementMatch {
  policy: Policy;
  statement: PolicyStatement;
  conditionSatisfied: boolean;
  conditionDetail: string[];
}

export type IamEvaluationStage =
  | 'authenticate'
  | 'resolve-identity'
  | 'resolve-resource'
  | 'explicit-deny'
  | 'evaluate-allow'
  | 'evaluate-boundary'
  | 'evaluate-scp'
  | 'evaluate-conditions'
  | 'final';

export interface IamTraceStep {
  stage: IamEvaluationStage;
  outcome: 'ok' | 'allow' | 'deny' | 'none' | 'n/a' | 'satisfied';
  detail: string;
}

export interface AuthorizationDecision {
  effect: 'Allow' | 'Deny';
  principal: string;
  action: string;
  resource: string;
  /** ids of every policy actually in scope for this request (identity + resource + boundary +
   *  session + SCP), regardless of whether any of its statements matched. */
  policiesConsidered: string[];
  /** Every statement that matched action + resource (across whichever stage decided the
   *  outcome) - the "why" behind the final effect. */
  matchedStatements: StatementMatch[];
  explicitDeny: StatementMatch | null;
  finalReason: string;
  steps: IamTraceStep[];
}
