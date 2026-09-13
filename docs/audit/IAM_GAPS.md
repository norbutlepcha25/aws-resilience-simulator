# IAM_GAPS.md

Explicit audit: does the application implement roles, trust policies, identity policies, resource policies, explicit deny, implicit deny, conditions, resource matching, action matching, role assumption? Per the task instruction, **metadata is not assumed to imply behavior** — every finding below was checked against actual executable logic (`requestSimulator.ts`, `ArchitectureContext.tsx`, `rulesEngine.ts`), not against catalog text, node labels, or UI copy.

## Method

Searched the full `src/` tree for every IAM-adjacent identifier (`iam`, `role`, `trust polic*`, `identity polic*`, `resource polic*`, `explicit deny`, `principal`, `permission boundary`, `sts:AssumeRole`, condition-key patterns) and inspected every hit for whether it drives simulation behavior or is inert text/data.

## Findings

### Roles

- **Found**: `serviceCatalog.ts` has a catalog entry `iam` ("AWS IAM") and `iam_identity_center`; the "Serverless Image Thumbnail Generator" reference template (`referenceArchitectures.ts` lines ~2830-2942) includes a literal `node-iam` node with a connecting edge explicitly labeled `'IAM Execution Role'` and template narrative text describing "an IAM Execution Role granting Lambda `s3:GetObject`... and `AWSLambdaVPCAccessExecutionRole`."
- **Behavior check**: `iam` is **not** among the 28 behaviorally-referenced service ids (`docs/codebase/SERVICE_SYSTEM.md` §3.1). `requestSimulator.ts` has no branch, check, or reference to `serviceId === 'iam'` anywhere. The `node-iam` node and its edge are rendered on the canvas and pass through the simulation loop exactly like any other Category-C metadata-only service node — inert, contributing nothing to the traversal, success/failure determination, or any authorization decision.
- **Concrete proof this is decorative, not functional**: deleting `node-iam` and its edge from the Thumbnail Generator template would not change `runSimulation`'s output for that template at all — no code path reads that node's existence, health, or any field on it.
- **Verdict: roles are present as a labeled diagram node, absent as a mechanism.** A student could reasonably believe this simulator validates whether Lambda has appropriate role permissions to read/write the S3 buckets it's drawn connected to — it does not check this in any way.

**Severity: CRITICAL | Status: MISSING** (the specific risk here is elevated from HIGH to CRITICAL precisely because the metadata creates a false impression of coverage that a purely absent feature would not — this is the exact trap the audit brief warned against)

### Trust policies

- **Found**: nothing. No node type, data field, or check anywhere represents "who is allowed to assume this role."
- **Verdict**: fully absent, no misleading metadata either (unlike Roles above, there's no trust-policy-shaped UI element at all to create a false impression).

**Severity: HIGH | Status: MISSING**

### Identity policies

- **Found**: nothing. No `AWSService` field, node data field, or simulation check represents "what can this principal do."
- **Verdict**: fully absent.

**Severity: HIGH | Status: MISSING**

### Resource policies

- **Found**: nothing distinct from Identity policies above — no bucket-policy/queue-policy/endpoint-policy equivalent anywhere, despite `docs/aws-behavior/NETWORKING_BEHAVIOR.md` §11 confirming both Gateway and Interface VPC Endpoints support an optional resource-based endpoint policy in real AWS.
- **Verdict**: fully absent.

**Severity: MEDIUM | Status: MISSING** (lower than Identity/Trust policies because resource policies are a secondary/optional authorization layer in real AWS even when present, not the primary mechanism)

### Explicit deny

- **Found**: the string "explicit DENY" appears multiple times in the codebase (`ServiceInspector.tsx`, `BoundaryNode.tsx`, `networkFirewalls.ts`, `referenceArchitectures.ts`) — **every single occurrence refers to a Network ACL rule's DENY action**, a real and correctly-implemented concept (see `NETWORKING_GAPS.md` — NACL). **None refers to an IAM policy's explicit-deny precedence rule** (`docs/aws-behavior/IAM_BEHAVIOR.md` §9, §15) — the concept that an IAM Deny statement overrides every Allow from any policy source.
- **Verdict**: the *words* "explicit deny" exist in the codebase exclusively in a correct, different, non-IAM context. **IAM's specific explicit-deny-always-wins precedence rule is not implemented anywhere.**

**Severity: HIGH | Status: MISSING** (with the caveat that this is a case where a naive keyword grep could produce a false CORRECT finding — flagged explicitly to prevent that error)

### Implicit deny

- **Found**: nothing. There is no concept of "no policy allows this, therefore deny" anywhere in the simulation loop — the closest analogue, the NACL matcher's "no rule matched" case, currently does the **opposite** (permits by default — see `NETWORKING_GAPS.md` §NACL, a separate CRITICAL finding in its own right, structurally similar in shape to what IAM's implicit-deny gap would look like if IAM were implemented the same permissive way).
- **Verdict**: fully absent from an IAM perspective (there is no IAM decision to default-deny in the first place).

**Severity: HIGH | Status: MISSING**

### Conditions

- **Found**: nothing — no condition-key concept (`aws:SourceIp`, `aws:PrincipalOrgID`, service-specific keys) exists anywhere.
- **Verdict**: fully absent.

**Severity: MEDIUM | Status: MISSING** (conditions are a refinement on top of a base policy-evaluation model that doesn't exist yet — this gap is downstream of, and lower-priority than, having any policy evaluation at all)

### Resource matching

- **Found**: nothing — no ARN concept, no resource-pattern matching (`arn:aws:s3:::bucket/*` style) anywhere. The closest analogue is the simulator's node-id-based edge/target resolution, which is a graph-traversal concept, not an authorization-resource-matching concept.
- **Verdict**: fully absent.

**Severity: MEDIUM | Status: MISSING**

### Action matching

- **Found**: nothing — no `service:Action` string concept (`s3:GetObject`, `dynamodb:PutItem`) exists; the simulator's `protocol` field (`HTTP`, `SQL`, `Event`, etc.) is a network-protocol concept, not an IAM-action concept, and the two are never conflated in the code (a small positive finding — at least the simulator doesn't mislabel protocol-matching as IAM-action-matching).
- **Verdict**: fully absent.

**Severity: MEDIUM | Status: MISSING**

### Role assumption

- **Found**: nothing — no `sts:AssumeRole` concept, no temporary-credential concept, no session concept.
- **Verdict**: fully absent.

**Severity: HIGH | Status: MISSING**

## Composite finding: does anything in the simulator behave as if IAM authorization matters?

**No.** Cross-checked against `docs/codebase/REQUEST_SIMULATOR.md`'s full behavior-block inventory (BEHAVIOR 1 through 7C plus the post-loop check) — none of the ~10 distinct gating checks in `runSimulation` reference any IAM-shaped concept. A request from any node to any other connected node succeeds or fails based **exclusively** on: network placement (subnet/IGW/NAT), health status, firewall configuration (NACL/SG), and a small number of service-specific capacity/health rules (auto-scaling, ALB target health, DB Multi-AZ). **An architecture with a Lambda function whose execution role grants it access to every S3 bucket in the account, and an otherwise-identical architecture where that same Lambda's role grants it nothing at all, simulate identically in every respect** — this is the single clearest way to state the scope of this gap.

**Severity: CRITICAL | Status: MISSING** (composite)

## What is and is not appropriate to prioritize

This audit does **not** recommend treating "implement full IAM" as a single refactor item — the scope (14 concepts, an 8-step evaluation order per `docs/aws-behavior/IAM_BEHAVIOR.md` §15) is large enough to warrant its own dedicated planning phase, not a bullet in this refactor plan. What this audit **does** recommend for `PRIORITIZED_REFACTOR_PLAN.md`:

1. Immediate, low-cost fix: either remove the `node-iam` decorative node/edge from the Thumbnail Generator template, or add a one-line disclaimer in its `learningOutcome` text clarifying that the IAM role shown is illustrative and not enforced by the simulation — closing the "metadata implies behavior" gap cheaply without committing to full IAM modeling.
2. Longer-term: IAM modeling is a legitimate, large future scope expansion, not a bug fix — it should be scoped and planned separately once the current conditional-chain architecture (`SIMULATION_GAPS.md`) is refactored into service-behavior adapters, since bolting an 8-step policy evaluator onto the current monolithic function would compound the existing architectural problem rather than fix it.
