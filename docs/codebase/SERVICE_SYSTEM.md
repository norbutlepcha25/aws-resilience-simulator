# SERVICE_SYSTEM.md — `serviceCatalog.ts` deep analysis

All counts in this document were re-verified by direct grep against the current file content during this pass (not carried over from memory).

## 1. Structure

`src/data/serviceCatalog.ts` exports one array, `AWS_SERVICES: AWSService[]`, built entirely through a single helper:

```ts
const createService = (id, name, category, role, color, desc, options?: Partial<AWSService>) => ({...})
```

Every entry supplies 6 required positional fields (id/name/category/architecturalRole/color/description) plus an optional `options` object for everything else. Confirmed defaults applied when `options` is omitted or a field is absent:

| Field | Default when unset |
|---|---|
| `inputs` | `['HTTPS', 'HTTP']` |
| `outputs` | `['HTTPS', 'HTTP']` |
| `commonInteractions` | `['HTTPS']` |
| `dependencies` | `[]` |
| `failureModes` | `['<Name> quota limit exceeded', '<Name> connection timeout']` |
| `resilienceCharacteristics` | `['Managed AWS high availability across Availability Zones']` |
| `scalabilityCharacteristics` | `['Elastic auto-scaling on demand']` |
| `securityConsiderations` | `['IAM least privilege and encryption at rest']` |
| `alternatives` | `[]` |
| `teachingNotes` | `['<Name> provides managed <category> capabilities in the AWS cloud.']` |
| `defaultConfig` | `undefined` |

## 2. Category breakdown (verified count: 327 total, 21 categories)

| Category | Count |
|---|---|
| Security, Identity & Compliance | 26 |
| Networking & Content Delivery | 26 |
| Machine Learning & AI | 26 |
| Compute | 25 |
| Management & Governance | 24 |
| Analytics | 22 |
| Databases | 18 |
| Storage | 16 |
| Internet of Things (IoT) | 16 |
| Developer Tools | 16 |
| Integration & Messaging | 15 |
| Migration & Transfer | 14 |
| Business Applications | 14 |
| Media Services | 12 |
| Containers | 12 |
| Frontend Web & Mobile | 10 |
| End User Computing | 10 |
| Cloud Financial Management | 10 |
| Robotics & Satellite | 6 |
| Blockchain & Quantum | 6 |
| Client / Ingress | 3 |
| **Total** | **327** |

`ServiceCategory` (in `types/index.ts`) additionally lists 5 backwards-compat aliases not used by any current catalog entry (legacy category name strings kept only so old exported/saved diagrams still type-check).

## 3. How much of the catalog is metadata-only vs behaviorally simulated

`defaultConfig` (capacity/replicas/multiAz/cached/timeoutMs) is threaded all the way from `createService` into `ArchitectureContext.addServiceNode` (`serviceDef.defaultConfig?.multiAz`, `.replicas`, etc. are read there) — but **zero of the 327 catalog entries ever populate it**. Confirmed via direct grep: the only occurrence of the literal text `defaultConfig:` in the file is the helper's own pass-through line (`defaultConfig: options?.defaultConfig`). This is a fully wired, fully dead field — a node's `replicas`/`multiAz` starting values come from whatever the UI/inspector sets afterward, never from the catalog.

### 3.1 The behavioral-reference test

A catalog service is **behaviorally simulated** only if its `serviceId` string literal appears in a conditional inside `requestSimulator.ts` or `networkFirewalls.ts` — i.e., something in the engine actually branches on it. This was re-verified this pass by extracting every `serviceId === '...'` and `[...].includes(...serviceId)` literal array in `requestSimulator.ts` and cross-checking each string against the live catalog id list.

**31 distinct serviceId strings appear in the simulator's conditionals.** Of those, **3 do not exist as catalog ids at all** and are therefore dead/unreachable branches:

| Referenced string | Where used | Catalog reality |
|---|---|---|
| `'auto_scaling'` | BEHAVIOR 2 (Auto-Scaling capacity check): `... || boundaryNodes/serviceNodes.some(n => n.data.serviceId === 'auto_scaling' && healthy)` | Catalog only has `ec2_auto_scaling` and `auto_scaling_mgmt` — neither string is `'auto_scaling'`. This branch of the OR can never be satisfied by any node a user can actually place. |
| `'vpc_endpoint'` | Several places checking for VPC endpoint hops / proxy-eligible nodes | Catalog has no plain `vpc_endpoint` id — only `s3_gateway_endpoint` and `privatelink` exist. Any check that ORs in `'vpc_endpoint'` alongside those two never matches on that arm. |
| `'elb'` | The public-origin proxy allow-list (`['alb', 'nlb', 'elb', 'api_gateway', 'cloudfront']`) | Catalog has no `elb` id (Classic Load Balancer isn't modeled as a placeable node under that id). This arm is unreachable. |

This is a **newly confirmed finding** from this pass, not previously reported: three literal strings in the simulator's conditionals reference service ids that do not exist in the catalog, meaning those specific OR-arms are permanently dead code. It does not currently cause an observable bug (the other arms of each OR still work for the ids that do exist), but it is inert code that looks load-bearing and isn't.

**28 of the 31 referenced strings do correspond to real catalog ids.** These 28 are the entire universe of services with **any** custom simulated behavior:

```
alb, api_client, api_gateway, app_runner, aurora, client_ui, cloudfront,
dynamodb, ec2, ecs, elasticache, eventbridge, fargate, internet_gateway,
lambda, nat_gateway, nlb, privatelink, rds, route53, s3, s3_gateway_endpoint,
shield, sns, sqs, step_functions, user, waf
```

That is **28 of 327 catalog entries (~8.6%)** with confirmed custom behavior. The remaining **299 services (~91.4%)**, regardless of how rich their catalog text (`teachingNotes`, `failureModes`, `resilienceCharacteristics`) reads, have **zero effect on simulation outcome**. Placing e.g. Amazon Redshift, AWS Glue, Amazon Kendra, or any of the 26 ML/AI services on the canvas produces a node that renders, can be dragged, can be geometrically contained in a subnet, and can be connected with edges — but the request simulator will treat it as an inert pass-through hop (falls to the generic "Forward X request" step) with none of its catalog-described failure modes ever actually triggering.

### 3.2 Classification (A/B/C/D/E) of the full catalog

- **A — Fully behaviorally simulated** (drives branching logic, success/failure, routing, or firewall decisions): `alb, api_gateway, ec2, ecs, fargate, app_runner, lambda, rds, aurora, dynamodb, elasticache, s3, sqs, sns, cloudfront, waf, shield, nat_gateway, internet_gateway, route53, nlb, eventbridge, step_functions, s3_gateway_endpoint, privatelink` (25 services with genuine conditional logic keyed to them specifically).
- **B — Partially simulated** (referenced in a generic category array shared with A-tier services, but with no service-specific branch of its own): `client_ui, api_client, user` (these gate whether a node is a valid start node / ingress origin, but have no unique behavior beyond that role).
- **C — Metadata only** (rich catalog text, zero simulation participation): the remaining 299 services. This includes almost the entirety of Security/Identity (26), ML/AI (26), Analytics (22), Management & Governance (24), Developer Tools (16), Migration (14), Business Apps (14), Media (12), Frontend (10), End User Computing (10), Cloud Financial (10), Robotics (6), Blockchain (6), IoT (16, except none), and most of Networking (VPC/subnet/security-group/NACL nodes are **boundary nodes**, a separate node type from `AWSService`, handled by `containment.ts`/`networkFirewalls.ts` rather than the catalog — see `NETWORKING_CURRENT_STATE.md`).
- **D — UI only**: none found distinct from C — every catalog entry renders identically (icon + palette entry + inspector panel) regardless of simulation tier; there is no separate "decorative-only, doesn't even render a proper icon" tier.
- **E — Unknown / indeterminate**: `auto_scaling`, `vpc_endpoint`, `elb` as referenced-but-nonexistent ids (see 3.1) — not really "services" in the catalog at all, but worth flagging as ambiguous residue from either an incomplete rename or a planned-but-never-added catalog entry.

## 4. `serviceKnowledgeBase.ts` cross-check

Only 3 of 327 services (~0.9%) have hand-curated `ServiceNoteKnowledge` entries in `SERVICE_KNOWLEDGE_BASE` (confirmed via `grep -c "serviceId: '"` = 3 during the earlier pass of this analysis). `getServiceKnowledge()` synthesizes a fallback summary from the catalog's own fields for everything else, then a final generic fallback for totally unrecognized ids. This is a separate axis from simulation-behavior tier A/B/C above — a service can be catalog-metadata-rich (long `teachingNotes`) and simulation-tier-C, or knowledge-base-curated and simulation-tier-A; the two systems don't track each other.

## 5. Practical implication for anyone building on this system

The catalog's apparent size (327 services, 21 categories) considerably overstates the simulator's actual behavioral surface. A new contributor reading only `serviceCatalog.ts` would reasonably assume most services participate in the simulation in some differentiated way (the `failureModes`/`teachingNotes` text reads that way); in reality, whether a node does anything beyond "exists, can be dragged, can be connected" is entirely determined by an 28-id allow-list buried inside `requestSimulator.ts`, not by anything declared on the service definition itself. Adding real behavior for a new service currently means adding another literal-string branch to that file (see `REQUEST_SIMULATOR.md` for the anti-pattern this produces), not adding a field to the catalog entry.
