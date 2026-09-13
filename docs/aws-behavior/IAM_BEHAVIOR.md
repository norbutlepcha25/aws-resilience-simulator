# IAM_BEHAVIOR.md — Observable IAM Authorization Model

Scoped to concepts relevant to a request-path/network simulator: whether a given caller (principal) is authorized to invoke a given action against a given resource, and how that decision composes across multiple policy types. IAM Identity Center, federation providers, and directory-service integration are out of scope (per `AWS_BEHAVIOR_MODEL.md` §4).

**Standing note on current simulator status**: as documented in `docs/codebase/SERVICE_SYSTEM.md` and `REQUEST_SIMULATOR.md`, this simulator has **zero IAM modeling today** — no policy evaluation, no principal/role concept, no authorization check anywhere in `requestSimulator.ts` or elsewhere in the engine. Every rule below is therefore, as of this writing, **not implemented** in the "Simulator Requirement" sense even where the underlying AWS behavior is fully CONFIRMED. This is stated once here rather than repeated on every row; `AWS_BEHAVIOR_MATRIX.md` carries the per-rule "Simulator Requirement" column consistently as "not implemented — see IAM_BEHAVIOR.md standing note" for this file's rows.

---

## 1. Principal

The entity making a request: an IAM user, an IAM role (including one assumed by an AWS service, e.g. Lambda's execution role, EC2's instance profile role, or a federated/SSO identity), the AWS account root user, or an AWS service itself (a "service principal", e.g. `lambda.amazonaws.com`) acting on the customer's behalf under an explicit trust relationship. — CONFIRMED (*IAM User Guide — AWS JSON policy elements: Principal*).

Every authorization decision in AWS is evaluated **per-principal, per-request** — there is no ambient/inherited authorization that doesn't trace back to a specific principal making a specific call. — CONFIRMED.

## 2. Action

A specific API operation (e.g. `s3:GetObject`, `dynamodb:PutItem`, `lambda:InvokeFunction`), namespaced per service. The full authoritative list of actions per service, along with which resource types and condition keys each action supports, is published in the **AWS Service Authorization Reference** — this is the single most load-bearing source document for any IAM modeling this simulator might eventually add. — CONFIRMED (*Service Authorization Reference*, per-service pages).

Wildcards (`s3:Get*`, `*`) are permitted in the Action element of a policy statement. — CONFIRMED.

## 3. Resource

The specific AWS resource(s) an action applies to, identified by ARN (Amazon Resource Name), or `*` for actions that don't operate on a specific resource (e.g. some list/describe actions). Some services support resource-level permissions with wildcards/patterns (e.g. `arn:aws:s3:::my-bucket/*`); others require an exact ARN. Which pattern applies to which action is documented per-service in the Service Authorization Reference. — CONFIRMED.

## 4. Condition

An optional policy element that further restricts when a statement applies, evaluated against **condition keys** — either global (available on every service, e.g. `aws:SourceIp`, `aws:PrincipalOrgID`, `aws:RequestedRegion`) or service-specific (e.g. `s3:prefix`, `dynamodb:LeadingKeys`). All conditions in a statement must be true (logical AND across condition blocks) for the statement to apply; within a single condition key with multiple values, the behavior depends on the condition operator (e.g. `StringEquals` vs `StringLike` vs a `ForAllValues`/`ForAnyValue` set operator). — CONFIRMED (*IAM User Guide — IAM JSON policy elements: Condition*).

## 5. Identity-based policy

A policy attached directly to a principal (user, group, or role) that grants (or, via explicit Deny, restricts) that principal's own permissions. This is the most common policy type and the one most directly analogous to "what can this principal do." — CONFIRMED (*IAM User Guide — Identity-based policies and resource-based policies*).

## 6. Resource-based policy

A policy attached to a resource itself (e.g. an S3 bucket policy, an SQS queue policy, a Lambda function's resource policy, a KMS key policy) that specifies which principals (potentially in a **different account**, or `*` for public/anonymous) can access it. Resource-based policies are one of the two documented mechanisms for cross-account access (the other being role assumption via a trust policy, §8) — and are the only mechanism that permits access without the calling principal assuming any role at all. — CONFIRMED.

**Authorization composition**: for a same-account request, both the principal's identity-based policies AND the resource's resource-based policy (if one exists and is relevant) are evaluated, and access is granted if **either** grants it (with any explicit Deny anywhere overriding, see §9) — they are not both independently required to allow for same-account access on most services, though the precise interaction is service-specific and documented per-service ("Resources for [service]" pages in the Service Authorization Reference explicitly note whether identity-based, resource-based, or both are supported/required). — CONFIRMED as a general pattern; APPROXIMATION as a universal rule, since a handful of services (notably some KMS operations) have stricter combined-requirement behavior that should be checked per-service before being treated as CONFIRMED for that specific service.

## 7. Trust policy

A special resource-based policy attached to an IAM **role** specifically, which defines *who is allowed to assume this role* (as opposed to what the role itself can then do once assumed, which is the role's identity-based/permissions policy). A trust policy is evaluated via the `sts:AssumeRole` (or `sts:AssumeRoleWithWebIdentity`/`sts:AssumeRoleWithSAML`) action; the assuming principal must both be permitted to call `sts:AssumeRole` (by their own identity policy) **and** be named as a trusted principal in the role's trust policy — both sides are required. — CONFIRMED (*IAM User Guide — Roles terms and concepts*, explicitly distinguishes the role's trust policy from its permissions policies).

This is the mechanism behind **service roles** (e.g. a Lambda function's execution role trusts `lambda.amazonaws.com` as principal) and **cross-account role assumption** (Account B's role trusts Account A's account ID or a specific role ARN in Account A as principal). — CONFIRMED.

## 8. Role assumption

The act of a principal calling `sts:AssumeRole` (or a variant) to receive **temporary security credentials** scoped to the target role's permissions, valid for a bounded session duration (default 1 hour, configurable up to the role's maximum session duration setting, itself capped at 12 hours). — CONFIRMED (*IAM User Guide — Using IAM roles*).

While operating under an assumed role, the effective permissions are the role's own identity-based (and any attached permissions-boundary/session) policies — **not** a union with the original principal's permissions; assuming a role does not add the role's permissions on top of the caller's own, it operates as an entirely separate, temporary identity for the duration of the session. — CONFIRMED.

## 9. Explicit deny

A policy statement with `"Effect": "Deny"` that matches the request. An explicit deny **always wins**, overriding any number of Allow statements from any policy type (identity-based, resource-based, permissions boundary, SCP, session policy) attached anywhere relevant to the request. There is no mechanism to override an explicit deny except modifying or removing the deny statement itself. — CONFIRMED (*IAM User Guide — Policy evaluation logic*, this is the single most load-bearing rule in the entire IAM evaluation model and is stated unambiguously).

## 10. Implicit deny

The **default** outcome for any request that no applicable policy explicitly allows — IAM is default-deny; absence of an Allow is equivalent to a deny, distinct from (and lower-precedence than) an *explicit* Deny statement, but functionally the same end result (access refused) unless some other applicable statement later in evaluation explicitly allows it. — CONFIRMED.

## 11. Permissions boundary

An advanced identity-based-policy-like construct attached to a **user or role** (not directly to an action) that sets the **maximum** permissions that principal's own identity policies can grant — it does not itself grant any permissions; it only caps them. Effective permissions for a principal with a permissions boundary are the **intersection** of (their identity-based policies) and (their permissions boundary) — both must allow for the action to succeed. — CONFIRMED (*IAM User Guide — Permissions boundaries for IAM entities*).

## 12. Session policy

An inline policy passed as a parameter at the time of `sts:AssumeRole` (or similar) that further restricts (never expands) the permissions of that specific temporary session, on top of the role's own identity-based policies — effective session permissions are the **intersection** of the role's policies and the session policy, same composition pattern as a permissions boundary but scoped to a single temporary session rather than a persistent principal. — CONFIRMED (*IAM User Guide — Session policies*).

## 13. Service Control Policy (SCP)

An AWS Organizations-level policy attached to an OU or account that sets the **maximum available permissions** for every principal in every account it applies to — like a permissions boundary, an SCP never itself grants permissions, it only caps what identity/resource-based policies within the affected accounts can allow. Effective permissions in an org-managed account under an SCP are the intersection of (SCP) ∩ (identity-based policy) ∩ (resource-based policy, if applicable) ∩ (any permissions boundary) ∩ (any session policy). An SCP applies account-wide, including to that account's root user. — CONFIRMED (*AWS Organizations User Guide — Service control policies*).

## 14. Cross-account authorization

Two documented mechanisms, and only these two:

1. **Resource-based policy** on the target resource explicitly names the other account (or a specific principal within it) — no role assumption needed; the calling principal uses their own (Account A) credentials directly against the Account B resource. — CONFIRMED.
2. **Role assumption**: a role in Account B has a trust policy naming Account A (or a specific principal in it); a principal in Account A calls `sts:AssumeRole` against that role ARN, and — provided their own identity policy in Account A permits the `sts:AssumeRole` call — receives temporary Account-B-scoped credentials. — CONFIRMED.

There is no third mechanism — cross-account access is always one of these two, and both are subject to every other composition rule above (explicit deny anywhere wins, SCPs in either account's org hierarchy can further restrict, etc.). — CONFIRMED.

---

## 15. Full evaluation order (composite rule, the single most important fact in this file)

For a request in an AWS Organizations-managed account, the documented evaluation order is:

1. If **any** applicable SCP does not explicitly allow the action → **implicit deny**, evaluation stops (SCPs are a ceiling, not a grant).
2. If any applicable **resource-based policy** explicitly denies → **explicit deny**, stops.
3. If any applicable **identity-based policy** explicitly denies → **explicit deny**, stops.
4. If a **permissions boundary** applies and does not explicitly allow → **implicit deny**, stops.
5. If a **session policy** applies and does not explicitly allow → **implicit deny**, stops.
6. If any applicable **resource-based policy** explicitly allows (and the request is same-account, or the resource-based policy itself is sufficient for cross-account per §14.1) → **allow**.
7. If any applicable **identity-based policy** explicitly allows → **allow**.
8. Otherwise → **implicit deny** (default).

— CONFIRMED (*IAM User Guide — Policy evaluation logic*, which publishes this exact ordered flowchart). This is the rule any future IAM-authorization simulation feature in this app would need to implement faithfully to be a CONFIRMED-accurate model rather than an approximation — a simplified "does any policy say allow" check without this precedence (deny-anywhere-wins, boundaries/SCPs as ceilings not grants) would misrepresent real AWS behavior for a large fraction of realistic multi-policy scenarios.

## 16. Simulator relevance note

None of the 28 currently-simulated services in this app (`docs/codebase/SERVICE_SYSTEM.md` §3.1) have any IAM-authorization check in `requestSimulator.ts` today — a request in this simulator can reach any reachable node regardless of any notion of "permission." If IAM modeling is added in the future, §15's evaluation order is the CONFIRMED target behavior; a naive single-policy-lookup implementation would be a known, documented APPROXIMATION relative to real AWS and should be labeled as such rather than presented as equivalent.
