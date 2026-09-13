# SERVICE_BEHAVIOR.md

The 28 services with confirmed simulated behavior in this app (`docs/codebase/SERVICE_SYSTEM.md` §3.1), each against the 13-point model from `AWS_BEHAVIOR_MODEL.md` §2. Networking primitives that also appear in this list (`internet_gateway`, `nat_gateway`, `s3_gateway_endpoint`, `privatelink`) are cross-referenced to `NETWORKING_BEHAVIOR.md` rather than duplicated. Classification: CONFIRMED / APPROXIMATION / UNKNOWN.

---

## Client / Ingress actors (not real AWS services)

### `user`, `client_ui`, `api_client`

These three ids are this app's own modeling abstractions for "traffic origin" — an end user's browser/device, this app's own reference web frontend, and an external API caller, respectively. None corresponds to a purchasable AWS service or resource type; there is nothing to specify against the 13-point model, and no AWS documentation applies. — CONFIRMED (as a statement about what these ids are, per `docs/codebase/SERVICE_SYSTEM.md`).

---

## Edge / Perimeter

### Amazon CloudFront

1. **Configuration**: a distribution with one or more origins (S3, ALB, custom HTTP origin, MediaStore, etc.), cache behaviors per path pattern, TTL settings, optional WAF association, optional custom domain + ACM certificate. — CONFIRMED (*Amazon CloudFront Developer Guide*).
2. **Inputs**: HTTP/HTTPS requests from clients worldwide, routed to the nearest edge location (Point of Presence). — CONFIRMED.
3. **Outputs**: cached responses served directly from the edge on a cache hit; on a cache miss, forwards to the configured origin and caches the response per the behavior's TTL rules. — CONFIRMED.
4. **Dependencies**: at least one origin. — CONFIRMED.
5. **Connectivity**: globally distributed edge network: client → nearest edge PoP → (on miss) origin, over the AWS backbone where possible. — CONFIRMED.
6. **Networking**: does not require the origin to be publicly reachable if using **Origin Access Control** (for S3) or a private ALB reachable via VPC origins (a newer CloudFront feature allowing private-subnet ALB/EC2 origins without public exposure). — CONFIRMED.
7. **Security**: can attach AWS WAF Web ACLs for edge-level request inspection; supports HTTPS-only viewer/origin protocol policies; Origin Access Control restricts direct public access to an S3 origin bucket. — CONFIRMED.
8. **IAM**: `cloudfront:CreateDistribution`, etc.; origin access is typically authorized via an S3 bucket policy trusting the specific distribution (OAC) rather than a CloudFront-side IAM action. — CONFIRMED.
9. **State**: `InProgress` / `Deployed` for distribution config changes (propagation to all edge locations takes time, typically minutes). — CONFIRMED.
10. **Failure modes**: origin unavailability surfaces as a 5xx from CloudFront (with configurable custom error responses/failover origin groups); does not itself have a documented "outage unit" comparable to a single-AZ resource, since it's a global edge service. — CONFIRMED.
11. **Restrictions**: cache behaviors matched by path pattern, evaluated in listed order, first match wins (order matters, similar in spirit to NACL rule evaluation but for path patterns, not network rules). — CONFIRMED.
12. **Edge cases**: a cache HIT never contacts the origin at all — origin health/availability is entirely irrelevant for a request that hits cache, which is exactly the "origin offloading" behavior this simulator models (`docs/codebase/REQUEST_SIMULATOR.md` Behavior 4). — CONFIRMED.
13. **Interactions**: origin can be S3, ALB, or custom HTTP; commonly paired with AWS WAF and Route 53 (alias record to the distribution's domain name).

### Amazon Route 53

1. **Configuration**: hosted zones containing DNS records (A/AAAA/CNAME/Alias/MX/TXT/etc.); routing policies (simple, weighted, latency-based, failover, geolocation, multivalue). — CONFIRMED (*Amazon Route 53 Developer Guide*).
2-3. **Inputs/Outputs**: DNS queries in, resolved IP addresses (or alias target resolution) out. — CONFIRMED.
5. **Connectivity**: operates as the DNS layer, resolved before any actual application-layer connection is attempted; a client cannot reach anything by IP through Route 53 without first performing this resolution step (unless it already has a cached/hardcoded IP). — CONFIRMED.
9. **State**: Route 53 health checks can mark an endpoint unhealthy and automatically stop returning it in DNS answers for **failover routing policy** configurations — this is Route 53's own, DNS-layer failure-detection mechanism, separate from an ALB's target health checks. — CONFIRMED.
10. **Failure modes**: DNS TTL caching means a failover via Route 53 is not instantaneous — clients (and intermediate resolvers) continue using a cached (now-stale) answer until the record's TTL expires, meaning DNS-based failover has an inherent propagation delay bounded by the record's TTL. — CONFIRMED, and an important edge case any simulator claiming instant DNS-based failover would be over-simplifying.
13. **Interactions**: commonly the entry point directing traffic to CloudFront, an ALB/NLB, or S3 website endpoints via Alias records (Alias records, unlike CNAMEs, are usable at a zone apex and are resolved internally by Route 53 without an extra client-visible DNS hop).

### AWS WAF

1. **Configuration**: a Web ACL containing an ordered list of rules (managed rule groups like the AWS Core Rule Set, or custom rules) each with a match condition and an action (Allow/Block/Count/CAPTCHA/Challenge); associated with CloudFront, ALB, API Gateway, AppSync, or Cognito. — CONFIRMED (*AWS WAF Developer Guide*).
2. **Inputs**: every request passing through the associated resource, inspected before it reaches the origin/backend. — CONFIRMED.
5. **Connectivity**: sits in-line at the edge/entry point — a WAF Block action means the backend never sees the request at all. — CONFIRMED.
6. **Networking**: operates at Layer 7 (HTTP), inspecting headers/body/URI/query string — not a network-layer (Security Group/NACL) construct. — CONFIRMED.
10. **Failure modes**: none of its own; a "failure" is a rule misconfiguration (too permissive or a false-positive block). — CONFIRMED.
12. **Edge cases**: rules are evaluated **in the priority order configured**, and (depending on rule action) can short-circuit remaining rule evaluation — a Block action stops evaluation immediately, similar in spirit to NACL first-match semantics but for HTTP request attributes, not IP/port. This simulator's regex-based malicious-pattern detection (`docs/codebase/REQUEST_SIMULATOR.md` Behavior 1) is a deliberate, simplified stand-in for a managed rule group's actual signature set (AWS's real Core Rule Set covers a broad, continuously-updated set of OWASP Top 10 patterns via many discrete rules, not one regex) — CONFIRMED that real AWS WAF's Core Rule Set exists and targets OWASP Top 10 categories; APPROXIMATION that the simulator's single regex is presented as a faithful stand-in for it (it is a deliberate simplification for teaching purposes, not a claim of behavioral equivalence).
13. **Interactions**: attaches to CloudFront, ALB, API Gateway (REST APIs), AppSync, Cognito user pools.

### AWS Shield (Standard / Advanced)

1. **Configuration**: Shield Standard is automatically enabled at no extra cost for all AWS customers, providing protection against common network/transport-layer (L3/L4) DDoS attacks; Shield Advanced is an additional paid subscription providing enhanced detection, DDoS cost protection, and access to the AWS DDoS Response Team. — CONFIRMED (*AWS Shield Developer Guide*).
5. **Connectivity**: operates transparently at the network edge (integrated with CloudFront, Route 53, Global Accelerator, and EC2/ELB when Advanced is enabled) — not a resource a customer configures rules within the way WAF is. — CONFIRMED.
7. **Security**: primarily targets volumetric/protocol DDoS (L3/L4); it is explicitly **not** a substitute for AWS WAF's L7 request-inspection role — the two are commonly paired, each covering a different attack layer. — CONFIRMED.
10. **Failure modes**: none customer-configurable; Shield's own detection/mitigation is an AWS-managed backend process. — CONFIRMED.
12. **Edge cases**: this simulator's current code treats `waf` and `shield` identically (both trigger the same malicious-path regex check — see `docs/codebase/REQUEST_SIMULATOR.md` Behavior 1) — this is a simplification: real Shield does not perform application-layer signature inspection the way WAF does; conflating the two is an APPROXIMATION in the simulator, not real AWS behavior, and is called out here explicitly so a future conformance test can flag it as a known, deliberate divergence rather than an oversight.
13. **Interactions**: layers with CloudFront, Route 53, Global Accelerator, ALB/NLB, EC2 Elastic IPs.

---

## Compute

### Amazon EC2

1. **Configuration**: instance type (determines vCPU/RAM/network performance), AMI, subnet placement (exactly one), attached Security Groups, optional EIP, EBS volumes, IAM instance profile. — CONFIRMED (*Amazon EC2 User Guide*).
4. **Dependencies**: a subnet (and therefore a VPC); an AMI. — CONFIRMED.
5. **Connectivity**: governed entirely by its ENI's subnet routing + Security Groups + subnet NACL (see `NETWORKING_BEHAVIOR.md` §9) — EC2 itself has no networking logic beyond owning that ENI. — CONFIRMED.
9. **State**: `pending → running → stopping → stopped → terminated`; a `stopped` instance releases its auto-assigned public IP (but retains an associated EIP) and its instance store data (if any), while EBS-backed root volumes persist. — CONFIRMED.
10. **Failure modes**: underlying host hardware failure/retirement (documented AWS-initiated maintenance events), OS-level crash, or an application-level health-check failure as observed by an attached ALB target group — none of these are things EC2 "recovers from" on its own without either an Auto Scaling Group replacing the instance or EC2 Auto Recovery (a specific opt-in feature for certain instance types that automatically recovers an instance on the same host after certain hardware failures, distinct from full replacement). — CONFIRMED.
11. **Restrictions**: exactly one primary ENI/subnet per instance at launch (additional ENIs can be attached, each still pinned to a subnet in the instance's own AZ); vCPU-based service quotas per instance family per Region. — CONFIRMED.
12. **Edge cases**: a standalone EC2 instance with no Auto Scaling Group is a documented, textbook single point of failure — AWS's own Well-Architected Framework explicitly recommends Auto Scaling Groups spanning multiple AZs for exactly this reason. — CONFIRMED.
13. **Interactions**: registers as a target behind an ALB/NLB target group; commonly connects outbound to RDS/DynamoDB/ElastiCache/S3; can assume an IAM role via an instance profile.

### Amazon ECS

1. **Configuration**: a cluster running tasks (groups of containers) defined by task definitions, on either EC2 capacity (customer-managed instances) or AWS Fargate (serverless) launch type; services maintain a desired task count and can be attached to an ALB/NLB target group. — CONFIRMED (*Amazon ECS Developer Guide*).
5. **Connectivity**: with `awsvpc` network mode (required for Fargate, optional for EC2 launch type), each task gets its **own ENI** in a chosen subnet with its own Security Groups — task-level network isolation, not host-level. — CONFIRMED.
9. **State**: task lifecycle `PROVISIONING → PENDING → RUNNING → STOPPED`; ECS service scheduler continuously reconciles running task count against desired count, replacing stopped/unhealthy tasks automatically. — CONFIRMED.
10. **Failure modes**: a task failing its container health check (or an attached ALB target-group health check) is stopped and replaced by the service scheduler, which is the mechanism behind this simulator's ALB-failover-then-implicit-ASG-style narration (`docs/codebase/REQUEST_SIMULATOR.md` Behavior 5) — though ECS's own service scheduler, not a literal EC2 Auto Scaling Group, is what actually performs the replacement when tasks (not underlying EC2 hosts) are the unit of recovery. — CONFIRMED, with the note that the simulator's narration sometimes attributes ECS task replacement to "the Auto Scaling Group," which is an APPROXIMATION/conflation worth flagging for a future conformance test (see `SERVICE_INTERACTION_MATRIX.md`).
13. **Interactions**: registers tasks as ALB/NLB targets; pulls images from ECR; commonly assumes an IAM task role for AWS API access; can be triggered/orchestrated by EventBridge or Step Functions.

### AWS Fargate

1. **Configuration**: a launch type for ECS (and EKS) — no EC2 instances to manage; vCPU/memory specified per task, AWS provisions and manages the underlying compute transparently. — CONFIRMED (*AWS Fargate documentation*).
5. **Connectivity**: always uses `awsvpc` mode — every task gets its own ENI in a customer-chosen subnet, same networking model as ECS `awsvpc` tasks. — CONFIRMED.
9-10. **State/Failure**: same task-lifecycle and scheduler-driven replacement model as ECS (§ above), since Fargate is a launch type of ECS/EKS, not a separately-modeled compute primitive. — CONFIRMED.
12. **Edge cases**: "serverless" here means no customer-visible host to lose/patch/reboot — a Fargate task's availability story is about task placement and scheduler replacement, not host hardware failure the way standalone EC2 is. This is why this simulator's auto-scaling check treats `fargate` (along with `lambda`/`app_runner`) as inherently `isServerless` and therefore immune to the single-instance-saturation failure mode regardless of replica count (`docs/codebase/REQUEST_SIMULATOR.md` Behavior 2). — CONFIRMED as directionally correct; APPROXIMATION in that real Fargate task capacity is not literally infinite/instant (task launch takes real time and is subject to its own quotas), which the simulator's binary "serverless = never saturates" treatment does not model.
13. **Interactions**: same as ECS.

### AWS App Runner

1. **Configuration**: a fully-managed service that builds and deploys a container/source-repo directly, auto-scaling and load-balancing built in without the customer provisioning an ALB or ECS cluster explicitly. — CONFIRMED (*AWS App Runner Developer Guide*).
5. **Connectivity**: publicly reachable by default via an App-Runner-managed HTTPS endpoint; can be configured with a VPC connector for private outbound connectivity to VPC resources (e.g. a private RDS instance) without needing a customer-managed ALB. — CONFIRMED.
9-10. **State/Failure**: App Runner manages its own instance health and replacement transparently — there is no customer-visible target group or Auto Scaling Group to configure. — CONFIRMED.
13. **Interactions**: can reach VPC resources via an App Runner VPC connector (a managed ENI-based egress path conceptually similar in purpose to a NAT Gateway's role for private subnets, but specific to App Runner's own outbound connectivity, not general-purpose).

### AWS Lambda

1. **Configuration**: a function (code + runtime + memory allocation, which also determines proportional vCPU); optional VPC configuration (subnets + Security Groups) for private-resource access; a resource-based policy controlling who/what can invoke it; an execution role (IAM) determining what it can call. — CONFIRMED (*AWS Lambda Developer Guide*).
2. **Inputs**: synchronous invocations (e.g. via API Gateway, ALB, direct SDK call) or asynchronous/event-source invocations (S3 event notifications, SQS, SNS, EventBridge, DynamoDB Streams, etc.), each with different retry/error-handling semantics. — CONFIRMED.
5. **Connectivity**: a Lambda function **not** configured with a VPC runs with direct internet/AWS-service access via the Lambda-managed network (no customer subnet); a function **configured with a VPC** gets ENIs in the specified subnets and is then subject to that subnet's routing/NACL/Security-Group rules exactly like any other ENI-backed resource — including needing a NAT Gateway or VPC Endpoint for internet/AWS-service access if placed in a private subnet. — CONFIRMED, and a commonly-misunderstood edge case: adding a VPC config to a Lambda function *removes* its default internet access rather than adding private access on top of existing internet access.
9. **State**: stateless between invocations by design; a "cold start" (provisioning a new execution environment) occurs when no warm environment is available, adding latency; a "warm" invocation reuses an existing environment. — CONFIRMED.
10. **Failure modes**: a synchronous invocation failure returns an error to the caller directly; an asynchronous invocation failure is retried automatically (default 2 retries) and then, if configured, sent to a Dead Letter Queue or an on-failure destination; timeout (configurable, max 15 minutes) and concurrency-limit throttling are the two most common documented failure modes. — CONFIRMED.
11. **Restrictions**: max execution timeout 15 minutes; account-level concurrent-execution quota (soft, raisable) shared across all functions in a Region unless reserved/provisioned concurrency is configured per-function. — CONFIRMED.
13. **Interactions**: invoked by API Gateway, ALB, S3 (event notifications), SQS, SNS, EventBridge, Step Functions, DynamoDB Streams, and many others; can itself call any AWS API its execution role permits.

---

## Load Balancing / API Ingress

### Application Load Balancer (ALB)

1. **Configuration**: listeners (port/protocol) with rules routing to target groups based on path/host/header conditions; deployed across chosen subnets in multiple AZs (at least 2 subnets in 2 different AZs required). — CONFIRMED (*Elastic Load Balancing / Application Load Balancers User Guide*).
5. **Connectivity**: `internet-facing` (public subnets, gets a public DNS name resolving to public IPs) or `internal` (private subnets only, reachable only from within the VPC or connected networks) — this is a configuration choice, not inferred from subnet placement automatically (though an internet-facing ALB does still need its subnets to actually have IGW routes to be reachable, consistent with the general public/private subnet model in `NETWORKING_BEHAVIOR.md` §2). — CONFIRMED.
6. **Networking / target health**: performs its own health checks against registered targets (configurable path/interval/thresholds) **independent of** any Auto Scaling Group health check — an unhealthy target is removed from active rotation for new requests but is not itself terminated/replaced by the ALB (that requires an attached Auto Scaling Group or ECS service scheduler acting on its own separate health signal, which may or may not be the same health check). — CONFIRMED, and an important edge case this simulator's own doc (`docs/codebase/REQUEST_SIMULATOR.md` Behavior 5) flags: the ALB's own health-check-driven routing-away-from-failed-targets is real and immediate; the *replacement* of that failed target is a separate mechanism (ASG/ECS scheduler) that the ALB itself does not perform.
7. **Security**: has its own Security Group (attached to the ALB's nodes); operates at Layer 7 (HTTP/HTTPS), can terminate TLS. — CONFIRMED.
9. **State**: target health states `initial / healthy / unhealthy / unused / draining`. — CONFIRMED.
10. **Failure modes**: all registered targets unhealthy → ALB returns a 503 (not 502 — worth noting since this simulator's own code returns 502 for this exact scenario, a discrepancy documented in `SERVICE_INTERACTION_MATRIX.md`); an AZ outage taking down all targets in that AZ is mitigated automatically by the ALB continuing to route to healthy targets in other AZs, provided the ALB itself is configured across multiple AZs. — CONFIRMED for the multi-AZ resilience behavior; **the exact all-targets-down status code is the specific fact to re-verify** — AWS documentation and observed behavior for ALB use 503 Service Unavailable for "no healthy targets," distinct from 502 Bad Gateway (which ALB returns for a malformed response *from* a target, a different condition entirely).
13. **Interactions**: routes to EC2, ECS/Fargate tasks, Lambda functions (yes — ALB can target Lambda directly), or IP addresses as targets.

### Network Load Balancer (NLB)

1. **Configuration**: operates at Layer 4 (TCP/UDP/TLS passthrough), extreme low latency and high throughput, one static IP (or EIP) per AZ. — CONFIRMED (*Elastic Load Balancing / Network Load Balancers User Guide*).
5. **Connectivity**: preserves the client's source IP address all the way to the target by default (unlike an ALB, which by default presents its own IP as the source unless X-Forwarded-For is used at the app layer) — this is a commonly-tested distinguishing fact between ALB and NLB. — CONFIRMED.
9-10. **State/Failure**: health checks and target states conceptually parallel ALB's, but evaluated at the connection/TCP level rather than HTTP level. — CONFIRMED.
13. **Interactions**: same target types as ALB (instances, IPs, Lambda); commonly used for non-HTTP protocols or extreme performance requirements, or as the entry point for a PrivateLink service (NLB is the required front-end for a VPC Endpoint Service).

### Amazon API Gateway

1. **Configuration**: REST API or HTTP API (two distinct API types with different feature sets/pricing), resources/methods mapped to integrations (Lambda, HTTP backend, AWS service action, mock); optional usage plans/API keys, custom domain, and authorizers (IAM, Lambda authorizer, Cognito user pools). — CONFIRMED (*Amazon API Gateway Developer Guide*).
5. **Connectivity**: a fully-managed, regional or edge-optimized public endpoint by default; can be made **private** (reachable only via a VPC Interface Endpoint, not the public internet at all) for internal-only APIs. — CONFIRMED, and this is why this app's `containment.ts` deliberately excludes `api_gateway` from `SUBNET_REQUIRED_SERVICE_IDS` (per `docs/codebase/NETWORKING_CURRENT_STATE.md` §2) — a standard public API Gateway has no VPC placement/ENI of its own at all, unlike an ALB/NLB.
7. **Security**: request-level authorization via IAM policies, Lambda authorizers, or Cognito; can integrate with AWS WAF (REST APIs). — CONFIRMED.
10. **Failure modes**: integration timeout (max 29 seconds for the API Gateway-to-backend leg, a hard documented limit distinct from the backend's own timeout, e.g. Lambda's 15-minute max) is a commonly-encountered, specifically-documented restriction. — CONFIRMED.
13. **Interactions**: integrates with Lambda, any HTTP backend (including a private ALB/NLB via VPC Link), and other AWS service APIs directly.

---

## Data / Storage

### Amazon RDS

1. **Configuration**: a managed relational database instance (engine choice: MySQL/PostgreSQL/MariaDB/Oracle/SQL Server; Aurora is documented separately below), instance class, storage type/size, subnet group (a set of subnets across multiple AZs the instance can be placed in), optional Multi-AZ. — CONFIRMED (*Amazon RDS User Guide*).
5. **Connectivity**: lives on an ENI within a chosen subnet (from its DB subnet group); reachability governed by the standard subnet routing + Security Group + NACL model, same as EC2. — CONFIRMED.
9. **State — Multi-AZ mechanics**: a Multi-AZ RDS deployment maintains a **synchronous** standby replica in a second AZ; on primary failure, RDS automatically fails over by **updating the DB instance's DNS CNAME** to point at the standby, which is then promoted to primary — client applications reconnecting after the DNS change (and any local DNS caching) reach the new primary transparently, without a database endpoint/connection-string change. — CONFIRMED (*Amazon RDS User Guide — Multi-AZ deployments*).
10. **Failure modes**: AWS documents typical Multi-AZ failover completion in **60-120 seconds** (varies by workload/engine, not a hard guarantee) — CONFIRMED as a documented typical range, APPROXIMATION as an exact number for any specific deployment (this simulator's own ~35-second failover narration, per `docs/codebase/REQUEST_SIMULATOR.md` Behavior 6, is faster than AWS's own documented typical range and should be flagged as a simplification, not presented as a verified AWS timing fact). A **Single-AZ** RDS instance has no automatic failover at all — an outage of its AZ or an underlying host failure is a full outage of that database until manual intervention/AWS-side recovery. — CONFIRMED.
11. **Restrictions**: a DB subnet group must span at least 2 AZs even for a Single-AZ instance (a structural RDS requirement, in case Multi-AZ is enabled later or for maintenance-window relocation), though a Single-AZ instance itself only ever runs in one of those AZs at a time. — CONFIRMED.
13. **Interactions**: connected to from application compute tiers (EC2/ECS/Lambda); read replicas (asynchronous, distinct from a synchronous Multi-AZ standby) can offload read traffic.

### Amazon Aurora

1. **Configuration**: AWS's own MySQL/PostgreSQL-compatible engine with a distributed, shared storage layer decoupled from compute instances; an Aurora cluster has one primary writer instance and can have 0-15 reader instances, all sharing the same underlying storage volume replicated across (typically) 3 AZs automatically. — CONFIRMED (*Amazon Aurora User Guide*).
9. **State — inherent Multi-AZ storage**: Aurora's storage layer is **automatically replicated across multiple AZs regardless of whether "Multi-AZ" is separately toggled** — this is a structural difference from RDS-for-MySQL/PostgreSQL, where Multi-AZ is an explicit, separate, opt-in feature. Aurora's own "Multi-AZ" concept mainly concerns whether a *reader instance* exists in a second AZ to serve as a fast-failover target for the writer role (failover to an existing reader is faster than Aurora provisioning a brand new instance from the shared storage). — CONFIRMED, and this is exactly why this simulator's `requestSimulator.ts` treats `serviceId === 'aurora'` as inherently Multi-AZ-capable for failover purposes regardless of its own `multiAz` flag (`docs/codebase/REQUEST_SIMULATOR.md` Behavior 6) — a CONFIRMED-accurate simplification of a real, documented Aurora architectural property, not an invented shortcut.
10. **Failure modes**: Aurora failover to an existing reader is documented as typically faster than standard RDS Multi-AZ failover (often cited as under 30 seconds), specifically because it's promoting an already-running, already-replicated reader rather than needing external storage attach/replay. — APPROXIMATION on the exact timing (AWS documents "typically" language, not a guaranteed SLA number).
13. **Interactions**: same application-connectivity model as RDS; Aurora Global Database extends this across Regions (out of scope for this simulator).

### Amazon DynamoDB

1. **Configuration**: a fully-managed NoSQL key-value/document store; on-demand or provisioned capacity mode; no VPC placement — accessed via the DynamoDB public API endpoint (or a Gateway VPC Endpoint / Interface Endpoint for private access) rather than living inside a customer subnet. — CONFIRMED (*Amazon DynamoDB Developer Guide*).
5. **Connectivity**: no ENI of its own in the customer's VPC by default; a private subnet resource reaches DynamoDB either via a NAT Gateway (public API call over the internet path) or — the AWS-recommended, free approach — a **Gateway VPC Endpoint** (see `NETWORKING_BEHAVIOR.md` §11a). — CONFIRMED.
9. **State — inherent multi-AZ**: DynamoDB **replicates data synchronously across (at least) 3 AZs within a Region automatically, for every table, with no configuration required** — there is no "Single-AZ DynamoDB" mode. — CONFIRMED (*Amazon DynamoDB Developer Guide — Reliability*), and this is exactly why `docs/codebase/SERVICE_SYSTEM.md`'s cross-referenced `rulesEngine.ts` treats any DynamoDB presence as satisfying the "Multi-AZ database" positive-scoring condition unconditionally.
10. **Failure modes**: throttling (when request rate exceeds provisioned/burst capacity) is DynamoDB's primary documented application-visible failure mode in provisioned mode; on-demand mode is designed to scale automatically to avoid this, within documented (large but real) scaling-rate limits. — CONFIRMED.
13. **Interactions**: DynamoDB Streams can trigger Lambda; commonly paired with a Gateway VPC Endpoint from private-subnet compute.

### Amazon S3

1. **Configuration**: a globally-unique-named bucket, per-object storage class, versioning, bucket policy, optional event notifications (to Lambda/SQS/SNS/EventBridge). — CONFIRMED (*Amazon S3 User Guide*).
5. **Connectivity**: a regional service reached via its public HTTPS endpoint (or a Gateway/Interface VPC Endpoint for private access) — S3 itself has no VPC/subnet placement; access control is via bucket policy + IAM + (optionally) a VPC Endpoint policy, not Security Groups/NACLs, since there's no customer-side ENI to attach them to. — CONFIRMED.
9. **State**: 11 nines of documented annual durability design target for Standard storage classes; multiple storage classes trade retrieval latency/cost for storage cost (Standard, Intelligent-Tiering, Standard-IA, One Zone-IA, Glacier variants, Deep Archive). — CONFIRMED.
10. **Failure modes**: a request can fail due to bucket policy/IAM denial, object not existing, or (rarely, since S3 is designed for very high availability) a regional service-level event; **One Zone-IA is the one storage class explicitly documented as NOT resilient to the loss of its single AZ** — an explicit, AWS-stated exception to S3's otherwise-multi-AZ-by-default durability model. — CONFIRMED.
13. **Interactions**: origin for CloudFront; event notifications trigger Lambda/SQS/SNS/EventBridge — the mechanism behind this simulator's `isManagedEventTrigger` behavior (`docs/codebase/REQUEST_SIMULATOR.md` §5 step 4); accessible from a private subnet via a Gateway VPC Endpoint.

### Amazon ElastiCache

1. **Configuration**: managed Redis or Memcached; node type, cluster mode, replication group (Redis) for Multi-AZ with automatic failover. — CONFIRMED (*Amazon ElastiCache User Guide*).
5. **Connectivity**: ENI-based, lives in a chosen subnet, standard Security-Group/NACL model applies. — CONFIRMED.
9. **State**: an in-memory data store — data is not durably persisted the way a database's is by default (Redis supports optional persistence/snapshots, but the primary use case is as a cache/fast-access layer, not a system of record). — CONFIRMED.
10. **Failure modes**: a node failure in a Redis replication group with Multi-AZ enabled triggers automatic failover to a replica; a cache-aside application pattern (fetch from cache, fall back to the database on a miss/failure) is the standard documented resilience pattern for tolerating a cache outage — which is exactly the "circuit breaker cache fallback" behavior this simulator models when a database is down and a healthy cache exists (`docs/codebase/REQUEST_SIMULATOR.md` Behavior 6). — CONFIRMED as a standard, documented architecture pattern; the specific "circuit breaker" terminology is this simulator's own framing, not an AWS-specific term for this ElastiCache behavior.
13. **Interactions**: sits between application compute and a database as a read-through/cache-aside layer.

---

## Messaging / Orchestration

### Amazon SQS

1. **Configuration**: Standard (at-least-once delivery, best-effort ordering) or FIFO (exactly-once processing, strict ordering) queues; visibility timeout, message retention period, optional dead-letter queue redrive policy. — CONFIRMED (*Amazon SQS Developer Guide*).
2. **Inputs**: messages sent via `SendMessage`/`SendMessageBatch` from any authorized principal. — CONFIRMED.
3. **Outputs**: messages retrieved via `ReceiveMessage` (polling — SQS does not push to consumers on its own, though Lambda's SQS event-source mapping polls on the consumer's behalf, presenting as if it were push-triggered from the application's perspective). — CONFIRMED.
9. **State**: a received-but-not-yet-deleted message becomes invisible to other consumers for the duration of its visibility timeout; if not deleted (acknowledged) within that window, it becomes visible again for redelivery — this is the core at-least-once-delivery mechanism. — CONFIRMED.
10. **Failure modes**: a message that repeatedly fails processing and exceeds `maxReceiveCount` is moved to a configured dead-letter queue rather than retried forever. — CONFIRMED.
12. **Edge cases**: enqueueing a message and returning success to the original caller (this simulator's "202 Accepted, decoupled" behavior, `docs/codebase/REQUEST_SIMULATOR.md` Behavior 6) is a real, standard, AWS-documented async-decoupling pattern — but it means the *original* caller has no visibility into whether the message is ever successfully processed by a downstream consumer; success of the enqueue operation and success of the eventual processing are two entirely separate outcomes. — CONFIRMED.
13. **Interactions**: consumed by Lambda (event-source mapping), EC2/ECS workers (polling), or via SNS fan-out (SNS-to-SQS subscription).

### Amazon SNS

1. **Configuration**: a topic with one or more subscribers (SQS queues, Lambda, HTTP/S endpoints, email, SMS, mobile push); pub/sub — a single published message is delivered to every current subscriber independently. — CONFIRMED (*Amazon SNS Developer Guide*).
5. **Connectivity**: push-based delivery to subscribers (unlike SQS's poll-based model) — SNS actively delivers to each subscriber's endpoint. — CONFIRMED.
10. **Failure modes**: SNS retries delivery to a failing subscriber per a documented (subscriber-type-specific) retry policy; a dead-letter queue can be configured per-subscription for messages that exhaust retries. — CONFIRMED.
13. **Interactions**: commonly fans out to multiple SQS queues/Lambda functions from a single published event; often paired with EventBridge for more complex routing/filtering needs.

### Amazon EventBridge

1. **Configuration**: an event bus receiving events (from AWS services, custom applications, or SaaS partners) matched against rules (event pattern matching) that route to one or more targets (Lambda, SQS, SNS, Step Functions, and 20+ other target types). — CONFIRMED (*Amazon EventBridge User Guide*).
5. **Connectivity**: a fully-managed, serverless event router — no ENI/VPC placement of its own. — CONFIRMED.
10. **Failure modes**: a target invocation failure is retried per a configurable retry policy, then optionally sent to a per-rule dead-letter queue. — CONFIRMED.
13. **Interactions**: this simulator's `isManagedEventTrigger` behavior treats EventBridge (along with Lambda/SNS/SQS/Step Functions) as valid downstream targets of an "Event"-protocol edge from a service like S3 (`docs/codebase/REQUEST_SIMULATOR.md` §5 step 4) — real EventBridge event pattern matching is considerably richer (content-based filtering on the event payload, not just "this edge is type Event") than the simulator's current binary edge-type check, an APPROXIMATION worth flagging for future conformance testing.

### AWS Step Functions

1. **Configuration**: a state machine (Standard or Express workflow type) defined in Amazon States Language, with states that can invoke Lambda, other AWS service APIs directly, or wait/branch/parallelize/retry. — CONFIRMED (*AWS Step Functions Developer Guide*).
9. **State**: Standard workflows maintain full execution history and support long-running (up to 1 year) executions with exactly-once semantics; Express workflows are optimized for high-volume, short-duration (up to 5 minutes) executions with at-least-once semantics. — CONFIRMED.
10. **Failure modes**: built-in per-state retry (configurable backoff) and catch (error-handling branch) constructs are a first-class part of the state machine definition language itself, not bolted on. — CONFIRMED.
13. **Interactions**: commonly orchestrates Lambda functions, ECS tasks, and other AWS service API calls in a defined sequence with built-in error handling.

---

## Networking services also in the 28-service list (cross-referenced, not duplicated)

| Service id | Full specification location |
|---|---|
| `internet_gateway` | `NETWORKING_BEHAVIOR.md` §5 |
| `nat_gateway` | `NETWORKING_BEHAVIOR.md` §6 |
| `s3_gateway_endpoint` | `NETWORKING_BEHAVIOR.md` §11a |
| `privatelink` | `NETWORKING_BEHAVIOR.md` §11b |
