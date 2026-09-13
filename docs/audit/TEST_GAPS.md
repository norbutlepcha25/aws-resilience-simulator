# TEST_GAPS.md

Cross-references `docs/codebase/TEST_SYSTEM.md` (43 tests, all currently passing, all **internal-consistency** tests — they assert the simulator agrees with itself, never with an external AWS-documented fact) against every CRITICAL/HIGH/MEDIUM finding in this audit. For each finding: does a test exist today, and if not, what would one need to assert.

## Method

A test is counted as covering an AWS-conformance finding only if it would **fail** were the current (non-conformant) behavior reverted to, or would have caught the gap before this audit found it by inspection. Tests that merely assert the simulator's own internal output is self-consistent (e.g., "the ALB routes to the healthy target") do not count as conformance coverage for a fact like "AWS returns 503, not 502" unless they specifically assert the status code value against the documented fact.

## Coverage table

| Finding (severity) | Existing test? | What's tested today | What conformance test is needed |
|---|---|---|---|
| NACL implicit-deny missing (CRITICAL, `NETWORKING_GAPS.md`) | Test 31 exercises `checkNetworkFirewalls` with an explicit deny-list; test 40 exercises the custom-NACL stateless-return path — **neither constructs a custom NACL with an unmatched protocol** to check what happens when no rule matches | That NACL evaluation with an explicit rule matches correctly | A new test: a custom NACL with only an HTTP-allow rule, then a request using a *different* protocol (e.g., SQL) with no matching rule at all — must assert `blocked: true` once fixed (currently would assert `blocked: false`, which is the bug) |
| `waf`/`shield` conflation (CRITICAL, `SERVICE_GAPS.md`) | No test exercises `shield` as a distinct node id at all — grep of `test/engine.test.ts` shows no occurrence of `'shield'` | Nothing | A test placing a `shield` node (not `waf`) and asserting it does **not** perform the same regex-based L7 inspection `waf` does (once fixed) |
| ALB 502 vs. real AWS 503 for all-targets-unhealthy (CRITICAL, `AWS_CONFORMANCE_AUDIT.md` §3) | Test 4 ("502 Bad Gateway when ALL compute targets fail") **explicitly asserts 502** | That the simulator is internally consistent with its own (currently non-conformant) choice | Test 4 itself must be updated to assert 503 once the code is fixed — today it would need to be treated as an intentional-change, not a regression, if this fix lands |
| IAM entirely unimplemented (CRITICAL composite, `IAM_GAPS.md`) | No test exercises any IAM concept — no `principal`/`role`/`policy` field appears anywhere in `test/engine.test.ts` | Nothing | Cannot be meaningfully tested until IAM modeling exists; the correct interim test is a **documentation-level regression guard**: a test asserting the Thumbnail Generator template's `node-iam` node has zero effect on simulation outcome when removed, to keep the "metadata, not behavior" fact explicit and machine-checked rather than only documented in prose |
| NLB never target-health-evaluated (HIGH, `SERVICE_GAPS.md`) | No test constructs an NLB with a mixed healthy/unhealthy target set — all existing ALB-style tests (2, 3, 4) use `alb` specifically | Nothing for NLB | A new test mirroring test 3 ("ALB Health Check Failover when ECS-1 is FAILED") but with `nlb` as the load balancer, asserting it currently does *not* correctly route around the failed target (documenting the gap) then re-asserting the correct behavior once fixed |
| `privatelink` not subnet-required (MEDIUM, `SERVICE_GAPS.md`) | No test places a `privatelink` node outside any subnet boundary | Nothing | A new test: `privatelink` node with no containing subnet boundary, asserting `subnet === 'unassigned'` once fixed (today would assert `'global'`) |
| Endpoint hops skip firewall check (MEDIUM, `NETWORKING_GAPS.md` §Endpoints, `docs/codebase/REQUEST_SIMULATOR.md` §8) | Test 24 ("S3 Gateway Endpoint Is Wired Into the Request Path") asserts the endpoint is used, but does not configure any SG/NACL rule on the endpoint hop to check whether it would be enforced | That the endpoint routes traffic | A new test: attach a restrictive Security Group to the target reached via `privatelink`, and assert the request is blocked once the firewall check is added to this hop (today it would incorrectly succeed) |
| Cascading Failure Walkthrough disconnected from canvas (CRITICAL, `FAILURE_GAPS.md`) | No test exercises `FailureControls`/`CASCADING_FAILURE_STAGES` at all — this is a UI component and `test/engine.test.ts` only tests `src/engine/**` and `src/data/**`, never `src/components/**` (confirmed in `docs/codebase/TEST_SYSTEM.md` — "no component/UI test coverage at all") | Nothing | Out of reach for the current test file's scope (engine-only); would require a component-level test (e.g., React Testing Library) not currently part of this project's toolchain — flagged as a tooling gap, not just a missing test case |
| RedundancyExperimentModal disconnected from canvas (HIGH, `FAILURE_GAPS.md`) | Same as above | Nothing | Same tooling gap as above |
| ECS/ASG narration conflation (MEDIUM, `FAILURE_GAPS.md`) | Test 3 checks ALB failover narration text loosely (`.includes('Stateless Return Blocked')`-style substring checks elsewhere, but no test asserts on the specific "Auto Scaling Group" wording for an ECS-backed ALB scenario) | Partial — the failover *mechanism* (routing to the healthy target) is tested; the *narration accuracy* is not | A new test asserting an ECS-backed ALB failover's explanation text does not claim ASG involvement (or correctly names the ECS service scheduler instead) |
| RDS Multi-AZ failover timing narration (LOW, accepted approximation) | Test 11 checks the failover *succeeds*, not the specific ~35s number | N/A — this is an accepted approximation, not a defect requiring a new test | None required |
| Dead serviceId branches (`auto_scaling`, `vpc_endpoint`, `elb` in `requestSimulator.ts`; `s3_client`/`s3_managed`/`step_lambda`/`s3_gateway`/`vpc_endpoint`/`igw` in `costCalculator.ts`) | No test exercises these ids (impossible to, since no catalog entry has them) | N/A | Not testable as-is; the correct fix is removing the dead code (`PRIORITIZED_REFACTOR_PLAN.md`), after which there is nothing left to test |

## Structural finding: the test suite cannot currently distinguish "matches AWS" from "matches itself"

Every one of the 43 tests asserts the simulator's output against a value the test author chose to hard-code as the expected result — none assert against a value sourced from, or cross-checked against, `docs/aws-behavior/*`. This means a future regression that made the simulator *more* wrong in an AWS-conformance sense (e.g., someone "fixing" the ALB status code back to 502 because a test says so) would currently be caught as a **test failure against the wrong expectation**, not flagged as a conformance issue — the test suite would need to be updated in lockstep with any conformance fix, and there is currently no mechanism (e.g., a shared constants file importing from an AWS-facts source) linking the two.

**Recommendation for `PRIORITIZED_REFACTOR_PLAN.md`**: once `NETWORKING_BEHAVIOR.md`/`SERVICE_BEHAVIOR.md` stabilize, extract their most load-bearing numeric/status-code facts (ALB's 503, NACL's implicit-deny, the 5-reserved-address model, etc.) into a small set of named constants importable by both the simulator and the test suite, so a future test reads `expect(result.statusCode).toBe(AWS_FACTS.ALB_NO_HEALTHY_TARGETS_STATUS)` rather than a bare `503` — making the link between "what we assert" and "what AWS documents" explicit and single-sourced, not just conventionally true because both currently happen to agree.

## Summary

| Area | Tests exist today | Tests needed |
|---|---|---|
| NACL implicit deny | Adjacent coverage only | 1 new targeted test |
| WAF/Shield conflation | None | 1 new targeted test |
| ALB status code | Test asserts the *wrong* value | 1 existing test to update |
| IAM | None (nothing to test yet) | 1 regression guard (node-iam inertness) |
| NLB target health | None | 1 new targeted test |
| `privatelink` placement | None | 1 new targeted test |
| Endpoint firewall bypass | Adjacent coverage only | 1 new targeted test |
| UI-only failure features | None, and out of current toolchain scope | Tooling gap, not just a test gap |
