# SERVICE_GAPS.md

Per-service audit across 7 axes, for all 28 behaviorally-referenced services (`docs/codebase/SERVICE_SYSTEM.md` §3.1). Legend: ✅ = present/correct for what this simulator claims to model · ⚠️ = partial/narrow · ❌ = absent.

- **UI**: renders with an icon, palette entry, and inspector panel.
- **Config**: `ServiceInspector`/catalog exposes meaningful, behavior-affecting configuration (replicas, multiAz, customConfig, etc.) — not just cosmetic fields.
- **Validation**: geometric/placement validation applies where real AWS would require it (subnet placement, IGW attachment, etc.).
- **Simulation**: `requestSimulator.ts` has service-specific traversal/decision logic beyond generic pass-through.
- **Failure**: `health: 'failed'` on this node (or a dependency) produces a *distinct*, service-appropriate consequence, not just the generic top-of-loop halt.
- **IAM**: any authorization check gates this service's reachability. (Per `IAM_GAPS.md`, this is ❌ for all 28 — included here for completeness, not repeated as a new finding per row.)
- **Network**: participates in the subnet/SG/NACL model the way real AWS would require.

| Service | UI | Config | Validation | Simulation | Failure | IAM | Network |
|---|---|---|---|---|---|---|---|
| `alb` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `api_client` | ✅ | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ |
| `api_gateway` | ✅ | ❌ | ❌ (correctly excluded — no VPC placement in real AWS) | ✅ | ✅ | ❌ | ❌ (correct) |
| `app_runner` | ✅ | ❌ | ✅ | ⚠️ | ⚠️ | ❌ | ✅ |
| `aurora` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `client_ui` | ✅ | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ |
| `cloudfront` | ✅ | ⚠️ | ❌ (correct) | ✅ | ⚠️ | ❌ | ❌ (correct) |
| `dynamodb` | ✅ | ❌ | ❌ (correct) | ✅ | ⚠️ | ❌ | ⚠️ |
| `ec2` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `ecs` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `elasticache` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `eventbridge` | ✅ | ❌ | ❌ (correct) | ⚠️ | ⚠️ | ❌ | ❌ (correct) |
| `fargate` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `internet_gateway` | ✅ | ❌ | N/A (VPC-level, not subnet-scoped) | ✅ | ✅ | ❌ | ✅ |
| `lambda` | ✅ | ⚠️ | ❌ (correct — no VPC placement by default) | ✅ | ✅ | ❌ | ⚠️ |
| `nat_gateway` | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ |
| **`nlb`** | ✅ | ❌ | ✅ | **⚠️ (see finding below)** | **⚠️** | ❌ | ✅ |
| **`privatelink`** | ✅ | ❌ | **⚠️ (see finding below)** | ⚠️ | ⚠️ | ❌ | **⚠️** |
| `rds` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `route53` | ✅ | ❌ | ❌ (correct) | ⚠️ | ⚠️ | ❌ | ❌ (correct) |
| `s3` | ✅ | ✅ | ❌ (correct) | ✅ | ⚠️ | ❌ | ⚠️ |
| `s3_gateway_endpoint` | ✅ | ❌ | ❌ (correct) | ✅ | ⚠️ | ❌ | ⚠️ |
| **`shield`** | ✅ | ❌ | ❌ (correct) | **⚠️ (conflated with waf)** | ❌ | ❌ | ❌ (correct) |
| `sns` | ✅ | ❌ | ❌ (correct) | ⚠️ | ⚠️ | ❌ | ❌ (correct) |
| `sqs` | ✅ | ❌ | ❌ (correct) | ✅ | ⚠️ | ❌ | ❌ (correct) |
| `step_functions` | ✅ | ❌ | ❌ (correct) | ⚠️ | ⚠️ | ❌ | ❌ (correct) |
| `user` | ✅ | ❌ | ❌ (correct) | ✅ | N/A | ❌ | ❌ (correct) |
| `waf` | ✅ | ❌ | ❌ (correct) | ✅ | ⚠️ | ❌ | ❌ (correct) |

**Reading note**: a ❌ in Config/Validation/Network is not automatically a defect — for services with no real VPC/ENI presence (`api_gateway`, `lambda` by default, `cloudfront`, `dynamodb`, `s3`, `route53`, `eventbridge`, `sns`, `sqs`, `step_functions`, `user`/`client_ui`/`api_client`), a ❌ correctly mirrors real AWS having no such requirement either — marked "(correct)" above. The **IAM column is uniformly ❌ and is a single finding, not 28** — see `IAM_GAPS.md` for the full analysis; it is not repeated per-row here.

---

## New findings surfaced by this cross-axis pass (not previously documented)

### NLB never receives target-health evaluation

`requestSimulator.ts` Behavior 5 (target health / failover routing) is gated by `if (['alb', 'api_gateway'].includes(currentNode.data.serviceId))` — **`nlb` is not in this list**, despite `nlb` being fully subnet-required (`SUBNET_REQUIRED_SERVICE_IDS` includes it), IGW-gated (`vpcHostedIngressServices` includes it), and priced as a load balancer (`costCalculator.ts`'s `loadBalancerModule` handles `alb`/`nlb`/`elb` identically). A user-drawn NLB with two downstream targets, one healthy and one failed, does **not** get AWS's real behavior (route only to the healthy target) — the generic `nextNode = downstreamNodes.find(n => !visited.has(n.id)) || downstreamNodes[0]` resolution simply picks the first unvisited downstream node in array order, regardless of health. If that happens to be the failed target, the request fails with a generic downstream-health error at the *next* loop iteration rather than NLB's real behavior of transparently routing around it. This is a genuine simulation gap, not a documentation-only inconsistency — an NLB in this simulator is structurally treated as a valid ingress point but never actually load-balances.

**Severity: HIGH | Status: PARTIAL**

### `privatelink` is not subnet-required despite being ENI-based in real AWS

`docs/aws-behavior/NETWORKING_BEHAVIOR.md` §11b confirms a real Interface VPC Endpoint (which `privatelink` is meant to model) creates actual ENIs in chosen subnets and is subject to Security Groups exactly like any ENI-backed resource. But `privatelink` is **not** in `containment.ts`'s `SUBNET_REQUIRED_SERVICE_IDS` — placing a `privatelink` node outside any subnet boundary does not produce the `unassigned`-subnet hard-fail the way an EC2/RDS/ALB node would. This is inconsistent with its own real-world networking model (ENI-based, therefore subnet-scoped) and inconsistent with how `s3_gateway_endpoint` (its Gateway-Endpoint sibling, correctly *not* subnet-required since Gateway Endpoints have no ENI) is treated — the two endpoint types are handled identically by the simulator's placement rules despite being structurally different in real AWS specifically on this axis.

**Severity: MEDIUM | Status: INCORRECT** (not merely missing — it actively groups two AWS concepts that should be treated differently under one placement rule)

### `shield`/`waf` conflation (cross-referenced from `SERVICE_BEHAVIOR.md`)

Already documented in the AWS-behavior phase; restated here as a Service-axis finding because it affects the Simulation column for both rows identically — both ids trigger the exact same malicious-regex check (`requestSimulator.ts` Behavior 1), meaning this simulator cannot currently express "WAF caught this, Shield wouldn't have" or vice versa, which is the entire pedagogical point of having both services exist as distinct catalog entries.

**Severity: CRITICAL | Status: INCORRECT**

### Failure-axis pattern: only 6 of 28 services have a *distinct* failure consequence

Only `alb`/`api_gateway` (target-health rerouting/502), `ec2`/`ecs`/`fargate`/`lambda`/`app_runner` (auto-scaling-vs-saturation), `rds`/`aurora` (Multi-AZ failover / cache fallback / hard fail), `nat_gateway`/`internet_gateway` (egress/ingress path failure), and the managed-event-trigger targets (fail their specific "event delivery failed" message) have failure behavior distinguishable from the generic top-of-loop `health === 'failed'` halt. The remaining ~16 services (all of the ⚠️/N/A rows in the Failure column above) fail identically regardless of what they actually are — a failed SQS queue, a failed SNS topic, and a failed Step Functions state machine all currently produce the exact same generic "Service Down Failure" step text, when each has a distinct, AWS-documented real failure/retry story (dead-letter queues, per-subscriber retry policies, per-state catch/retry) that could differentiate them.

**Severity: MEDIUM | Status: PARTIAL** (a real, broad gap, but consistent with this being a request-tracing tool rather than a full failure-mode simulator for every service — appropriately MEDIUM rather than HIGH/CRITICAL since no individual service's core teaching scenario depends on this differentiation today)

## Summary

| Finding | Severity | Status |
|---|---|---|
| NLB never target-health-evaluated | HIGH | PARTIAL |
| `privatelink` not subnet-required (inconsistent with its own ENI-based model) | MEDIUM | INCORRECT |
| `waf`/`shield` conflation | CRITICAL | INCORRECT |
| IAM support absent for all 28 services | CRITICAL | MISSING (see `IAM_GAPS.md`) |
| Generic (undifferentiated) failure behavior for ~16 of 28 services | MEDIUM | PARTIAL |
