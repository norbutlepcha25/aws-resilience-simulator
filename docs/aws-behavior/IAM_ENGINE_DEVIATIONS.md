# IAM Engine: Documented Deviations from Real AWS

Companion to `docs/target-architecture/IAM_ENGINE.md` (design) and `src/engine/iam/`
(implementation - Phase 6 of `docs/target-architecture/MIGRATION_PLAN.md`). Every simplification
relative to real, documented IAM behavior (`docs/aws-behavior/IAM_BEHAVIOR.md`) is listed here, per
this implementation's own completion criteria.

## 0. Not wired into the live request simulator

Like the Phase 5 Networking engine, this is a standalone, deterministic module
(`evaluateAuthorization()`, `assumeRole()`) - `requestSimulator.ts` does not call it. Wiring it in
would require: (a) a canvas way to author policies per node (no such UI exists), and (b) a product
decision about what an IAM node's edge into a resource even means for traversal (does an unauthorized
call fail the whole request, or just skip a step?). Per `IAM_GAPS.md`'s original finding and
`MIGRATION_PLAN.md` Phase 5's own gating, that wiring is deliberately left for a future, explicitly
requested pass with its own scoping conversation - this phase delivers the engine itself, fully
tested in isolation, exactly as the Phase 5 Networking engine did for routing/NACL/SG.

## 1. Tags are accepted, never derived from canvas data

`Principal.tags` / `ResourceRef.tags` / `AuthorizationContext.principalTags` /
`.resourceTags` exist on the types and are fully evaluable by `StringEquals`/`StringNotEquals`/
`StringLike` conditions (test I9), but nothing in the simulator's existing data model
(`ServiceNodeData`, `AWSService`) has a tagging concept - there is no UI to tag a node. Every test
that exercises a tag condition constructs the tag data by hand; a live wiring would need to add a
real tagging feature to the canvas first.

## 2. Condition operators: only five implemented

`ConditionOperator` supports `StringEquals`, `StringNotEquals`, `StringLike`, `IpAddress`, `Bool`.
Real AWS IAM additionally supports (not implemented here): `NumericEquals`/`NumericLessThan`/etc.,
`DateEquals`/`DateGreaterThan`/etc., `ArnEquals`/`ArnLike`, `Null`, the `...IfExists` qualifier
suffix on any operator, and the `ForAllValues:`/`ForAnyValue:` set-operation qualifiers for
multi-valued context keys. A missing context value fails a condition outright in this engine
(`conditions.ts`), which is the correct behavior for a plain operator but would be wrong for an
`...IfExists` variant - since that qualifier isn't implemented, no test relies on the
"key absent = pass" semantics it would require.

## 3. Single-account model by default; cross-account is opt-in via explicit data

There is no organizational/account hierarchy anywhere in this codebase. `Principal.accountId` and
`ResourceRef.accountId` default implicitly to the same value in every existing helper, but nothing
stops a caller from assigning two different account ids by hand when constructing `Principal`/
`ResourceRef` objects directly - which is exactly how the cross-account trust (I18) and
cross-account resource-policy (I19) tests exercise real cross-account behavior. This mirrors how
the Networking engine's `RouteTable` is a fully real module not yet driven by canvas UI: the
capability is genuine, the data feeding it today is hand-authored rather than canvas-derived.

## 4. Service Control Policies: flat list, not an OU hierarchy

`AuthorizationRequest.organizationPolicies` is a flat array - "every SCP that applies to this
account" - rather than a real AWS Organizations tree (Root → OU → OU → Account) where policies
inherit down the tree and a full SCP evaluation must walk every level. This engine still gets the
one behaviorally-important fact right - an SCP is a ceiling, evaluated the same way a permissions
boundary is (`evaluate.ts`'s `evaluate-scp` stage; test I17) - but does not model policy
inheritance or attachment points within an OU tree.

## 5. Resource ARNs are opaque strings, not structured/parsed ARNs

Real ARNs have a structured grammar (`arn:partition:service:region:account:resource-type/resource-id`)
and IAM can match on individual segments. `resourceMatch.ts` treats the whole ARN as one string
matched via glob (`*`/`?`) - sufficient for every documented example and test (`arn:aws:s3:::bucket/*`),
but it cannot express, say, "any region except us-east-1" the way a real policy could combine
`ArnLike` with `StringNotEquals` on a parsed region segment.

## 6. Trust-policy principal matching is by id/account only

`roleAssumption.ts`'s trust-policy statements list plain strings in `principals` (a Principal's
`id`, its `accountId`, or `'*'`). Real AWS trust policies can reference an IAM user/role ARN, an
AWS service principal (`ec2.amazonaws.com`), a federated identity provider, or `"AWS": "*"` with
further conditions - this engine's model is deliberately narrower, covering exactly the two cases
its own tests need (a named principal id, and a named account id for cross-account trust) plus the
service-principal case used by the worked Lambda example (I13), where the "principal" is simply the
string `lambda.amazonaws.com` matched like any other id.

## 7. What is genuinely real and tested here (not an approximation)

- The full 8-ish-stage evaluation order given in the Phase 6 task brief: authenticate → resolve
  identity policies → resolve resource policies → explicit deny → allow → boundary → SCP →
  conditions → final. Every stage produces a real trace entry (`IamTraceStep`), not a placeholder.
- Explicit deny always wins, checked across every policy kind that can carry one (identity,
  resource, SCP, boundary, session) - not just identity policies.
- A resource policy can grant access on its own, with zero identity-policy involvement (test I5),
  matching real S3-bucket-policy / cross-account-resource-policy behavior.
- Role assumption correctly swaps the effective principal's permissions to the ROLE's own policies,
  never the caller's (test I13) - the one behavior the task's own worked example depends on.
- Permissions boundaries and Service Control Policies are both modeled as ceilings that can only
  restrict, never grant (tests I15, I16, I17) - a boundary/SCP with no restriction at all still
  grants nothing by itself.
