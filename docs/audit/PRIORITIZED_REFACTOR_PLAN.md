# PRIORITIZED_REFACTOR_PLAN.md

Synthesizes every finding from `AWS_CONFORMANCE_AUDIT.md`, `NETWORKING_GAPS.md`, `IAM_GAPS.md`, `SERVICE_GAPS.md`, `SIMULATION_GAPS.md`, `FAILURE_GAPS.md`, and `TEST_GAPS.md` into a single ranked plan. Ranking logic: small, isolated CRITICAL fixes first (matching this project's own established pattern of fixing isolated bugs before undertaking larger mechanical refactors — see `docs/codebase/` history); the one large structural refactor (item 8) is placed after the small critical fixes so each fix can be verified against the current, well-understood flat structure before that structure is changed; MEDIUM/LOW cleanup follows; large future-scope items (Route Tables, full IAM) are listed last and explicitly marked as separate planning efforts, not line items to execute alongside the rest. **No code has been changed to produce this plan — it is a plan, not an implementation.**

---

## 1. NACL custom-rule matcher: add the implicit final deny

**Status: DONE.** Fixed in `networkFirewalls.ts`; test 44.

**Problem**: a custom NACL configured in this simulator permits any protocol it has no explicit rule for, the opposite of real AWS's default-deny posture.

**Current implementation**: `networkFirewalls.ts`'s `checkNetworkFirewalls`, custom-NACL branch — `if (match) {...} else { nacl = {evaluated:true, blocked:false, note:'...permitted: no matching rule.'} }`.

**AWS behavior**: every real NACL has an immutable, non-removable rule 32767 that denies everything not matched by an earlier, explicit rule (`docs/aws-behavior/NETWORKING_BEHAVIOR.md` §8, CONFIRMED).

**Required change**: change the `else` branch's `blocked` value to `true`, with a note explaining the implicit-deny-all rule (mirroring the language already used for the legacy `naclDenyInbound` path's explicit-deny note, for consistency).

**Affected files**: `src/engine/simulation/networkFirewalls.ts` (single function); `test/engine.test.ts` (new test).

**Risk**: LOW in isolation, but must re-verify every existing reference-architecture template that configures a `customNacl` (currently only `nacl-custom-stateless-timeout`, per `docs/aws-behavior/AWS_BEHAVIOR_MODEL.md` §4/confirmed grep) does not rely on the current permissive fallback for its own "fixed" (success) scenario — test 40's fixed-state assertion must be re-checked against the new implicit-deny behavior, since its `customNacl` includes an explicit final `{ruleNumber: 32767, ..., action: 'DENY'}` rule already (per the template data reviewed in `docs/codebase/`), so it should be unaffected, but this must be confirmed by running the suite, not assumed.

**Tests required**: (a) a new minimal test — custom NACL with only an HTTP-allow rule, request using SQL protocol, assert `blocked: true` post-fix; (b) full suite re-run to confirm test 40 unaffected (per the note above).

---

## 2. Stop conflating `waf` and `shield`

**Status: DONE.** Fixed in `requestSimulator.ts` (perimeterInspectionAdapter); test 45.

**Problem**: both ids trigger the identical malicious-regex check; the simulator cannot express "WAF caught this, Shield wouldn't have."

**Current implementation**: `requestSimulator.ts` Behavior 1 — `if (['waf', 'shield'].includes(currentNode.data.serviceId))`.

**AWS behavior**: WAF performs L7 (HTTP request content) inspection; Shield protects against L3/L4 volumetric/protocol DDoS and does not perform signature-based request inspection (`docs/aws-behavior/SERVICE_BEHAVIOR.md` — Shield entry, CONFIRMED).

**Required change**: split into two checks — `waf` keeps the existing regex-based inspection; `shield` becomes a pass-through (or, if DDoS-scenario teaching is a future goal, a distinct volumetric-traffic-level check keyed on `scenario.trafficLevel` rather than request content — out of scope for this item, flagged as a possible future enhancement, not required now).

**Affected files**: `src/engine/simulation/requestSimulator.ts` (Behavior 1 block only).

**Risk**: LOW — no existing reference template currently places a `shield` node on a path where this check fires (confirm via grep before landing, since if one does, its expected simulation outcome would change).

**Tests required**: new test placing a `shield` node (not `waf`) on a malicious-looking path, asserting it does NOT block (post-fix), contrasted with an existing/adjacent `waf` test that does.

---

## 3. Fix ALB "no healthy targets" status code: 502 → 503

**Status: DONE.** Fixed in `requestSimulator.ts` (loadBalancerAdapter); test 4 updated, test 30 re-verified.

**Problem**: simulator returns 502 for a scenario AWS documents as 503.

**Current implementation**: `requestSimulator.ts` Behavior 5, `healthyTargets.length === 0` branch — `finalStatusCode = 502`.

**AWS behavior**: ELB documentation and observed behavior use 503 Service Unavailable for "no healthy targets in the target group"; 502 Bad Gateway is reserved for a malformed response *from* a target (`docs/aws-behavior/SERVICE_BEHAVIOR.md` — ALB entry, CONFIRMED for the distinction, the exact status code is the specific fact to treat as authoritative here).

**Required change**: change `finalStatusCode = 502` to `503` (and the corresponding `details.statusCode`) in this one branch only; leave every other 502 usage in the file untouched (e.g., the "Unresolved Downstream Connection" dead-end case at a different code site legitimately uses 502 for a different reason and is out of scope for this item).

**Affected files**: `src/engine/simulation/requestSimulator.ts` (Behavior 5 only); `test/engine.test.ts` test 4 (currently asserts 502 — must be updated, not left as a now-failing regression).

**Risk**: LOW — isolated, single-branch numeric change; the only consumer asserting the old value is test 4 itself.

**Tests required**: update test 4's assertion from 502 to 503; no new test needed beyond that update.

---

## 4. Close the "IAM metadata implies behavior" gap on the Thumbnail Generator template

**Status: DONE** (option b - clarifying text, node kept for architectural completeness). `referenceArchitectures.ts` learningOutcome updated; test 46 (regression guard).

**Problem**: the template draws a labeled `node-iam` node and an edge reading "IAM Execution Role" that have zero effect on the simulation, creating a false impression of IAM coverage.

**Current implementation**: `referenceArchitectures.ts`, Thumbnail Generator template, `node-iam` node + its edge; `requestSimulator.ts` has no reference to `serviceId === 'iam'` anywhere (confirmed, `docs/audit/IAM_GAPS.md`).

**AWS behavior**: n/a — this is a truth-in-labeling fix, not an AWS-behavior fix.

**Required change**: two options, either acceptable as an immediate fix (full IAM modeling is out of scope for this plan — see item 13): (a) remove the `node-iam` node/edge from the template entirely, or (b) keep it but add a clarifying phrase to the template's `learningOutcome` text stating the IAM role is illustrative and not enforced by the simulation.

**Affected files**: `src/data/referenceArchitectures.ts` (Thumbnail Generator template only).

**Risk**: LOW — a template-data-only change (option a) or a text-only change (option b); no simulator engine code touched either way.

**Tests required**: a regression-guard test asserting the Thumbnail Generator template's simulation outcome is unchanged whether or not `node-iam`/its edge are present (protects against a future, unrelated change accidentally making this node load-bearing without anyone noticing it had become one).

---

## 5. Cascading Failure Walkthrough: connect to canvas or relabel

**Status: DONE** (track a - honest relabel). `FailureControls.tsx` retitled to "Case Study: Cascading Outage" with explicit "not based on your own architecture" copy. Track (b) - a dynamic, canvas-derived version - remains unimplemented future work.

**Problem**: the "Fault Simulation" toolbar's "Step Through Cascading Outage" feature is a fixed, canvas-independent 4-stage slideshow, despite sitting alongside real, canvas-connected AZ-outage controls.

**Current implementation**: `CASCADING_FAILURE_STAGES` (static data) + `FailureControls.tsx` modal — no `nodes`/`edges` reference anywhere in this feature.

**AWS behavior**: n/a directly — the individual stages are each independently plausible (`docs/aws-behavior/FAILURE_BEHAVIOR.md` §3), but there's no "AWS rule" this violates; the problem is internal (feature framing vs. feature behavior), covered fully in `FAILURE_GAPS.md` finding 1.

**Required change**: two tracks, pick one given available effort — **(a) minimal/honest**: relabel the feature clearly as a fixed illustrative case study (e.g., retitle away from "Fault Simulation" grouping, or add explicit "General Case Study (not based on your architecture)" framing); **(b) full fix**: compute the 4 stages dynamically — identify the user's actual DB node (Multi-AZ or not), actual compute tier (replica count, ALB presence), and actual client-facing layer, and only narrate a stage as applicable if the user's architecture would actually be vulnerable to it (e.g., stage 1→2 only applies if there's a synchronous compute→DB edge with no cache fallback; stage 3 only applies if health checks and app traffic plausibly share resources, which isn't even inferable from this app's current node model — see `SIMULATION_GAPS.md`).

**Affected files**: (a) `src/components/failure/FailureControls.tsx` only; (b) `src/components/failure/FailureControls.tsx` + a new `src/engine/failure/cascadingFailureAnalysis.ts` reading `nodes`/`edges`, likely reusing `spofDetector.ts`'s existing structural checks as building blocks.

**Risk**: (a) LOW; (b) MEDIUM-HIGH — a genuinely new analysis feature, not a bug fix, with its own scope-definition risk (deciding which architectures trigger which stages is itself a design decision, not a mechanical port).

**Tests required**: (a) none beyond a UI-copy review; (b) a full new test suite for the dynamic analysis logic, comparable in scope to `spofDetector.ts`'s existing 4-test coverage.

**Recommendation**: do (a) now as part of this plan; treat (b) as a separate future feature proposal, not a refactor-plan line item, given its scope.

---

## 6. NLB: add target-health evaluation

**Status: DONE.** Fixed in `requestSimulator.ts` (loadBalancerAdapter); test 47.

**Problem**: `nlb` nodes never get ALB-style health-based routing; a request can be routed to a failed target when a healthy alternative exists.

**Current implementation**: `requestSimulator.ts` Behavior 5 gate — `if (['alb', 'api_gateway'].includes(currentNode.data.serviceId))` — omits `nlb`.

**AWS behavior**: NLB performs its own target health checks and routes only to healthy targets, conceptually parallel to ALB but at the connection/TCP level (`docs/aws-behavior/SERVICE_BEHAVIOR.md` — NLB entry, CONFIRMED).

**Required change**: add `'nlb'` to the Behavior 5 gate condition; verify the existing target-selection logic (pick first healthy target, `pushFirewallBlockIfAny`, narration) makes sense unchanged for NLB, or split into a shared helper if NLB's narration text needs to differ (e.g., NLB should not claim "TLS termination" the way ALB narration might).

**Affected files**: `src/engine/simulation/requestSimulator.ts` (Behavior 5 condition, and review of its narration text for ALB-specific language that would be wrong for NLB).

**Risk**: LOW-MEDIUM — check whether any existing reference template routes through an `nlb` node with multiple targets of mixed health today (if none do, this is a pure addition with no risk of changing an existing template's expected outcome).

**Tests required**: new test mirroring test 3 but with `nlb`, asserting correct routing around a failed target.

---

## 7. `RedundancyExperimentModal`: wire to real simulation

**Status: DONE**, with the tooling caveat noted below still standing. Wired to real `runSimulation` calls against two fixed topologies matching the modal's own diagrams; verified correct (200/503) via a standalone sanity script. No component-level test was added - the test-tooling gap this item's "Tests required" section flagged is still open.

**Problem**: the modal's `useArchitecture` import is dead; its entire comparison is fixed copy, not a real before/after simulation.

**Current implementation**: local `useState(false)` boolean only; no `runSimulation` call; no `nodes`/`edges` read.

**AWS behavior**: n/a — same category as item 5, an internal framing gap.

**Required change**: call `runSimulation` twice (target node healthy, then failed) against the actual current canvas nodes/edges, and render the real `SimulationResult` diffs (status code, latency, which steps changed) instead of fixed copy.

**Affected files**: `src/components/failure/RedundancyExperimentModal.tsx`; possibly exposes a new small helper in `ArchitectureContext.tsx` if `runSimulation` isn't easily callable with a locally-overridden node health without going through full context state.

**Risk**: MEDIUM — touches a modal that currently has zero engine coupling; needs care to avoid accidentally mutating the real canvas state while only meaning to preview a hypothetical failure.

**Tests required**: this is a UI-component change — per `TEST_GAPS.md`, the current test suite has no component-level testing tooling; this item would need either a new manual QA pass or an added component-testing tool as a prerequisite (flagged as a tooling dependency, not silently assumed).

---

## 8. Extract `requestSimulator.ts`'s conditional chain into ordered service-behavior adapters

**Status: DONE.** Extracted into `src/engine/simulation/adapters/` (types.ts + 8 adapter files + index.ts pipeline); `requestSimulator.ts` is now a thin orchestrator. Full 50-test suite passed unchanged on the first run after the rewrite - behavior-preservation bar met, same as the cost-calculator precedent.

**Problem**: 15 hard-coded serviceId-keyed conditional sites in one ~850-line function, each new fix (items 1-6 above, and any future one) requires editing this same function and reasoning about its fixed execution order relative to unrelated behaviors.

**Current implementation**: flat sequential `if` blocks, order-significant, no shared interface (full inventory in `SIMULATION_GAPS.md`).

**AWS behavior**: n/a — purely an internal architecture concern.

**Required change**: introduce an ordered pipeline of named adapters (`PerimeterInspectionAdapter`, `ComputeCapacityAdapter`, `NatGatewayAdapter`, `CloudFrontAdapter`, `LoadBalancerAdapter`, `DataTierInteractionAdapter` (split into DB/Cache/Queue), `VpcEndpointAdapter`, `NetworkPathAdapter` for the 7A/7B/7C group, `EventTriggerAdapter`), each exposing a predicate (does this apply to the current hop) and an evaluate function with access to the shared traversal context (`currentNode`, `downstreamNodes`, `boundaryNodes`, `scenario`, mutable timestamp/step accumulators, and a way to signal continue/advance/terminate). Unlike the already-completed `costCalculator.ts` pricing-module registry (a flat, order-independent `Record<string, Module>`), this **must stay an ordered pipeline**, since several behaviors are genuinely order-dependent (WAF must precede ALB routing; compute-DB interaction must precede generic 7A/7B/7C resolution) — flagged explicitly so this refactor isn't mistakenly modeled as equally simple as the cost-calculator precedent.

**Affected files**: `src/engine/simulation/requestSimulator.ts` (full restructure); likely new files under `src/engine/simulation/adapters/`; `test/engine.test.ts` should require zero assertion changes if done correctly (same bar the cost-calculator refactor met).

**Risk**: HIGH — this is the largest, most invasive change in this plan; do it only after items 1-6 (small, independently-verifiable fixes) have landed against the current flat structure, so each fix's correctness is established before the surrounding structure changes. Attempting the adapter extraction and a batch of behavior fixes in the same change would make it much harder to isolate a regression's cause.

**Tests required**: full existing 43-test suite must pass unchanged (behavior-preservation is the acceptance bar, matching the cost-calculator refactor's precedent); no new test cases required by the refactor itself, though items 1-6's new tests should already exist and continue passing through this restructure as the strongest evidence it's behavior-preserving.

---

## 9. `privatelink`: require subnet placement

**Status: DONE.** Fixed in `containment.ts` (`SUBNET_REQUIRED_SERVICE_IDS`); test 48.

**Problem**: `privatelink` is not in `SUBNET_REQUIRED_SERVICE_IDS` despite modeling a real, ENI-based Interface VPC Endpoint that would require subnet placement in actual AWS.

**Current implementation**: `containment.ts`, `SUBNET_REQUIRED_SERVICE_IDS` array omits `'privatelink'`.

**AWS behavior**: Interface VPC Endpoints create ENIs in customer-chosen subnets (`docs/aws-behavior/NETWORKING_BEHAVIOR.md` §11b, CONFIRMED).

**Required change**: add `'privatelink'` to `SUBNET_REQUIRED_SERVICE_IDS`.

**Affected files**: `src/engine/layout/containment.ts` (one array literal).

**Risk**: LOW-MEDIUM — check every existing reference template using `privatelink` to confirm none currently place it outside a subnet boundary (if one does, that template's `subnet` field for that node would newly become `'unassigned'`, changing its simulated outcome — must verify before landing, not assume).

**Tests required**: new test placing an unplaced `privatelink` node, asserting `subnet === 'unassigned'` post-fix; full suite re-run to catch any affected existing template.

---

## 10. Add firewall checks to the VPC-endpoint and managed-event-trigger hops

**Status: DONE for the VPC-endpoint (Interface/PrivateLink) hop**; test 49. The event-trigger hop was deliberately left unchanged per this item's own nuance - it represents internal AWS service-to-service event delivery, which does not cross a customer-configurable Security Group boundary in real AWS, so no firewall check was added there.

**Problem**: `pushFirewallBlockIfAny` is never called on the 6B (VPC endpoint) or event-trigger hop paths — a Security Group on an Interface Endpoint's ENI, or a NACL on its subnet, can never actually block traffic reaching it in this simulator.

**Current implementation**: confirmed absence, `docs/codebase/REQUEST_SIMULATOR.md` §8.

**AWS behavior**: an Interface VPC Endpoint's ENIs are subject to Security Groups exactly like any ENI-backed resource (`docs/aws-behavior/NETWORKING_BEHAVIOR.md` §11b, CONFIRMED).

**Required change**: add a `pushFirewallBlockIfAny(currentNode, endpointTarget, protocol)` call before advancing on the 6B path (and consider whether the event-trigger path needs the same, given it represents an internal AWS-service-to-service delivery that in reality does not cross a customer-configurable Security Group boundary at all — this second case may be an intentional no-firewall-check design, not a gap, and should be confirmed against AWS's actual event-delivery model before being "fixed" the same way as 6B).

**Affected files**: `src/engine/simulation/requestSimulator.ts` (Behavior 6B, and a design decision on the event-trigger path).

**Risk**: MEDIUM — must re-verify test 24 and test 39 (the two templates exercising VPC-endpoint/event-trigger paths) still pass, since adding a firewall check where none existed could newly introduce a block if either template's endpoint subnet happens to have restrictive rules configured (unlikely today, but must be checked, not assumed).

**Tests required**: new test attaching a restrictive SG to an endpoint target, asserting the request is now blocked; full suite re-run for tests 24/39.

---

## 11. Disambiguate ALB/ASG/ECS-scheduler failover narration

**Status: DONE.** Fixed in `requestSimulator.ts` (loadBalancerAdapter), branching narration on `failedTargets[0].data.serviceId`; existing tests 3/30 re-verified against the new branching.

**Problem**: ALB failover explanation text sometimes attributes target replacement to "the Auto Scaling Group" regardless of whether the actual compute type is EC2, ECS/Fargate, or Lambda.

**Current implementation**: `requestSimulator.ts` Behavior 5's `albExplanation` string construction, gated only by `nodes.some(n => n.data.serviceId === 'auto_scaling' ...)` (itself a dead check, see item 12) rather than by the actual `selectedTarget`/`failedTargets` compute type.

**AWS behavior**: EC2 recovery is an ASG concern; ECS/Fargate recovery is the ECS service scheduler's concern — two distinct, independently-documented systems (`docs/aws-behavior/FAILURE_BEHAVIOR.md` §1, CONFIRMED).

**Required change**: branch the narration text on `failedTargets[0].data.serviceId` (or the target group's compute type generally) rather than a single generic sentence, naming the ECS service scheduler for `ecs`/`fargate` targets and the ASG for `ec2` targets.

**Affected files**: `src/engine/simulation/requestSimulator.ts` (Behavior 5 narration only — no control-flow/outcome change, text only).

**Risk**: LOW — text-only change, does not affect `status`/`statusCode`/`success`.

**Tests required**: new test(s) asserting the correct system is named for an ECS-backed vs. EC2-backed ALB failover scenario.

---

## 12. Remove dead serviceId branches

**Status: DONE**, and expanded in scope once investigated: `auto_scaling` was fixed to the real catalog id `ec2_auto_scaling` (not just deleted) so the capability it was clearly meant to provide actually works, requiring companion fixes to 4 reference-template nodes that used the same non-existent id (`vpc-nat-autoscaling-3tier`, `serverless-container` x2, `ec2-auto-scaling-failure-recovery`) plus test 29/30 updates. `vpc_endpoint` and `elb` were removed outright (no real single-id replacement exists). In `costCalculator.ts`, `s3_gateway` was fixed to the real id `s3_gateway_endpoint`, which also fixed a real, previously-undetected bug: the "add an S3 Gateway Endpoint" FinOps tip's own "does one already exist" check used the dead id, so it could never actually detect an existing endpoint - test 36b added to cover both directions of this check explicitly.

**Problem**: `auto_scaling`, `vpc_endpoint`, `elb` (in `requestSimulator.ts`) and `s3_client`, `s3_managed`, `step_lambda`, `s3_gateway`, `vpc_endpoint`, `igw` (in `costCalculator.ts`) reference ids that do not exist in the catalog and can never be reached by any real node.

**Current implementation**: confirmed via direct grep cross-reference against the live catalog id list, `docs/codebase/SERVICE_SYSTEM.md` §3.1 and `docs/codebase/ANALYSIS_ENGINE.md` §4.

**AWS behavior**: n/a — pure dead-code cleanup.

**Required change**: remove each dead id from its array/condition (keeping the real, reachable sibling ids); for `requestSimulator.ts`'s `auto_scaling` check specifically, this is bundled with item 11's narration fix since both touch the same condition.

**Affected files**: `src/engine/simulation/requestSimulator.ts`, `src/engine/cost/costCalculator.ts` (registry entries).

**Risk**: LOW — removing unreachable code cannot change any reachable behavior by definition; the only risk is accidentally removing a *reachable* sibling id alongside a dead one in the same array (mitigated by doing this as a small, carefully-reviewed diff, not a bulk find-replace).

**Tests required**: none new (nothing was ever reachable); full suite re-run to confirm no accidental removal of a live id.

---

## 13. (Future planning phase, not a line item here) Route Table / Route entity

**Problem**: "public subnet" is a user-set label, not derived from actual route-table contents; no CIDR-based route matching, VPC Peering, or Transit Gateway exists.

**Why not scoped here**: this is a new entity type affecting the core geometry/containment model (`containment.ts`), the CIDR allocator, and multiple `requestSimulator.ts` checks (7A especially) simultaneously — larger than a single refactor-plan item, and its design (how routes are authored/visualized on the canvas) is a product decision, not a mechanical fix. Recommend a dedicated design pass before scoping concrete tasks.

**Severity if left undone**: HIGH (per `NETWORKING_GAPS.md`), but explicitly not urgent relative to items 1-12, none of which depend on it.

---

## 14. (Future planning phase, not a line item here) IAM modeling

**Problem**: zero IAM implementation across all 10 audited constructs (`IAM_GAPS.md`).

**Why not scoped here**: 14 concepts, an 8-step evaluation-order composite rule (`docs/aws-behavior/IAM_BEHAVIOR.md` §15), and a decision about how deeply to model it (a full policy-JSON evaluator vs. a simplified principal/role/allow-deny check) are all product-scope decisions requiring their own design pass — bolting this onto the current (soon-to-be-refactored, per item 8) simulator function would compound rather than fix the architectural problem this plan already identifies.

**Severity if left undone**: CRITICAL (composite finding, `IAM_GAPS.md`), but the immediate, cheap mitigation (item 4, closing the misleading-metadata gap) should ship well before any full IAM effort is scoped.

---

## Summary ranking

| # | Item | Severity | Size | Depends on | Status |
|---|---|---|---|---|---|
| 1 | NACL implicit deny | CRITICAL | Small | — | DONE |
| 2 | WAF/Shield conflation | CRITICAL | Small | — | DONE |
| 3 | ALB 502→503 | CRITICAL | Small | — | DONE |
| 4 | `node-iam` metadata/behavior gap | CRITICAL | Small | — | DONE |
| 5 | Cascading Failure honesty fix (track a) | CRITICAL | Small (track a) / Large (track b) | — | DONE (track a only) |
| 6 | NLB target health | HIGH | Small-Medium | — | DONE |
| 7 | RedundancyExperimentModal wiring | HIGH | Medium | Component-test tooling | DONE (tooling gap still open) |
| 8 | Adapter-pipeline extraction | HIGH | Large | Should follow items 1-6 | DONE |
| 9 | `privatelink` subnet-required | MEDIUM | Small | — | DONE |
| 10 | Endpoint-hop firewall checks | MEDIUM | Small-Medium | — | DONE (VPC-endpoint hop only, event-trigger hop deliberately unchanged) |
| 11 | ASG/ECS-scheduler narration | MEDIUM | Small | Bundled with 12 | DONE |
| 12 | Dead-id cleanup | MEDIUM/LOW | Small | Bundled with 11 | DONE (scope expanded - see item 12) |
| 13 | Route Table entity | HIGH | Large (future phase) | Design pass first | NOT STARTED (by design) |
| 14 | Full IAM modeling | CRITICAL | Large (future phase) | Design pass first; item 8 first | NOT STARTED (by design) |

**Test suite: 43 → 50 tests, all passing. `tsc --noEmit` clean.**
