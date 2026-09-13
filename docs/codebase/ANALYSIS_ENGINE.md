# ANALYSIS_ENGINE.md — `rulesEngine.ts`, `spofDetector.ts`, `bottleneckDetector.ts`, `costCalculator.ts`

Per the task brief's explicit instruction not to conflate these ideas, every mechanism below is labeled exactly one of:
- **VALIDATION** — checks whether the graph is structurally/architecturally valid; does not simulate a request or score quality, just flags a rule violation.
- **SIMULATION** — executes/traces something that changes over "time" or "hops" (belongs to `requestSimulator.ts`, cross-referenced here only where relevant).
- **ANALYSIS** — static scoring/inspection of the graph as it currently stands, independent of any simulated run.

All four files in this document are **pure ANALYSIS**. None of them run a request trace, and none of them gate or block anything — a user can run a simulation on an architecture with a 0/100 security score, and the score never changes what the simulator does. This confirms the architectural separation described in `ARCHITECTURE.md` §4: there is no distinct VALIDATION module in this codebase; the closest things to validation are inline structural checks living inside `requestSimulator.ts` itself (unassigned-subnet hard-fail, IGW-attachment gate, direct-public-to-private block — see `REQUEST_SIMULATOR.md` §3, §5) — those are SIMULATION-time gates, not a separate validation pass, and they are not shared with or reused by the ANALYSIS engine described here (the ANALYSIS engine has its own, separately-coded parallel check for `unassigned` subnets — see §1.5 below — rather than calling into the simulator's check).

## 1. `rulesEngine.ts` — `analyzeArchitecture()` — ANALYSIS

Computes 5 independent 0-100 scores from static counting/filtering over `nodes`/`edges`, each starting from a fixed baseline and adjusted additively/subtractively by named rules. Confirmed by full re-read (290 lines).

### 1.1 Availability (baseline 50)
+15 ALB/API-Gateway present (−15 if absent) · +15 total compute replicas ≥2 (−15 if compute exists but is single-instance) · +20 Multi-AZ DB or DynamoDB present (−20 if RDS exists but isn't Multi-AZ) · +10 CloudFront present. `nodes.length === 0` forces the score to exactly 0.

### 1.2 Resilience (baseline 45)
+25 zero SPOFs (only if `nodes.length >= 3`) / −15×SPOF-count if any exist · +15 SQS present · +10 ElastiCache present · +10 if any compute node is ECS or Lambda (managed scheduler replaces failed units).

### 1.3 Fault Tolerance (baseline 40)
+25 compute spread across ≥2 tracked AZs (−15 if compute exists in only one AZ) · +25 Multi-AZ DB (−20 if RDS exists but single-AZ) · +10 Route 53 present.

### 1.4 Scalability (baseline 50)
+20 CloudFront present (−10 if absent) · +15 ALB present · +15 total compute replicas ≥3 OR any Lambda present · −10×bottleneck-count (cross-references `detectBottlenecks`, see §2).

### 1.5 Security (baseline 60) — the only score with individual `SecurityAuditItem` findings attached
- **−25, CRITICAL**: any node with derived `subnet === 'unassigned'` (re-derives the same geometric fact `requestSimulator.ts` also checks at simulation time, §3 of `REQUEST_SIMULATOR.md` — this is a **separate, parallel check**, not a shared call; both files independently read the same `node.data.subnet` field but neither calls the other).
- **−35, CRITICAL**: an edge from the `user` node directly to an `rds`/`dynamodb` node (database exposed straight to the public client tier).
- **−20 per instance, CRITICAL**: any `rds` node whose derived `subnet === 'public'` (+10 per RDS node that is correctly private).
- **+15**: WAF present. **−10, WARNING**: no WAF but an ALB or CloudFront exists (public entry point unprotected).
- **±10**: any edge with `protocol === 'HTTP'` (unencrypted) triggers −10; otherwise (if any edges exist at all) +10 for "TLS enforced" — note this is a blanket check across **all** edges, not just public-facing ones, so an internal HTTP hop between two private-subnet services is scored identically to an internet-facing HTTP link.

### 1.6 Aggregation — FIXED

**Status: fixed.** `averageScore` was computed as `(finalAvail + finalRes + finalFt + finalScale) / 4` — `finalSec` (the security score) was computed and displayed in the UI but never included, and `averageScore` is the sole input to `overallRating` (`Resilient`/`Moderate`/`Fragile`/`Incomplete`) alongside a raw SPOF count. A security-catastrophic architecture (database publicly exposed directly to the client tier, `unassigned` nodes, no WAF) could still be rated "Resilient" overall as long as the other 4 scores and SPOF count looked good — confirmed reproducible: the `highly-available-multiaz` reference template stayed rated `'Resilient'` even after adding a direct `user`→`rds` edge (the single most severe security violation this engine detects), because that edge only ever moved `finalSec`. Fixed by changing the aggregation to `(finalAvail + finalRes + finalFt + finalScale + finalSec) / 5`; re-verified against both existing overallRating assertions (`basic-spof-app` stays `'Fragile'`, `highly-available-multiaz` stays `'Resilient'` when unmodified) before landing. Covered by `test/engine.test.ts` test 42 ("Security Score Is Included in the Overall Resilience Rating").

### 1.7 `overallRating` thresholds
`nodes.length < 3` → forced `'Incomplete'`. Else `averageScore >= 80 && spofs.length === 0` → `'Resilient'`. Else `averageScore < 60 || spofs.length >= 2` → `'Fragile'`. Else `'Moderate'` (the default).

## 2. `spofDetector.ts` — `detectSPOFs()` — ANALYSIS

4 independent, unrelated checks, each appending to a flat `SPOFItem[]` (no shared traversal, no graph-wide dependency analysis — "SPOF detection" here means 4 hand-picked structural patterns, not a general single-point-of-failure algorithm over the dependency graph):
1. Exactly one `ec2`/`ecs` node total with `replicas` summing to 1 → CRITICAL.
2. Any `rds` node without `multiAz` and `replicas <= 1` → CRITICAL (per-node, can produce multiple entries).
3. Any edge from the `user` node directly to an `ec2`/`ecs` node (bypassing a load balancer) → HIGH (per-edge).
4. Exactly one `nat_gateway` node total, while more than 2 nodes have derived `subnet === 'private'` → MEDIUM. Note: this counts **service nodes** placed in private subnets, not the number of private-subnet **boundaries** — a single private subnet containing 3 service nodes triggers this exactly the same as 3 separate private subnets each containing 1 node.

None of these 4 checks examine `dependencies` arrays from the service catalog, generalize to other compute types (Lambda/Fargate are never flagged even as a single-instance concern, since check #1 only looks at `ec2`/`ecs`), or consider anything beyond these 4 fixed patterns — "SPOF detection" is a curated checklist, not a computed graph property.

## 3. `bottleneckDetector.ts` — `detectBottlenecks()` — ANALYSIS

3 independent checks:
1. **DB connection contention**: total compute replica count ≥4 AND zero ElastiCache nodes → HIGH, per RDS node.
2. **Unbuffered synchronous write**: any edge from compute→`rds` with `edge.data.interactionType === 'synchronous'` AND zero SQS nodes → MEDIUM (confirmed `interactionType` is a real, populated field — every edge created via the canvas UI or a reference template defaults to `'synchronous'`, so this condition is commonly true, not dead data; verified via cross-file grep during this pass).
3. **Missing CDN**: zero CloudFront nodes AND at least one compute node → LOW.

## 4. `costCalculator.ts` — `calculateArchitectureCost()` / `calculateNodeCost()` — ANALYSIS

**Status: refactored.** `calculateNodeCost` was a single function with **15 `if`/`else if` branches** keyed directly on `serviceId` string literals or small sets of them (ec2 · s3/s3_client/s3_managed · rds/aurora · lambda/step_lambda · alb/nlb/elb · nat_gateway · ecs/fargate/app_runner · cloudfront · dynamodb · route53 · eks · elasticache · waf · igw/internet_gateway · s3_gateway/vpc_endpoint) — the same "giant conditional keyed on service type" anti-pattern documented in `REQUEST_SIMULATOR.md` §9. It has been restructured into a **pricing-module registry**: one pure `PricingModule` function per service family, each taking a shared `PricingContext` (`node`/`label`/`replicas`/`multiAz`/`custom`/`trafficMultiplier`) and returning a `PricingResult` (`lineItems`/`configSummary`/`freeTierEligible?`). `PRICING_MODULE_ENTRIES` declares each module's matched `serviceIds` once; a flat `PRICING_MODULE_REGISTRY: Record<string, PricingModule>` is built from it at module-load time, and `calculateNodeCost` is now a single lookup plus a call, falling back to `fallbackModule` for anything unmatched. This was a purely mechanical extraction — every formula, rate, and line-item string is unchanged — re-verified against `test/engine.test.ts` tests 34-36 (which pin exact dollar-amount expectations) with zero assertion changes needed, plus a clean `tsc --noEmit`.

The id variants this file checks for that do not exist in the catalog at all — `s3_client`, `s3_managed`, `step_lambda`, `s3_gateway` (catalog spelling is `s3_gateway_endpoint`), `vpc_endpoint`, and `igw` (catalog spelling is `internet_gateway`) — were **deliberately preserved as-is** in their registry entries rather than corrected, since changing the matched-id set is a behavior change outside the scope of a mechanical refactor; each entry is still reachable via its real sibling id in the same `serviceIds` array. Combined dead-id tally across the codebase: **9 confirmed instances** (3 in `requestSimulator.ts`, 6 here), now co-located one-per-registry-entry instead of buried inside a 300-line conditional, which makes them considerably easier for a future pass to spot and fix deliberately.

## 5. Cross-cutting observations

- **No shared "finding" type.** `SecurityAuditItem` (rulesEngine), `SPOFItem` (spofDetector), `BottleneckItem` (bottleneckDetector), and `FinOpsTip`/`LineItem` (costCalculator) are four structurally different result shapes, each rendered by its own dedicated modal (`AnalysisModal.tsx`, `CostEstimatorModal.tsx`). There is no unified "issue" abstraction a future contributor could extend once to cover all four analysis surfaces.
- **`studentChallenges.ts` is a fifth, separate rule-evaluation surface** (see `COMPONENT_INVENTORY.md`) — each challenge's `evaluationCheck` reads `analysis.spofs` (reusing SPOF output) but otherwise recomputes its own ALB/replica/Multi-AZ checks independently rather than reusing `rulesEngine.ts`'s scores structurally. A change to how `rulesEngine.ts` scores availability has zero effect on whether "Challenge 1: Zero Single Points of Failure" passes, since the challenge re-derives its own pass/fail boolean from raw node data.
- **Everything here is stateless and pure** — all 4 files take `nodes`/`edges` and return a plain object, with no internal caching beyond React's own `useMemo` wrapping in `ArchitectureContext.tsx`. This means, unlike `requestSimulator.ts`'s imperative on-demand trigger, these functions genuinely do recompute on every relevant state change — which is why the UI's cost pill and analysis badge always reflect the live canvas without the user needing to click anything, whereas the simulation result can go stale relative to the canvas until "Send Request" is clicked again.
