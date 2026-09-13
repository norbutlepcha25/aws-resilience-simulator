# TEST_SYSTEM.md — `test/engine.test.ts`

One file, 40 tests, Node's built-in `node:test` runner (not Jest/Vitest — confirmed by the `test(...)` import style and the `ℹ suites 0` summary line). Re-run fresh during this pass: **40/40 passing**, 0 failing, 0 skipped, ~81ms total. No source files were modified to produce this result — this is the suite's current, as-is status.

Every test is a flat integration test: it builds a small `nodes`/`edges` fixture inline and calls one or more of `runSimulation`, `analyzeArchitecture`, `detectSPOFs`, `allocateSubnetCidrs`, `calculateArchitectureCost`, etc. directly — there are no unit tests isolating a single pure helper (e.g. no test calls `getReservedAddresses` or `checkNetworkFirewalls` in isolation without going through a full node/edge fixture), and no mocking of any kind (consistent with everything under test being pure functions with no I/O). This means every test is closer to **integration** than **unit** in the classic sense, and there are zero **conformance** tests in the sense of "replay a captured real AWS API response and assert the simulator matches it" — every assumption about "what AWS actually does" is asserted only against this codebase's own model of AWS, never against a real AWS control-plane response or documented AWS behavior spec fetched at test time.

## Full test list with AWS-behavior assumption and correctness verdict

| # | Test name | What it actually tests | AWS assumption | Verdict |
|---|---|---|---|---|
| 1 | Service Catalog Integrity | Catalog has 327 entries, no duplicate ids, required fields present | N/A (structural, not AWS-behavior) | Correct as a structural check |
| 2 | Successful Multi-AZ Web App Request | Full success trace: user→ALB→ECS→RDS(Multi-AZ) | ALB routes to healthy target; Multi-AZ DB present | Matches `requestSimulator.ts` behavior 5/6 |
| 3 | ALB Health Check Failover when ECS-1 is FAILED | ALB skips a failed target, routes to the healthy one | Real ALB target-group health-check behavior | Matches; simplified to "first healthy target" not real weighted/round-robin routing (documented in `REQUEST_SIMULATOR.md` §4) |
| 4 | 502 Bad Gateway when ALL compute targets fail | ALB with zero healthy targets → 502 | Real AWS ALB 502 semantics | Correct |
| 5 | SPOF Detection on Basic Web App | `detectSPOFs` flags single EC2/single-AZ RDS | Matches the 4 hand-picked SPOF patterns in `spofDetector.ts` — see `ANALYSIS_ENGINE.md` §2 | Correct for what the detector actually checks; does not test the detector's known blind spots (Lambda/Fargate single-instance is never flagged, since check #1 only looks at `ec2`/`ecs`) |
| 6 | Architecture Rules & Explainable Multidimensional Scoring | `analyzeArchitecture` returns 5 scores with reasons | Rule-by-rule scoring in `rulesEngine.ts` | Asserts scores exist/move in the right direction; does **not** assert on the `averageScore`-excludes-security bug (§1.6 of `ANALYSIS_ENGINE.md`) — that bug is invisible to this test |
| 7 | Student Challenge Rubric Evaluation | One `evaluationCheck` passes/fails correctly | `studentChallenges.ts`'s own bespoke rules | Correct for the one challenge exercised; the other challenges (see `COMPONENT_INVENTORY.md`) are not each individually tested here |
| 8 | Direct Public Ingress to Private Subnet Blocked (403) | 7B check in `requestSimulator.ts` | Real AWS route-table semantics (private subnets have no `0.0.0.0/0 → igw` route) | Correct |
| 9 | NAT Gateway required for Private Subnet Outbound Egress | 7C check | Real AWS NAT Gateway egress model | Correct |
| 10 | Auto-Scaling: scale-out vs single-instance saturation | Behavior 2 | Simplified capacity model (fixed 2x/3x/4x multiplier, capped at 12) — not real CloudWatch-alarm-driven ASG timing | Directionally correct, explicitly a teaching approximation |
| 11 | Database Multi-AZ Automated Failover | Behavior 6 Multi-AZ branch | Real RDS Multi-AZ failover concept (simplified to always-succeeds, fixed ~35s narration) | Correct concept, oversimplified timing (no partial-failure or failed-failover case tested or modeled) |
| 12 | Multi-AZ VPC Reference Architecture Integrity & Boundary Composition | Template structure only (node/edge counts, boundary types) | N/A | Structural, correct |
| 13 | Ingress and Multi-Tier Traversal in Multi-AZ VPC Reference Architecture | Full trace through a real template | Composite of above behaviors | Correct |
| 14 | Crash Safety: Boundary Nodes as First Elements & startNode Fallback | Simulator doesn't crash if array starts with a boundary node | N/A (defensive/robustness test) | Correct, valuable regression test for an earlier fixed crash bug in this project's history |
| 15 | Architectural Analysis Safety with Boundary Containers | `analyzeArchitecture` doesn't crash when boundary nodes are present | N/A | Correct |
| 16 | Boundary Layer Hierarchy and Stacking Order (Z-Index) | `calculateBoundaryZIndex` basic case | Visual containment math, not AWS behavior | Correct |
| 17 | Boundary Dimensions and Auto-Fit Geometry | `getBoundaryRect` fallback chain | N/A | Correct |
| 18 | Task Flow Line Traversal Mapping and Edge Sequence Attribution | UI highlight-path derivation from `simulationResult` | N/A | Correct |
| 19 | Task Flow Dimming of Non-Participating Edges and Failure Isolation | Same, for the failure case | N/A | Correct |
| 20 | Public Subnet Unreachable Without an Internet Gateway | 7A IGW-gate check | Real "no IGW = no path to internet" AWS behavior | Correct |
| 21 | Reference Diagram "Simple website" end-to-end | Full template runs successfully | Composite | Correct |
| 22 | Geometric Containment: Subnet Placement Derived From Canvas Position | `deriveSubnetForNode` | Core geometry-as-source-of-truth design (see `NETWORKING_CURRENT_STATE.md` §1) | Correct |
| 23 | Simulation Fails When a VPC-Hosted Resource Is Not Placed Inside Any Subnet | `unassigned`-subnet hard-fail | Real "every ENI needs a subnet" AWS constraint | Correct |
| 24 | S3 Gateway Endpoint Is Wired Into the Request Path, Not Just Present | Behavior 6B / 7C endpoint routing | Real VPC Gateway Endpoint private-route concept | Correct, though doesn't test the confirmed no-firewall-check gap on this path (`REQUEST_SIMULATOR.md` §8) |
| 25 | Reference Diagram Geometry Integrity: every VPC-bound node sits inside its declared subnet | Cross-checks every template against the geometry engine | N/A (self-consistency check across the codebase's own data) | Correct, good regression coverage for template authoring mistakes |
| 26 | CIDR Allocator: Equal, Non-Overlapping Subnet Blocks | `allocateSubnetCidrs` core math | Real AWS even-split convention | Correct |
| 27 | CIDR Allocator: Refuses to Violate AWS's /28 Minimum | Error path | Real AWS `/28` minimum | Correct |
| 28 | Live Canvas Scenario: Subnet Auto-Numbering Matches Position, Scoped Per VPC | Multi-VPC CIDR scoping | N/A (app-specific behavior, not a direct AWS analog since AWS doesn't auto-number anything) | Correct for what the app claims to do |
| 29 | Reference Diagram "Serverless Container" | Full template run (Cognito/API GW/Cloud Map/ECS×2/DynamoDB×2) | Composite | Correct |
| 30 | Reference Diagram "Auto Scaling: EC2 Instance Failure Recovery" | Full template run | Composite | Correct |
| 31 | Network Firewall Engine: NACL vs Security Group | `checkNetworkFirewalls` directly | Real NACL-stateless/SG-stateful ordering and semantics | Correct for the one scenario tested; does not test the confirmed "no implicit deny-all" simplification in the custom-NACL matcher (`NETWORKING_CURRENT_STATE.md` §4.1) |
| 32 | Reference Diagram "Network ACL vs Security Group in Action" | Full template run | Composite | Correct |
| 33 | Subnetting: 5 AWS Reserved Addresses & Usable Host Calculation | `getReservedAddresses`/`getUsableIpRange` | Real AWS 5-address reservation | Correct, re-verified accurate this pass (`NETWORKING_CURRENT_STATE.md` §3) |
| 34 | Cost Calculator: EC2 Sizing, Savings Plans, EBS Math | `calculateNodeCost` for EC2 | AWS on-demand/savings-plan pricing model (approximated, fixed reference prices, not live) | Correct as an approximation, explicitly not live-priced |
| 35 | Cost Calculator: S3 Storage Classes | `calculateNodeCost` for S3 | AWS storage-class pricing tiers (approximated) | Correct as an approximation |
| 36 | Architecture-Wide Bill Simulation: Traffic Scaling & FinOps Recommendations | `calculateArchitectureCost` + `getTrafficScaleFactor` | App-specific traffic-to-cost multiplier, not a direct AWS concept | Correct for what the app claims |
| 37 | Dynamic Boundary Layer Hierarchy: VPC inside AZ inside Region | `calculateBoundaryZIndex` nested case | Visual, not AWS behavior | Correct |
| 38 | Dynamic Boundary Layer Hierarchy: inverted containment (AZ inside VPC) | Same, inverted nesting order | Visual | Correct |
| 39 | Reference Diagram "Thumbnail Generator" | Full template run (S3 event → Lambda in private subnet → VPC Gateway Endpoint) | Composite, exercises the `isManagedEventTrigger` block (`REQUEST_SIMULATOR.md` §5 step 4) | Correct for the one scenario; only scenario that exercises this code path at all |
| 40 | Reference Diagram "Problem 3.1: Custom NACLs stateless timeout" | Full template run, both the broken and fixed NACL states | `checkCustomNaclReturn` stateless-return semantics | Correct for its one scenario (one EC2, one RDS); does **not** cover the confirmed post-loop node-pairing bug in `requestSimulator.ts` §6 (that bug only manifests with multiple compute or DB nodes on canvas, which this test's fixture never has) |

## Coverage gaps confirmed by this pass (not previously enumerated together)

1. **No test exercises more than one compute node or more than one DB node in a diagram that also has a `customNacl` configured** — meaning the confirmed post-hoc `checkCustomNaclReturn` node-pairing bug (`REQUEST_SIMULATOR.md` §6) has zero test coverage in either direction.
2. **No test asserts on `totalLatencyMs` during a stateless-NACL-return failure** — the confirmed latency-accounting inconsistency (`REQUEST_SIMULATOR.md` §7) would not be caught by this suite even if a relevant test were added under the current assertions, since none of the NACL-related tests check `totalLatencyMs` at all, only `success`/`statusCode`/`steps` content.
3. **No test exercises the dead-id branches** in either `requestSimulator.ts` (`auto_scaling`, `vpc_endpoint`, `elb`) or `costCalculator.ts` (`s3_client`, `s3_managed`, `step_lambda`, `s3_gateway`, `igw`) — unsurprising, since no catalog service can ever produce those ids, so no fixture could exercise them even if a test tried.
4. **No test exercises the 3 firewall-check coverage gaps** (VPC-endpoint hop, managed-event-trigger hop, NAT-egress hop bypassing `pushFirewallBlockIfAny` — `REQUEST_SIMULATOR.md` §8).
5. **`rulesEngine.ts`'s security-score-excluded-from-average bug** (`ANALYSIS_ENGINE.md` §1.6) has no dedicated test; test 6 checks that scores exist and move directionally but never asserts a specific `overallRating` value against a specific 5-score combination that would expose the omission.
6. **No test covers `FailureControls.tsx`'s `failAvailabilityZone`/`restoreAllNodes` interacting with a subsequent `runSimulation` call** — i.e., there is no test that fails an AZ and then asserts the simulator's trace reflects it end-to-end (individual behaviors like Multi-AZ failover are tested via directly-constructed `health: 'failed'` fixtures, not via the `failAvailabilityZone` action itself).
7. **299 of 327 catalog services (the Category-C metadata-only services per `SERVICE_SYSTEM.md`) have no test presence at all** — reasonable, since they have no behavior to test, but worth stating explicitly: test coverage of "the catalog" (test 1) is purely structural integrity, not behavioral.

## Test/production code ratio

`test/engine.test.ts` is one file; there is no `test/` subdirectory structure, no per-engine-file test file split, and no component/UI test coverage at all (no React Testing Library, no `.test.tsx` files anywhere in the repo) — everything under test is engine logic reached through `runSimulation`/`analyzeArchitecture`/etc., never a rendered component.
