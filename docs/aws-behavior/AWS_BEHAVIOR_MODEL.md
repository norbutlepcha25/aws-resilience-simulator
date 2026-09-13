# AWS_BEHAVIOR_MODEL.md — Behavioral Specification Framework

This directory (`docs/aws-behavior/`) is a **ground-truth specification of real AWS behavior**, independent of this codebase. It exists so the simulator's actual behavior (documented separately under `docs/codebase/`) can eventually be tested *against* something authoritative, rather than only against itself. Nothing in this directory describes what the simulator does — `docs/codebase/REQUEST_SIMULATOR.md`, `NETWORKING_CURRENT_STATE.md`, etc. already do that. This directory describes what **real AWS** does, per official AWS documentation, and states explicitly where the simulator would need to change to match it (the "Simulator Requirement" column carried through every table in this directory).

No application code was modified to produce this directory.

## 1. Source hierarchy

Ranked by authority, highest first:

1. **AWS Service Authorization Reference** (`docs.aws.amazon.com/service-authorization/latest/reference/`) — canonical for IAM actions, resources, and condition keys per service.
2. **AWS official User Guides / Developer Guides** per service (e.g. *Amazon VPC User Guide*, *Amazon EC2 User Guide*, *AWS Lambda Developer Guide*) — canonical for configuration, networking, and operational behavior.
3. **AWS API Reference** per service — canonical for request/response shape, error codes, and parameter constraints.
4. **AWS IAM User Guide** — canonical for policy evaluation logic, trust policies, permissions boundaries, and SCPs.
5. **AWS official blogs / re:Post / Well-Architected Framework** — used only to corroborate, never as the sole source for a CONFIRMED rating.

Non-AWS sources (third-party blogs, Stack Overflow, course material) are **never** used as the authoritative source for a CONFIRMED rating in this directory. Where a behavior is well-known engineering folklore but not traceable to an exact AWS doc page, it is rated APPROXIMATION or UNKNOWN, never CONFIRMED, regardless of how widely believed it is.

## 2. The 13-point behavior model

Every component documented in `SERVICE_BEHAVIOR.md` and `NETWORKING_BEHAVIOR.md` is specified against the same 13 axes, in this fixed order:

| # | Axis | What it captures |
|---|---|---|
| 1 | Configuration | What a user/operator sets at creation or update time |
| 2 | Inputs | What the component accepts (protocols, event shapes, invocation types) |
| 3 | Outputs | What the component produces/returns/emits |
| 4 | Dependencies | What the component requires to function (other AWS resources, not optional integrations) |
| 5 | Connectivity | What can reach it, and over what path (public internet, VPC-internal, AWS backbone, service-to-service) |
| 6 | Networking | ENI placement, subnet requirements, protocol/port specifics |
| 7 | Security | Security Groups, NACLs, encryption, network isolation |
| 8 | IAM | Principal/action/resource shape relevant to this component (see `IAM_BEHAVIOR.md`) |
| 9 | State | What persists, what is stateless, what "health" or "status" means for this component |
| 10 | Failure modes | How it actually fails in production, and what AWS's own documentation says happens next |
| 11 | Restrictions | Hard limits, quotas, and structural constraints (not soft best-practice advice) |
| 12 | Important edge cases | Behavior a naive model would get wrong |
| 13 | Interactions with other AWS services | Cross-referenced into `SERVICE_INTERACTION_MATRIX.md` |

## 3. Classification scheme

Every individual rule/claim in every table in this directory carries exactly one of three labels:

- **CONFIRMED** — directly traceable to a specific, current AWS official documentation page or the Service Authorization Reference. This is a factual claim about AWS's documented behavior, not an inference.
- **APPROXIMATION** — the general shape of the behavior is well-documented and stable (e.g. "Security Groups are stateful"), but a specific number, timing, or edge-case detail is a reasonable simplification, an average/typical value AWS does not commit to as a hard guarantee (e.g. Multi-AZ failover "typically 60-120 seconds"), or a detail that varies by instance type/region/account settings that this spec states as a representative case rather than an exhaustive enumeration.
- **UNKNOWN** — the claim could not be verified against authoritative documentation at the time of writing, is undocumented AWS internal behavior, or is genuinely ambiguous/contradictory across AWS's own materials. An UNKNOWN entry is a flag for future verification, not a guess dressed up as fact.

There is a deliberate asymmetry: it is always acceptable to under-claim (mark something APPROXIMATION or UNKNOWN that could arguably be CONFIRMED) and never acceptable to over-claim (mark something CONFIRMED that is actually an inference or a blog-sourced convention).

## 4. Scope

This spec covers exactly the services and networking primitives relevant to this simulator, not the entire AWS service catalog (327 services exist in the simulator's own catalog per `docs/codebase/SERVICE_SYSTEM.md`, but only 28 have any simulated behavior — see that document's §3.1 for the exact list and how it was derived). `SERVICE_BEHAVIOR.md` documents those same 28 services: `alb, api_client, api_gateway, app_runner, aurora, client_ui, cloudfront, dynamodb, ec2, ecs, elasticache, eventbridge, fargate, internet_gateway, lambda, nat_gateway, nlb, privatelink, rds, route53, s3, s3_gateway_endpoint, shield, sns, sqs, step_functions, user, waf`. `client_ui`, `user`, and `api_client` are this app's own actor abstractions (not real AWS services), so they are documented briefly as "not an AWS service — modeled actor" rather than against the full 13-point model.

`NETWORKING_BEHAVIOR.md` covers the full networking primitive set requested: VPC, Subnet, Route Table, Route, Internet Gateway, NAT Gateway, Security Group, Network ACL, ENI, Elastic IP, VPC Endpoint, VPC Peering, Transit Gateway, DNS, IPv4, IPv6, Availability Zones — including Transit Gateway and VPC Peering, which this simulator does not currently model at all (their entries are marked accordingly in the Simulator Requirement column, as ground truth the simulator has not yet implemented rather than something wrong).

`IAM_BEHAVIOR.md` covers only the IAM concepts relevant to a request-path/network simulator: Principal, Action, Resource, Condition, Identity policy, Resource policy, Trust policy, Role assumption, Explicit deny, Implicit deny, Permissions boundary, Session policy, SCP, Cross-account authorization. IAM Identity Center, federation, and directory-service specifics are out of scope.

## 5. How to use this directory

- Before adding a new simulated behavior to the app, check the relevant entry here first — it is the target the new code should match, with its CONFIRMED rules taking priority over convenience.
- Before writing a conformance test against real AWS behavior (as opposed to a test of the simulator's own internal consistency, which `docs/codebase/TEST_SYSTEM.md` already covers), pull the specific row out of `AWS_BEHAVIOR_MATRIX.md` and assert against it by name.
- Where this spec and the simulator's current behavior (per `docs/codebase/`) disagree, that disagreement is a simulator gap, not an error in this spec — assume this spec is closer to real AWS unless a CONFIRMED source says otherwise.

## 6. Directory contents

| File | Contents |
|---|---|
| `AWS_BEHAVIOR_MODEL.md` | This file — framework, scope, classification scheme |
| `NETWORKING_BEHAVIOR.md` | 17 networking primitives against the 13-point model |
| `IAM_BEHAVIOR.md` | IAM authorization model, scoped to simulator-relevant concepts |
| `SERVICE_BEHAVIOR.md` | 28 simulator-relevant services against the 13-point model |
| `FAILURE_BEHAVIOR.md` | Real AWS failure modes and recovery mechanics per service/networking component |
| `SERVICE_INTERACTION_MATRIX.md` | Per-service: what can call it, what it can call, networking/IAM requirements, config constraints |
| `AWS_BEHAVIOR_MATRIX.md` | Master flattened table: `Component \| Behavior \| AWS Rule \| Source \| Simulator Requirement` |

## 7. Currency caveat

This spec reflects AWS behavior as documented at the time of writing (knowledge current to early 2026). AWS quotas, default limits, and pricing change over time even when the underlying architectural behavior does not; anywhere a specific number is cited (a quota, a timeout default, a rule limit), treat it as correct-as-of-writing and re-verify against the live AWS Service Authorization Reference / User Guide before relying on it for anything load-bearing (billing calculations, hard capacity planning). The architectural/structural rules (statefulness of Security Groups, NACL evaluation order, IAM deny-precedence, etc.) are stable AWS design decisions and are not expected to drift.
