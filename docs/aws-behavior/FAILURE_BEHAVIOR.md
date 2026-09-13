# FAILURE_BEHAVIOR.md

Real AWS failure modes and recovery mechanics, consolidated from the per-component entries in `NETWORKING_BEHAVIOR.md` and `SERVICE_BEHAVIOR.md` (axis 10 of each), plus an explicit assessment of the simulator's own hardcoded cascading-failure narrative (`docs/codebase/FAILURE_SYSTEM.md`) against documented real-world failure patterns. Classification: CONFIRMED / APPROXIMATION / UNKNOWN.

## 1. Three distinct, independent health-check mechanisms — do not conflate

A recurring source of error (including in this simulator's own current code, per `docs/codebase/REQUEST_SIMULATOR.md` Behavior 5) is treating "health" as one unified concept. Real AWS has (at least) three separate, independently-configured health-check systems that happen to often be layered together:

| Mechanism | What it checks | What it does on failure | Does NOT do |
|---|---|---|---|
| **ELB (ALB/NLB) target health check** | The target's own configured health-check path/port at a configured interval | Removes the target from active routing rotation immediately | Does **not** terminate or replace the target instance/task itself |
| **Auto Scaling Group health check** | EC2 status checks, and optionally the attached ELB's target health (if `ELB` health-check type is configured on the ASG) | Terminates the unhealthy instance and launches a replacement | Does **not** by itself remove a target from an ELB faster than the ELB's own check would |
| **ECS service scheduler** | Container-level health checks and/or an attached ALB target group's health | Stops the unhealthy task and starts a replacement to restore desired count | Same boundary as ASG — it's a scheduler-level replacement, not the load balancer's own routing decision |

— CONFIRMED (*Elastic Load Balancing User Guide — Health checks for target groups*; *Amazon EC2 Auto Scaling User Guide — Health checks*; *Amazon ECS Developer Guide — Service scheduler*). All three can be configured together (the common, AWS-recommended pattern for EC2/ECS behind an ALB), but they are separate systems evaluated independently, on their own schedules — a target can be "removed from ALB rotation" before, after, or at roughly the same time as "terminated by the ASG," depending on each system's own configured thresholds/intervals, not as a single atomic event.

## 2. Per-component failure/recovery summary

| Component | Failure trigger | Detection mechanism | Recovery mechanism | Typical/documented timing | Classification |
|---|---|---|---|---|---|
| EC2 instance | Host hardware fault, OS crash, app-level unresponsiveness | EC2 status checks; ELB target health; ASG health check | ASG terminate + relaunch (if in an ASG); EC2 Auto Recovery (specific instance types, opt-in) | Minutes (ASG launch + boot + app warm-up) | CONFIRMED (mechanism) / APPROXIMATION (exact timing, workload-dependent) |
| ECS/Fargate task | Container crash, failed health check | Container health check; ALB target health | Service scheduler stops + starts replacement task | Seconds to low minutes (no OS boot needed, especially Fargate) | CONFIRMED |
| RDS (Single-AZ) | Host/storage fault, AZ outage | N/A — no automatic failover exists | Manual restore from snapshot / automated backup, or wait for AWS-side recovery | Not bounded — this is the entire point of Single-AZ being a documented SPOF | CONFIRMED |
| RDS (Multi-AZ) | Primary instance/AZ fault | RDS-internal monitoring | Automatic failover: DNS CNAME repoint to synchronous standby | AWS documents "typically 60-120 seconds" | CONFIRMED (mechanism) / APPROXIMATION (exact seconds for any given case) |
| Aurora | Writer instance fault | Aurora-internal monitoring | Promote existing reader (fast path) or provision new writer from shared storage (slow path) | Fast path commonly cited as faster than standard RDS Multi-AZ | APPROXIMATION (AWS uses "typically" language, not an SLA number) |
| DynamoDB | N/A (multi-AZ synchronous replication is unconditional) | N/A | N/A — no customer-facing failover event for an AZ loss | N/A | CONFIRMED |
| ALB/NLB (all targets unhealthy) | Every registered target fails health checks | ELB's own target health check | Returns error to client (503 for ALB) until a target recovers | Depends entirely on why targets are unhealthy | CONFIRMED (mechanism); **503, not 502, is the documented ALB status for "no healthy targets"** — flagged here because it's an easy, specific fact to get wrong |
| NAT Gateway | AZ outage (NAT Gateway is AZ-scoped) | N/A — no automatic cross-AZ failover for a single NAT Gateway | Requires customer to have provisioned one NAT Gateway per AZ with matching per-AZ route tables | N/A (architectural, not automatic) | CONFIRMED |
| Internet Gateway | Not a documented customer-facing failure unit | N/A | N/A | N/A | APPROXIMATION (AWS doesn't publish an IGW-specific SLA/failure model; treated as "does not fail once correctly attached/routed" for modeling purposes) |
| Route 53 (failover routing policy) | Configured health check against an endpoint fails | Route 53 health checker (a separate system from ELB/ASG health checks) | Stops returning the unhealthy endpoint in DNS answers | Bounded below by the record's TTL — not instant | CONFIRMED |
| ElastiCache (Redis, Multi-AZ) | Primary node fault | ElastiCache-internal monitoring | Automatic failover to a replica | Documented as fast (seconds), specific number not universally guaranteed | APPROXIMATION |
| SQS message processing | Consumer repeatedly fails to process a message | `maxReceiveCount` exceeded on redelivery | Message moved to configured dead-letter queue | N/A (visibility-timeout-bounded per attempt) | CONFIRMED |
| Lambda (synchronous) | Function error/timeout | Caller receives the error directly | No automatic retry for synchronous invocations (caller's responsibility) | N/A | CONFIRMED |
| Lambda (asynchronous) | Function error/timeout | Lambda's internal retry tracking | Automatic retry (default 2 attempts) then DLQ/failure destination if configured | N/A | CONFIRMED |

## 3. Assessment of this simulator's own hardcoded "Cascading Failure Walkthrough" narrative

`docs/codebase/FAILURE_SYSTEM.md` §1 documents that `CASCADING_FAILURE_STAGES` in this app is a fixed, 4-stage narrative slideshow (RDS slow query → ECS thread-pool exhaustion → ALB health-check collapse → client thundering herd), entirely disconnected from the canvas — it is not computed from any real dependency graph. This section assesses whether that **fixed narrative's content** is at least a plausible real-world sequence, independent of the fact that it's hardcoded rather than computed.

| Stage | Real-world grounding | Classification |
|---|---|---|
| 1. DB query latency spike from storage saturation/lock contention | A well-documented real failure pattern (RDS/Aurora performance degradation under I/O or lock pressure is covered in AWS's own performance-troubleshooting documentation) | CONFIRMED as a real, documented failure pattern in general |
| 2. Upstream application thread-pool exhaustion from synchronous, un-timed-out calls to a slow dependency | A well-known, widely-documented distributed-systems failure pattern (sometimes called "retry storm precursor" or discussed under "bulkheading"/circuit-breaker literature); not AWS-specific, but consistent with AWS's own Well-Architected Framework guidance on setting aggressive timeouts and using circuit breakers | APPROXIMATION — real and commonly seen, but this exact causal chain (DB slowness → thread pool exhaustion) depends entirely on the calling application's own concurrency model (e.g. a fully async/non-blocking client would not exhibit this specific failure mode the same way); it is not a guaranteed AWS-service behavior, it's an application-architecture risk AWS documentation warns about |
| 3. ALB marking healthy-but-slow targets unhealthy because health-check probes share the same exhausted thread pool as application traffic | A documented real risk — AWS's own guidance explicitly warns against sharing a health-check endpoint's resources with the main request-handling path for exactly this reason | CONFIRMED as a known, AWS-documented anti-pattern risk; APPROXIMATION that it *will* happen in every case (depends on the specific web server/framework's threading model) |
| 4. Client retry storm amplifying load during a recovery attempt | A very well-documented distributed-systems phenomenon ("thundering herd"); AWS's own SDK retry guidance explicitly recommends exponential backoff with jitter specifically to prevent this | CONFIRMED as a real, well-documented risk and as the reason AWS's own SDKs implement jittered backoff by default |

**Overall verdict**: the simulator's fixed 4-stage narrative describes a **plausible and individually well-documented sequence of failure modes**, but presents them as an inevitable, deterministic chain specific to one fixed architecture (RDS + ECS + ALB), which is itself an APPROXIMATION/teaching simplification — real cascading failures are highly dependent on the specific application's concurrency model, timeout configuration, and retry policy, none of which this simulator's canvas graph currently captures at all. This is a content-plausibility finding, separate from (and in addition to) `docs/codebase/FAILURE_SYSTEM.md`'s finding that the walkthrough is disconnected from the user's actual canvas.

## 4. Region-level failure

Out of scope for the current 28-service list (no cross-Region service like Aurora Global Database or S3 Cross-Region Replication is currently simulated) — noted here as a gap for future scope expansion, not a behavior to specify today.

## 5. Cross-references

- Per-component failure mechanics in full: `NETWORKING_BEHAVIOR.md` and `SERVICE_BEHAVIOR.md`, axis 10 of each entry.
- What the simulator currently implements vs. this ground truth: `docs/codebase/FAILURE_SYSTEM.md` and `docs/codebase/REQUEST_SIMULATOR.md`.
- Flattened, sourced rule-by-rule table: `AWS_BEHAVIOR_MATRIX.md`.
