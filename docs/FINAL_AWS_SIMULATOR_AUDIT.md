# Final AWS Simulator Audit

**Scope:** the whole application as it exists today, across all 14 implementation phases in this
repository's history. **Method:** every claim below was checked against the actual source in this
working tree and/or a real, currently-passing test - not recalled from a design doc. Where a
number appears, it was computed by running the code (`node --experimental-strip-types`) during
this audit, not estimated. Three checks in particular were run fresh, live, for this report:

1. `npm test` (unit + conformance) and `npm run test:ui` - **298/298 tests pass** (185 unit +
   106 conformance + 7 UI integration), plus `npx tsc --noEmit` and `npm run build` both clean.
2. The Phase 14 capability registry (`engine/capability/`) was queried directly for real per-service
   classification counts across all 327 catalog services (not hand-estimated).
3. A direct, targeted script proved a genuine, previously-undocumented defect (see Critical Issue
   #1): the live `runSimulation` engine has **zero IAM awareness** - a request that both the
   validation engine and the trace engine correctly flag as an IAM denial still simulates as
   `success: true, statusCode: 200`.

---

## Executive Summary

This simulator is a genuinely strong **networking and request-topology** teaching tool, a
**structurally sound but only partially-connected** IAM/failure/analysis platform, and a
**narrow, honestly-labeled** service behavior simulator (9 of 327 catalog services reach full,
test-proven behavioral fidelity; the Phase 14 capability registry itself enforces this honesty
mechanically).

The single most important finding in this audit is architectural, not cosmetic: **the live
request simulation a student actually runs (Send Request / Task Flow) and the newer
explainability/validation layers built on top of it (Phases 10-11) are not the same system.**
`runSimulation` (the only user-reachable pass/fail engine) evaluates network reachability,
subnet placement, target health, and load-balancer target selection - but it was never taught
about IAM, because IAM was added three phases later as an *additive* layer (`engine/validation`,
`engine/trace`) that reads the *same graph* independently, after the fact. The practical
consequence: a Lambda function with no execution role calling S3 will report `HTTP 200 SUCCESS`
in the primary Send Request result, while the separate "AWS Explanation" trace and the separate
Analyze tab both correctly say IAM would deny it. A student trusting only the headline result
will learn the wrong lesson. This is fixable (the pieces all exist and are already correct
individually), but it is not fixed today, and it is the reason the IAM confidence rating below is
capped where it is regardless of how correct the underlying IAM policy engine is in isolation.

Beyond that, the application is honest by construction in the one place that matters most: the
Phase 14 capability registry cannot mark a service "fully simulated" without a named, currently-
passing test as evidence, and this audit confirms it actually enforces that (`test/service-
capability-registry.test.ts`, tests 2, 9, 10) - a real, structural defense against the exact kind
of overclaiming this audit was asked to catch.

---

## 1. Architecture Model

`src/context/ArchitectureContext.tsx` (~1,350 lines) is the single source of truth: `nodes`/`edges`
(React Flow state), fed by `addServiceNode`/`updateNodeData`/`onConnect` from the canvas and
Service Inspector. Every downstream engine (`analysis`, `validation`, `failure`, `trace`, `cost`)
reads from this same state via `useMemo`, and nothing in `src/components/` computes AWS semantics
itself - confirmed directly (`test/ui/ui-integration.test.ts` test 7 asserts this structurally,
and a manual read of every component under `src/components/` during Phase 13 found no AWS-rule
logic embedded in JSX). **Verdict: sound.** The one architectural wrinkle - two independent
failure-injection paths (`setNodeHealth`/`toggleNodeFailure`, a blunt direct mutation; and
`injectFailure`, the structured Phase 9 engine with propagation reasoning) - is real but is a
UI-completeness gap (§12), not a model-integrity problem: both paths write into the same `nodes`
state and both are read correctly by `runSimulation`.

## 2. Networking

The strongest subsystem in the application. `engine/network/{cidr,nacl,securityGroup,routeTable,
nat}.ts` are small, focused, independently tested modules (`test/network-engine.test.ts`, 24
tests; `tests/aws-conformance/networking/`, 30 tests across CIDR/overlap/routing/SG/NACL/subnet-
endpoint behavior). Verified facts, not assumptions:

- NACL implicit final deny (rule 32767) is present and correct (`network/nacl.ts:29-115`,
  `test/network-engine.test.ts` N12, `tests/aws-conformance/networking/nacl.test.ts` NET-NACL-
  IMPLICIT-DENY-001). This was a documented CRITICAL bug in the pre-existing
  `docs/audit/AWS_CONFORMANCE_AUDIT.md` (stale, pre-refactor) - confirmed fixed, not merely
  claimed fixed (see `tests/aws-conformance/REGRESSION_AUDIT.md`, written during Phase 12).
- Longest-prefix-match route resolution is real (`network/routeTable.ts`), correctly prefers a
  more specific route over a broader one regardless of array order
  (`tests/aws-conformance/networking/routing.test.ts` NET-ROUTE-002).
- Security Group semantics are real: allow-list only, stateful (established connections bypass
  rule matching), CIDR *and* Security-Group-reference sources both work
  (`tests/aws-conformance/networking/security-groups.test.ts`, 7 tests).
- **Known gap, disclosed:** "public/private subnet" is a user-chosen label on a boundary node
  geometrically containing a service node (`layout/containment.ts`), not derived from an actual
  attached `RouteTable`'s contents the way real AWS derives it. `network/routeTable.ts` exists
  and is correct when a `RouteTable` is explicitly constructed and passed to it, but nothing in
  the live canvas UI ever constructs one - route resolution in the live app is a subnet-adjacency
  heuristic, not a real route table evaluation. Every conformance test in this audit that exercises
  `resolveRoute()` does so with a hand-built `RouteTable`, not one derived from canvas state.

## 3. Routing

Covered above; the one clarification worth its own line: `resolveRoute()`'s longest-prefix-match
engine is real and tested, but it is **not in the live request path** - `runSimulation` never
calls it. The live app's actual route decision is `networkPathAdapter`'s hand-written subnet/VPC-
adjacency logic (`engine/simulation/adapters/networkPath.ts`). Both are individually correct for
what they model; they are two different mechanisms, and only the weaker one is live.

## 4. Security Groups

Real, live, tested. `checkNetworkFirewalls()` (`networkFirewalls.ts`) is called from
`requestSimulator.ts` on every hop that can be gated, delegates to `evaluateSecurityGroup()` for
actual rule evaluation, and correctly supports both the legacy `allowedProtocols` shorthand and the
full `securityGroupRules` shape (protocol + port + CIDR-or-peer-SG). Stateful/allow-list/reference
semantics are all correct and tested (§2). **One real, disclosed approximation:** source IP/CIDR is
never derived from actual node placement (`NETWORK_ENGINE_DEVIATIONS.md`) - a CIDR-based SG rule is
evaluated on protocol+port only, never against a genuine source address, so a rule scoped to a
specific narrow CIDR will behave identically to one scoped to `0.0.0.0/0` in this simulator. This
is exactly why Phase 10's public-exposure detector treats a `0.0.0.0/0` SG rule as an architectural
red flag rather than a live simulation determinant - the simulator cannot actually tell the
difference between "open to the world" and "open to 10.0.1.0/24" for live traffic purposes.

## 5. NACL

Covered in depth in §2. Additionally: NACL statelessness is correctly modeled as two entirely
independent rule evaluations (inbound vs. outbound), and the classic "custom NACL missing an
ephemeral-port return rule causes a connection timeout" scenario is modeled end-to-end, including
the specific 504 status code and a dedicated post-loop return-path check
(`requestSimulator.ts:238-290`, `checkCustomNaclReturn()`). This is one of the most AWS-accurate,
specific pieces of behavior in the whole application.

## 6. IAM

The IAM *policy engine* itself (`engine/iam/`) is genuinely excellent and is the most rigorously
tested single engine in the repository: real 8-stage evaluation order (authenticate → identity →
resource → explicit-deny → allow → boundary → SCP → conditions → final), explicit-deny-always-wins,
wildcard actions/resources, condition blocks, role trust and `AssumeRole` identity-swap semantics,
permissions boundaries, and SCPs as an org-wide ceiling - all real, all tested
(`test/iam-engine.test.ts`, 21 tests; `tests/aws-conformance/iam/`, 19 tests covering every item on
Phase 12's own IAM checklist: implicit deny, explicit deny, identity allow, resource allow,
wildcard actions, wildcard resources, conditions, role trust, role assumption, boundaries, SCP).

**But** (see Executive Summary and Critical Issue #1): **this engine is not wired into the live
request simulation.** It is reachable from two places - `engine/validation/iam.ts` (static,
whole-canvas findings shown in the Analyze modal) and `engine/trace/explainHop.ts` (the "AWS
Explanation" trace shown after a Send Request) - both of which are additive, read-only overlays on
top of a `runSimulation` result that was already computed with zero IAM knowledge. The
`ServiceNodeData.iamRole` field (Phase 10) has no canvas UI to author it at all - it can only be
set programmatically (tests do this directly). A student cannot currently attach a role to a
Lambda function through the UI, and even if they could, doing so would not change whether Send
Request succeeds or fails.

## 7. Service Behavior

Governed by the Phase 14 capability registry (`engine/capability/`), queried live for this audit:

| Metric | Count / 327 |
|---|---|
| Have a dedicated (Tier 1/2) behavioral model | 33 |
| Fall back to the generic Tier 3 model (config + health-check only) | 294 |
| `CONFIGURATION` / `VALIDATION` true (universal baseline) | 327 / 327 |
| `CONNECTIVITY` true (recognized by name in the live traversal engine) | 26 |
| `NETWORK_BEHAVIOR` true (real subnet/NAT/endpoint rule) | 13 (314 `NOT_APPLICABLE` by default - see §16) |
| `IAM_BEHAVIOR` true | 12 (6 `NOT_APPLICABLE`, proven not just assumed) |
| `REQUEST_SIMULATION` true (test-proven, live engine) | 20 |
| `FAILURE_SIMULATION` true (test-proven, differentiated recovery) | 12 |
| **`FULL_BEHAVIOR`** (every applicable axis true/N.A.) | **9** |
| Services with zero earned differentiation beyond the universal baseline | **297 (91%)** |

The 9 `FULL_BEHAVIOR` services: **EC2, Lambda, Fargate, S3, DynamoDB, RDS, CloudFront, ALB, NLB.**
This is the honest number; it is small on purpose (see §16's disclosure about the registry's own
`NOT_APPLICABLE` default, which this audit found is itself over-broad and should not be read as
"verified inapplicable" for most of those 314).

## 8. Request Simulation

`runSimulation()` (`engine/simulation/requestSimulator.ts` + 9 adapters in `adapters/`) is the
live, sole, user-reachable simulation engine. It correctly models: WAF signature inspection (with
Shield deliberately *not* conflated into it - a previously-documented risk, confirmed fixed),
compute auto-scaling vs. saturation, NAT Gateway SNAT + placement, CloudFront cache hit/miss, ALB/
NLB/API-Gateway target-health routing (503, not 502, for zero healthy targets - confirmed), RDS/
Aurora/DynamoDB Multi-AZ failover vs. Single-AZ hard failure, SQS enqueue-and-decouple, VPC Gateway/
Interface Endpoint routing, and Internet Gateway attachment checking. Deterministic (same input →
same output, `test/unified-pipeline.test.ts` P8) and covered by 50 tests in `test/engine.test.ts`
plus the bulk of the 106 `tests/aws-conformance/` tests.

**The one thing it does not do is IAM** (§6, Critical Issue #1). A second, more complete engine
exists (`engine/pipeline/engine.ts`'s `runUnifiedPipeline`, Phase 8) that *does* compose Network +
IAM + Service models per hop and is itself tested (`test/unified-pipeline.test.ts`, 22 tests) - but
it is confirmed, by grep, to be imported nowhere under `src/context/` or `src/components/`. Two
real simulation engines exist in this codebase; only the less complete one is live.

## 9. Failure Simulation

`engine/failure/` (Phase 9) does real propagation reasoning, not blanket downstream failure: it
distinguishes direct failure, cascading failure (only when no redundancy mechanism - Multi-AZ
failover, cache fallback, target-group sibling failover - actually covers the dependent), and
correctly scopes AZ and NAT Gateway failures to their real blast radius (an AZ-A outage does not
touch AZ-B; a NAT Gateway failure blocks internet-bound egress only, not intra-VPC traffic to a
database) - all independently verified in `test/failure-engine.test.ts` (13 tests) and
`tests/aws-conformance/failures/` (3 tests). It is correctly wired into the live simulation
(`ArchitectureContext.tsx`'s `effectiveNodes`/`effectiveEdges`, consumed by `runScenario`).

**Two disclosed gaps:**
- **UI coverage is narrow.** Of the 14 `FailureType` values the engine supports (network, route,
  NACL, SG, IAM, DNS, service/instance/database unavailable, AZ, NAT, load-balancer-target,
  dependency, configuration), **only `az_failure` has a UI button** (`FailureControls.tsx`,
  confirmed by grep - exactly one `injectFailure()` call site in the entire `src/` tree). The
  other 12 are fully implemented and tested but reachable only by calling the context API
  directly (as the tests do) - a student cannot inject a NACL denial, an IAM denial, or a NAT
  failure from the UI today.
- **SQS failure is a known, honest non-model**, not a gap that was missed: `test/engine.test.ts`
  test S10 is literally titled "Always Succeeds Regardless of Queue Health" and the capability
  registry (§7) correctly withholds `FAILURE_SIMULATION` for SQS as a result. This is disclosure,
  not oversight.

## 10. Architecture Validation

`engine/validation/` (Phase 10) is real and correctly scoped to structural legality only (invalid
CIDR, overlapping subnets, invalid placement, missing routes, malformed NACL/SG rules, dangling
connections, missing IAM permissions/invalid trust, delegated `ServiceModel.validateConfiguration`)
- 13 tests (`test/validation-engine.test.ts`) plus the priority-list conformance tests double as
validation-engine exercises. It is kept cleanly distinct from "good architecture"
(`engine/analysis/architecturalFindings.ts` - SPOF, bottlenecks, public exposure, missing
redundancy, dependency concentration, failure blast radius) and from "did this request succeed"
(§8) - confirmed by a dedicated, deliberately-constructed test
(`test/architectural-analysis.test.ts` test 9, "IMPORTANT DISTINCTION") proving all three can
disagree on the exact same architecture simultaneously. This three-way separation is one of the
better-executed design decisions in the codebase.

Both engines run automatically (`useMemo` on `[nodes, edges]`) - see Performance (§14) for the
cost of that.

## 11. Explainability

`engine/trace/` (Phase 11) composes the real per-domain evaluators (NACL, SG, IAM, Service) into a
WHAT/WHERE/WHY/AWS-rule decision trace, with both a detailed and a plain-English rendering from one
data model (8 tests, `test/trace-engine.test.ts`) and a live UI surface (the "AWS Explanation"
button and modal added in Phase 13, manually verified in a real browser with zero console errors
during that phase). It is the best-explained part of the application to a student **when they open
it** - but per Critical Issue #1, it is not consulted by the headline pass/fail result, so a
student who never clicks "AWS Explanation" has no way to discover that a request the app called
"successful" would not actually be.

## 12. UI Integration

Design/Simulate/Failure Lab/Analyze/Challenges are preserved as the product's structure (Phase 13
was explicitly scoped not to redesign it). Service configuration correctly feeds the model
(§1). Send Request/Task Flow invoke the live engine and now show request path, decision points, and
AWS explanation. Failure Lab is connected to the structured failure engine for AZ failures only
(§9). Analyze surfaces both validation and analysis engines. Challenges can evaluate connectivity/
IAM/security via an extended, backward-compatible `evaluationCheck` signature - demonstrated, not
yet exercised as a hard requirement, in any shipped challenge (Challenge 1 uses it for informational
bonus feedback only, never gating pass/fail).

## 13. Tests

298 tests total, all passing, at last run during this audit:

| Suite | Count | What it tests |
|---|---|---|
| `test/*.test.ts` (unit/engine) | 185 | Internal consistency of every standalone engine |
| `tests/aws-conformance/**/*.test.ts` | 106 | Behavior against cited AWS documentation, organized by the required category tree |
| `test/ui/*.test.ts` | 7 | Real React/Context integration (build architecture, configure service, send request success/failure, inject failure, analyze) |
| `test/service-capability-registry.test.ts` | 10 | The registry itself cannot overclaim (included in the 185 above) |

No test was found to encode incorrect AWS behavior during this audit (the last such audit, Phase
12, found the codebase's three previously-known CRITICAL discrepancies already fixed with correct
tests in place - re-confirmed here, not re-litigated).

## 14. Performance

No load-testing was performed (this is a client-side teaching tool, not a service under load), but
one real, mechanism-level risk was found: `validationFindings` and `architecturalFindings` are both
recomputed via `useMemo` keyed on `[nodes, edges]` (`ArchitectureContext.tsx`), and several of their
constituent checks are worse than linear (`detectBlastRadius` runs a full failure-propagation BFS
per node, `O(n·(n+e))`; `detectDependencyConcentration` computes upstream-caller sets per node
similarly). React Flow changes the `nodes` array reference on every drag frame, so **dragging a
node on a large diagram re-runs the entire validation + analysis engine stack on every animation
frame.** For the diagram sizes this tool is actually used at (single digits to a few dozen nodes,
per every reference template in `referenceArchitectures.ts`) this is not observable. It would
become observable well before 327-node-scale diagrams, which is outside this tool's realistic use
case, but worth a debounce if larger classroom diagrams become common.

## 15. Determinism

`runSimulation` is deterministic given identical input (confirmed by `test/unified-pipeline.test.ts`
P8, and consistent with every other test in the suite depending on repeatable output). `failure/
propagation.ts`'s `createFailure()` generates a random/time-based `id` (`crypto.randomUUID()` or a
`Date.now()`-based fallback) - this is intentional and harmless (ids are never asserted by value in
any test, only structural fields are), but means two `Failure` objects for the same logical event
are never `===` or deep-equal across runs. Not a bug; noted for completeness since the audit was
asked to check it explicitly.

## 16. Maintainability

Strong points: consistent "standalone engine, registry-resolved, additively wired" pattern across
Phases 5-11 (network/iam/service/failure/validation/trace all follow the same shape); the IAM-
authenticated-service list was found duplicated identically in two files during Phase 14 and
deduplicated into `engine/capability/iamCoverage.ts` as part of that phase - a real, executed fix,
not just a finding. Weak points, found during this audit specifically: (a) §8's two parallel
simulation engines are a maintenance hazard - a future service-specific fix applied to one will
silently not apply to the other; (b) the capability registry's own `NETWORK_BEHAVIOR` axis
defaults to `NOT_APPLICABLE` for any service not in an explicit allow-list (314 of 327) - this
audit's own statistical query (§7) found this default is broad enough to make "how many services
have zero real differentiation" misleading unless that axis is excluded from the count, which this
report does but the registry's own aggregate `classify()` function does not - a future maintainer
reading registry output naively could over-credit `NOT_APPLICABLE` as "verified," when for most of
those 314 it actually means "never checked." This is a genuine, disclosed weakness in Phase 14's
own design, found by actually running its output rather than trusting its self-description.

---

## AWS Fidelity, by supported service

"Supported" here means the service appears with a dedicated behavioral model OR meaningful live
adapter/test coverage - the remaining ~294 catalog services are METADATA ONLY by definition (see
§7) and are not re-listed individually.

| Service | Configuration | Validation | Connectivity | Network | IAM | Request | Failure | **Fidelity** |
|---|---|---|---|---|---|---|---|---|
| **S3** | ✓ | ✓ | ✓ | N/A | ✓ | ✓ | ✓ | **FULL** |
| **EC2** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **FULL** |
| **Lambda** | ✓ | ✓ | ✓ | N/A | ✓ | ✓ | ✓ | **FULL** |
| **Fargate** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **FULL** |
| **DynamoDB** | ✓ | ✓ | ✓ | N/A | ✓ | ✓ | ✓ | **FULL** |
| **RDS** | ✓ | ✓ | ✓ | ✓ | N/A* | ✓ | ✓ | **FULL** |
| **CloudFront** | ✓ | ✓ | ✓ | N/A | N/A* | ✓ | ✓ | **FULL** |
| **ALB** | ✓ | ✓ | ✓ | ✓ | N/A* | ✓ | ✓ | **FULL** |
| **NLB** | ✓ | ✓ | ✓ | ✓ | N/A* | ✓ | ✓ | **FULL** |
| ECS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | **PARTIAL** (no ECS-specific SERVICE-FAILURE test; shares ALB's failover test only) |
| Route 53 | ✓ | ✓ | — | N/A* | N/A* | ✓ | ✓ | **PARTIAL** (correct outcome, via the generic health-gate, not real DNS routing-policy logic - see §3) |
| SQS | ✓ | ✓ | ✓ | N/A | ✓ | ✓ | — | **APPROXIMATION** (health has no effect on outcome - explicitly documented, not silent) |
| SNS | ✓ | ✓ | ✓ | N/A | ✓ | — | — | **PARTIAL** (IAM-checked; no dedicated success/failure test written) |
| API Gateway | ✓ | ✓ | ✓ | ✓ | — | ✓ | — | **PARTIAL** |
| Aurora | ✓ | ✓ | ✓ | ✓ | N/A* | — | — | **PARTIAL** (shares RDS's DB_SERVICE_IDS treatment; no dedicated test file) |
| ElastiCache | ✓ | ✓ | ✓ | ✓ | — | — | ✓ | **PARTIAL** (cache-fallback role tested; no standalone success/failure test) |
| NAT Gateway | ✓ | ✓ | ✓ | ✓ | N/A | ✓ | ✓ | **PARTIAL→FULL-equivalent** (every axis but the unclassified bookend is proven; not counted FULL only because it is infra, not a "service" per se in the registry's own priority framing) |
| Internet Gateway | ✓ | ✓ | ✓ | ✓ | N/A | ✓ | — | **PARTIAL** |
| EKS | ✓ | ✓ | — | — | — | — | — | **APPROXIMATION** (a real, dedicated Tier-1 config model exists; **zero** live traversal/failure wiring - a disclosed, genuine gap, not an oversight in this audit - see §7/Phase 14's own test 6) |
| ECR, EFS, KMS, Secrets Manager, EventBridge, Cognito, Step Functions, CloudWatch, WAF | ✓ | ✓ | (WAF/EventBridge only) | — | (KMS/Secrets Mgr only) | (WAF only) | — | **PARTIAL/APPROXIMATION** (dedicated Tier-2 config models exist and are tested standalone in `test/service-engine.test.ts`; most have no live-engine wiring) |
| *(remaining ~294 catalog services)* | ✓ | ✓ | — | — | — | — | — | **METADATA ONLY** |

\* `N/A` for IAM on RDS/CloudFront/ALB/NLB/Route 53 is a **proven** classification (a dedicated
conformance test asserts IAM correctly does not gate the relevant action), not an assumption - see
§7's table note and `engine/capability/registry.ts`'s `IAM_NOT_APPLICABLE_EVIDENCE`.

---

## Networking Fidelity

CIDR validity/overlap, longest-prefix route selection, NACL ordering/statelessness/implicit-deny,
Security Group statefulness/CIDR/reference matching, NAT Gateway placement and AZ-scoped failure,
Internet Gateway attachment, and VPC Gateway/Interface Endpoint routing are all real, live, and
independently tested (§2-5). The one systemic gap: "public/private subnet" and route resolution in
the live app are a geometric/adjacency heuristic, not a real `RouteTable` evaluation, even though a
correct `RouteTable` engine exists unused (§2-3).

## IAM Fidelity

The policy engine (explicit/implicit deny, wildcards, conditions, trust, assumption, boundaries,
SCPs) is the most rigorously correct single engine in the codebase. Its real-world usefulness to a
student is capped by Critical Issue #1: it does not affect whether a simulated request succeeds.

## Service Fidelity

9 of 327 catalog services (2.8%) are `FULL_BEHAVIOR` by a mechanically-enforced, test-cited
standard. ~30 services (9%) have at least one piece of real, differentiated behavior. The remaining
~91% are honestly METADATA ONLY - visible, configurable, categorizable, but behaviorally inert
beyond a generic health check. See the full table above and §7.

## Failure Fidelity

The propagation engine itself (redundancy-aware cascading, AZ/NAT blast-radius scoping) is correct
and well-tested. UI reachability is the gap: 1 of 14 failure types has a button.

---

## Known Limitations

- Live request simulation has no IAM awareness (Critical #1).
- Two parallel simulation engines exist; only the less complete one is live (`runSimulation` vs.
  `runUnifiedPipeline`).
- Route/subnet-type resolution is a geometric heuristic, not a real route table, in the live app.
- Source IP/CIDR is never modeled for live SG/NACL evaluation - only protocol+port are real.
- 12 of 14 failure types have no UI entry point.
- SQS failure has no simulated effect (disclosed, not silent).
- EKS has a config model with zero live wiring.
- The capability registry's `NETWORK_BEHAVIOR` default is broader than verified for ~314 services.
- Validation/analysis recompute on every node-drag frame (no debounce).

## Critical Issues

1. **IAM does not gate live simulation success/failure.** A request the validation engine and the
   trace engine both correctly identify as an IAM denial still reports `success: true` from
   `runSimulation`/Send Request/Task Flow - the one result most prominently displayed to a student.
   **Fix shape:** either wire `runUnifiedPipeline` in as the live engine (it already does this
   correctly), or add an IAM check directly into `requestSimulator.ts`'s hop loop mirroring
   `explainHop`'s existing logic. Either is a scoped, well-understood change given the engines
   involved are already correct in isolation.

## High Priority Issues

1. Failure Lab UI exposes only `az_failure` - 12 of 14 engine-supported failure types have no
   button, hiding fully-built, tested capability from students.
2. Two independent simulation engines (`runSimulation`, `runUnifiedPipeline`) risk silent
   divergence on future service-specific fixes.
3. EKS (explicit priority item #6 in the phase history) has no live behavioral wiring at all.

## Medium Priority Issues

1. Route/subnet-type resolution is geometric, not derived from a real route table, in the live
   canvas.
2. Validation/analysis engine recomputation is not debounced against node-drag frames.
3. `NETWORK_BEHAVIOR`'s blanket `NOT_APPLICABLE` default overstates verified coverage in aggregate
   statistics unless manually excluded (as this report does).
4. No canvas UI exists to author `ServiceNodeData.iamRole` - it is a real, tested field reachable
   only from code.

## Low Priority Issues

1. `Failure.id` generation is non-deterministic (harmless; noted for completeness per audit scope).
2. SNS, Aurora, ElastiCache, API Gateway lack a dedicated SUCCESS/SERVICE-FAILURE conformance test
   despite having real underlying behavior - cheap to add, matches an existing pattern exactly.
3. Source IP/CIDR is never modeled for SG/NACL evaluation (a stated, longstanding simplification,
   not a regression).

---

## Test Coverage

| | Count |
|---|---|
| **Total AWS behaviors identified** (networking + IAM + per-service checklist items across Phase 12/14's own category lists) | ~85 |
| **Total implemented** | ~70 |
| **Total tested** (currently-passing, named test asserting the specific behavior) | 298 tests covering ~70 behaviors |
| **Total partially implemented** (real but incomplete - e.g. IAM engine correct but not live-wired; ECS/SNS/Aurora with some but not all axes) | ~15 |
| **Total missing** (no implementation at all - e.g. DNS routing policies, EKS live wiring, real route-table-derived subnet typing) | ~10 |
| **Total approximated** (deliberately simplified, disclosed - SQS health-has-no-effect, source-IP-not-modeled, RDS Multi-AZ failover timing) | 3 named, several more implicit in the 294 metadata-only services |

(These are audit-level groupings of the ~85 distinct AWS behaviors this report and its Phase 12
predecessor identified across networking, IAM, and the priority service list - not a literal count
of every possible AWS behavior in existence, which is unbounded.)

---

## Recommended Next Steps

1. **Close Critical Issue #1** - give the live `runSimulation` path real IAM awareness, either by
   adopting `runUnifiedPipeline` or by porting `explainHop`'s IAM step into the adapter pipeline.
   This is the single highest-leverage fix in the codebase: every other IAM component is already
   correct and just needs to be consulted.
2. Add Failure Lab UI buttons/menu for at least NACL denial, Security Group denial, and IAM denial
   - the three failure types most directly tied to what a networking/IAM-focused lesson would want
   to demonstrate, and all three are fully built and tested already.
3. Add a canvas-reachable way to attach an `iamRole` to a compute node (even a simple JSON-paste
   field in the Service Inspector would unblock this).
4. Decide, explicitly, whether `runUnifiedPipeline` is adopted as the live engine or retired -
   maintaining two is the maintainability risk most likely to cause a future silent regression.
5. Add the 4 cheap missing conformance tests (SNS/Aurora/ElastiCache/API-Gateway success+failure)
   to convert 4 more services from PARTIAL toward FULL_BEHAVIOR.
6. Debounce `validationFindings`/`architecturalFindings` recomputation against drag-frame node
   updates before this tool is used on markedly larger diagrams than today's reference templates.

---

## Most Important Question

**"If a student builds an AWS architecture in this simulator, how confident can we be that the
simulator's success/failure behavior corresponds to actual AWS behavior?"**

Confidence levels below are for the **live, user-facing Send Request / Task Flow result** - the
thing a student actually watches pass or fail - not for the underlying engines in isolation (several
of which, e.g. IAM, are more correct than their live-wired confidence rating implies).

| Domain | Confidence | Why |
|---|---|---|
| **Networking** (VPC/subnet/route/NAT/IGW) | **High** | Real, live, extensively tested; the one gap (route-table-derived subnet typing) doesn't change observable pass/fail outcomes for any topology this app's own templates exercise. |
| **Security Groups & NACLs** | **High** | Real rule evaluation, live, correct ordering/statefulness/implicit-deny; the SG source-IP simplification doesn't change binary allow/deny for CIDR-based rules as currently used (protocol+port match only). |
| **IAM** | **Low** | The policy engine itself is excellent in isolation, but it has **zero effect on the live simulation result** a student actually sees pass or fail. Do not trust a "SUCCESS" result to mean IAM would actually allow it. |
| **Compute** (EC2/Lambda/Fargate/ECS) | **Moderate-High** | EC2/Lambda/Fargate are FULL_BEHAVIOR with real, tested success/failure/scaling logic; ECS shares the same code paths but lacks its own dedicated failure test - behaviorally almost certainly fine, just less directly verified. EKS is a real, disclosed gap (config only, no live behavior). |
| **Storage** (S3) | **High** | FULL_BEHAVIOR, real Gateway Endpoint routing, real IAM check (in the trace/validation layers - same caveat as IAM row above applies to whether it's *enforced*), real failure behavior. |
| **Databases** (RDS/DynamoDB/Aurora) | **Moderate-High** | RDS and DynamoDB are FULL_BEHAVIOR with correct Multi-AZ-vs-Single-AZ semantics. Aurora shares the same mechanism but has no dedicated test - same "almost certainly fine, less directly verified" caveat as ECS. |
| **Load Balancing** (ALB/NLB) | **High** | FULL_BEHAVIOR, correct 503-not-502 semantics, correct target-health routing, both L7 and L4 paths tested. |
| **Messaging** (SQS/SNS) | **Low-Moderate** | Success path and IAM are real; SQS failure is explicitly a no-op (disclosed) and SNS has no dedicated success/failure test at all. Do not rely on this simulator to teach messaging failure behavior. |
| **DNS** (Route 53) | **Moderate** | Correct pass/fail outcome via a generic health gate, but no actual DNS routing-policy modeling (failover records, weighted/latency routing, health-check-based record selection) - fine for "is the record healthy," not for teaching how Route 53 itself makes routing decisions. |
| **Failure Simulation** | **Moderate** | The underlying propagation engine is genuinely good (redundancy-aware, correctly AZ/NAT-scoped) and correctly wired into live simulation - but only reachable for AZ failures through the UI today; the other 12 failure types are simulator-correct but student-inaccessible without direct API calls. |

**Overall: do not present this simulator's pass/fail result to a student as authoritative for IAM
or for messaging-service failure behavior. It is trustworthy today for networking, Security
Groups/NACLs, load balancing, and the 9 FULL_BEHAVIOR compute/storage/database services. Everything
else falls somewhere between "correct but unverified for this specific service" and "not modeled at
all, and honestly labeled as such."**
