# SIMULATION_GAPS.md

Every hard-coded, service-id-keyed conditional in `requestSimulator.ts` (and its sibling `costCalculator.ts`, before its recent refactor), each flagged as a candidate for extraction into a per-service **behavior adapter** — a named module implementing a common interface (`canHandle(node) / evaluate(context)`), analogous to the pricing-module registry `costCalculator.ts` was already refactored into (`docs/codebase/ANALYSIS_ENGINE.md` §4). This file identifies *where* the giant conditional lives; `PRIORITIZED_REFACTOR_PLAN.md` item 1 proposes the concrete extraction.

## Why this matters (not just style)

Every finding in `NETWORKING_GAPS.md`, `IAM_GAPS.md`, and `SERVICE_GAPS.md` that requires a code change requires editing this **same ~850-line function**, and reasoning about where in its fixed execution order the new check must slot in relative to 8 unrelated existing behaviors (WAF inspection, auto-scaling, NAT translation, CloudFront caching, ALB routing, DB/cache/queue handling, VPC endpoint routing, IGW/egress checks, firewall evaluation) — none of which are isolated from each other. This is the single biggest structural risk multiplier in the codebase: a change intended to fix the NACL implicit-deny bug (`NETWORKING_GAPS.md`) is physically adjacent, in the same file, to completely unrelated ALB/NAT/auto-scaling logic, raising the chance of an unrelated regression with every edit.

## Inventory of hard-coded, serviceId-keyed conditionals in `requestSimulator.ts`

Numbered by position in the function (matches `docs/codebase/REQUEST_SIMULATOR.md`'s Behavior-block numbering).

| # | Conditional | Serves as | Adapter candidate |
|---|---|---|---|
| 1 | `if (['waf', 'shield'].includes(currentNode.data.serviceId))` | Perimeter/WAF inspection | `PerimeterInspectionAdapter` (would need to stop conflating `waf`/`shield` — see `SERVICE_GAPS.md`) |
| 2 | `const isCompute = ['ec2', 'ecs', 'lambda', 'fargate', 'app_runner'].includes(...)` + `const isServerless = ['lambda', 'fargate', 'app_runner'].includes(...)` | Auto-scaling / capacity-saturation check | `ComputeCapacityAdapter` |
| 2b | `nodes.some(n => n.data.serviceId === 'auto_scaling' ...)` | Dead branch — `auto_scaling` is not a real catalog id (`docs/codebase/SERVICE_SYSTEM.md` §3.1) | Delete or fix as part of the same adapter extraction |
| 3 | `if (currentNode.data.serviceId === 'nat_gateway')` | NAT placement + SNAT narration | `NatGatewayAdapter` |
| 4 | `if (currentNode.data.serviceId === 'cloudfront')` | Edge cache hit/miss | `CloudFrontAdapter` |
| 5 | `if (['alb', 'api_gateway'].includes(currentNode.data.serviceId))` | Target-group health / routing | `LoadBalancerAdapter` (must add `nlb` — see `SERVICE_GAPS.md` finding) |
| 6 | `if (['ecs', 'ec2', 'lambda', 'fargate'].includes(currentNode.data.serviceId))` → `dbTarget`/`cacheTarget`/`queueTarget` sub-checks keyed on `['rds','dynamodb','aurora']` / `'elasticache'` / `'sqs'` | Compute→data-tier interaction (DB failover, cache fallback, queue enqueue) | `DataTierInteractionAdapter`, likely split into `DatabaseAdapter` + `CacheAdapter` + `QueueAdapter` |
| 6B | `['s3_gateway_endpoint', 'vpc_endpoint', 'privatelink'].includes(n.data.serviceId)` | VPC endpoint hop | `VpcEndpointAdapter` (must drop the dead `vpc_endpoint` id and add the missing firewall check — see `NETWORKING_GAPS.md` §Endpoints) |
| 7A | `vpcHostedIngressServices = ['alb', 'nlb', 'elb', 'api_gateway', 'app_runner', 'ec2', 'ecs', 'fargate']` | IGW attachment gate | Belongs on a `NetworkPathAdapter` / could be a Route-Table-derived check once that entity exists (`NETWORKING_GAPS.md` §Route Table) |
| 7-event | `isManagedEventTrigger = protocol === 'Event' && ['lambda', 'sns', 'sqs', 'eventbridge', 'step_functions'].includes(...)` | S3-style event-trigger hop | `EventTriggerAdapter` (currently a binary edge-type check, not content-based pattern matching — `SERVICE_GAPS.md`) |
| 7B | `isIngressProxy = ['alb', 'nlb', 'elb', 'api_gateway', 'cloudfront'].includes(...)` | Direct-public-to-private block exemption | Same `NetworkPathAdapter` as 7A |
| 7C | `!['privatelink', 'vpc_endpoint', 's3_gateway_endpoint'].includes(...)` + `['api_client', 'user'].includes(...)` + `!['rds', 'dynamodb'].includes(...)` | Private-subnet egress (NAT/endpoint) | Same `NetworkPathAdapter`/`VpcEndpointAdapter` split |
| post-loop | `['ec2', 'ecs', 'lambda', 'fargate'].includes(...)` / `['rds', 'aurora', 'dynamodb'].includes(...)` | Stateless-NACL-return node selection | Already fixed to be path-scoped (`docs/codebase/REQUEST_SIMULATOR.md` §6); the *category lists* themselves remain hard-coded and would still benefit from adapter extraction |

**Total distinct hard-coded serviceId-array/string checks in this one function: 15 sites**, several containing 2-3 nested sub-checks each (compute→data-tier alone has 3). This is the concrete, file-and-line-level version of the "giant conditional chain keyed on service type" anti-pattern flagged at the very start of this project's audit history and now fully enumerated.

## Same pattern, already fixed once (proof the extraction is tractable)

`costCalculator.ts`'s `calculateNodeCost` was an identically-shaped 15-branch `if/else if` chain and was successfully extracted into a `PricingModule` registry with **zero behavior change** (`docs/codebase/ANALYSIS_ENGINE.md` §4, tests 34-36 unchanged). This is direct, in-repo evidence that the same extraction pattern applies cleanly to `requestSimulator.ts` — the risk of this refactor is well-understood and has already been retired once in this codebase, not a novel or speculative undertaking.

## What an adapter interface would need to support (derived from the inventory above)

Any per-service adapter extracted from this function needs, at minimum:
- Read access to `currentNode`, `downstreamNodes`, `outgoingEdges`, `boundaryNodes`, `scenario`, and mutable `currentTimestamp`/`stepNumber` (to push its own steps).
- A way to signal one of: continue to next behavior in this same hop, advance to a specific next node (`continue`), or terminate the whole simulation (`break`, with a final status/summary).
- Because several behaviors are **order-dependent relative to each other** (WAF must run before ALB routing; the compute→DB check must run before the generic 7A/7B/7C path resolution), the registry cannot simply be an unordered `Record<string, Adapter>` the way `costCalculator.ts`'s pricing registry safely was (pricing modules are mutually independent; simulation behaviors are not) — an ordered pipeline of adapters, each with an explicit "does this apply to the current hop" predicate, is the correct shape, not a flat id→handler map. This is the one respect in which this refactor is *harder* than the cost-calculator precedent, and should be called out explicitly in the refactor plan rather than assumed to be equally mechanical.

## Non-serviceId hard-coded assumptions worth flagging alongside these

- The WAF/Shield malicious-path detector is a **single fixed regex** (`/sql|select|insert|delete|drop|admin|eval|script/i`), not a rule set — this is a hard-coded pattern, not a hard-coded service id, but the same "should be data/config, not inline code" critique applies.
- CloudFront's cache-eligibility check (`scenario.path.includes('/static') || .endsWith('.png'/'.js'/'.css')`) is similarly a fixed, inline heuristic rather than a configurable cache-behavior path-pattern list, despite real CloudFront's cache behaviors being exactly that (an ordered, user-configured list of path patterns — `docs/aws-behavior/SERVICE_BEHAVIOR.md` CloudFront §11).

## Summary

| Finding | Severity | Status |
|---|---|---|
| 15-site hard-coded serviceId conditional chain in `requestSimulator.ts` | HIGH | INCORRECT (architectural — not a single wrong fact, a wrong shape that makes every other fact harder to fix safely) |
| Adapter ordering is a real added complexity vs. the cost-calculator precedent | MEDIUM | N/A (a risk to plan for, not yet a defect) |
| Fixed regex/heuristics standing in for configurable rule sets (WAF pattern, CloudFront cache paths) | LOW | APPROXIMATION |
