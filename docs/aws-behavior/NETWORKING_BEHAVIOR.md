# NETWORKING_BEHAVIOR.md

Ground-truth AWS networking behavior. Cross-reference `docs/codebase/NETWORKING_CURRENT_STATE.md` for what the simulator currently does versus what is documented here. Classification: CONFIRMED / APPROXIMATION / UNKNOWN, per `AWS_BEHAVIOR_MODEL.md` §3.

---

## 1. VPC (Virtual Private Cloud)

1. **Configuration**: one or more IPv4 CIDR blocks (primary block set at creation, /16 to /28; secondary blocks addable later), optional IPv6 CIDR (Amazon-provided `/56` or customer-owned), DNS support/DNS hostnames toggles, default or dedicated tenancy. — CONFIRMED (*Amazon VPC User Guide — Work with VPCs*).
2. **Inputs**: none directly — a VPC is a container/namespace, not a traffic endpoint. — CONFIRMED.
3. **Outputs**: none directly. — CONFIRMED.
4. **Dependencies**: none — a VPC is the top-level networking construct in a region. — CONFIRMED.
5. **Connectivity**: a VPC is isolated from all other networks (including other VPCs and the internet) by default; connectivity to anything outside it requires an explicit gateway/attachment (IGW, NAT Gateway, VPC Peering, Transit Gateway, VPN, Direct Connect). — CONFIRMED (*Amazon VPC User Guide — What is Amazon VPC*).
6. **Networking**: scoped to exactly one AWS Region; spans all Availability Zones in that Region. Subnets subdivide the VPC's CIDR and each subnet is pinned to exactly one AZ. — CONFIRMED.
7. **Security**: default Security Group and default NACL are created automatically with the VPC (default SG denies all inbound, allows all outbound and intra-SG traffic; default NACL allows all inbound/outbound). — CONFIRMED (*Amazon VPC User Guide — Security groups for your VPC*, *Network ACLs*).
8. **IAM**: `ec2:CreateVpc`, `ec2:DescribeVpcs`, `ec2:DeleteVpc`, etc. — standard EC2 API actions (VPC is part of the EC2 API namespace). — CONFIRMED (*Service Authorization Reference — Amazon EC2*).
9. **State**: a VPC has no request-time "health" — it exists or does not. Its constituent resources (subnets, gateways) have their own states. — CONFIRMED.
10. **Failure modes**: a VPC itself cannot "fail" — its dependent resources (IGW, NAT Gateway, route tables) can be misconfigured or unavailable, which is where user-visible failure originates. — CONFIRMED.
11. **Restrictions**: default limit of 5 VPCs per Region per account (soft limit, raisable); CIDR block size /16 to /28; cannot shrink a CIDR block once subnets exist within it, only add secondary blocks. — CONFIRMED (*AWS General Reference — VPC quotas*).
12. **Edge cases**: two VPCs with overlapping CIDR ranges cannot be peered; secondary CIDR blocks added later are NOT automatically covered by existing subnets/route tables — routing must be added explicitly. — CONFIRMED.
13. **Interactions**: contains Subnets, Route Tables, Security Groups, NACLs, and gateway attachments (IGW/NAT/VPN/Peering/Transit Gateway attachment).

---

## 2. Subnet

1. **Configuration**: a single IPv4 CIDR block carved from the parent VPC's CIDR (must not overlap other subnets in the same VPC), pinned to exactly one Availability Zone, optional IPv6 CIDR (a `/64` slice of the VPC's `/56`), "auto-assign public IPv4" toggle. — CONFIRMED (*Amazon VPC User Guide — Subnets for your VPC*).
2. **Inputs**: none directly — a subnet is an address-space/AZ binding, not a traffic endpoint itself. — CONFIRMED.
3. **Outputs**: none directly. — CONFIRMED.
4. **Dependencies**: a parent VPC; an associated route table (falls back to the VPC's main route table if none explicitly associated). — CONFIRMED.
5. **Connectivity**: reachability from outside the VPC is entirely a function of the subnet's **route table**, not an inherent subnet property. AWS documentation defines "public subnet" as *a subnet whose associated route table has a route to an Internet Gateway* and "private subnet" as one that does not — this is the single authoritative definition, not a label set on the subnet itself. — CONFIRMED (*Amazon VPC User Guide — Route tables*, "public subnet" is explicitly defined this way, not as a subnet attribute).
6. **Networking / public-private semantics**: a resource in a subnet with a default route (`0.0.0.0/0`) to an Internet Gateway, AND that itself has a public IPv4 address (auto-assigned or an Elastic IP), is internet-reachable. A subnet can have the IGW route and still host instances with no public IP (those instances remain unreachable from the internet despite sitting in a "public" subnet) — CONFIRMED, an important edge case documented explicitly in AWS materials on public/private subnet design.
7. **Security**: no subnet-level security construct of its own beyond its associated NACL (NACLs attach to subnets, not directly to the VPC or to individual instances). — CONFIRMED.
8. **IAM**: `ec2:CreateSubnet`, `ec2:DescribeSubnets`, etc. — CONFIRMED.
9. **State**: `pending` → `available`; a subnet does not have a runtime "health" state comparable to a compute instance. — CONFIRMED.
10. **Failure modes**: subnet IP exhaustion (all usable addresses allocated) blocks new ENI creation in that subnet; this manifests as a launch failure for new instances/ENIs, not an outage of existing ones. — CONFIRMED (*Amazon VPC User Guide — VPC and subnet sizing*).
11. **Restrictions**: smallest usable subnet is `/28` (16 addresses); AWS reserves exactly 5 addresses in every subnet regardless of size (network address, VPC router, DNS, future use, broadcast) — see §10 (ENI/addressing edge cases) below for the full breakdown. — CONFIRMED (*Amazon VPC User Guide — Subnet sizing for IPv4*).
12. **Edge cases**: a subnet's AZ is fixed at creation and cannot be changed; moving a workload to a different AZ requires a new subnet. A subnet spans exactly one AZ — it is never itself Multi-AZ (Multi-AZ architectures always mean *multiple* subnets, one per AZ). — CONFIRMED.
13. **Interactions**: hosts ENIs (and therefore EC2/RDS/ElastiCache/Lambda-in-VPC/etc.); associated with exactly one route table; associated with exactly one NACL (a NACL can be associated with multiple subnets, but each subnet has exactly one active NACL association at a time).

### 2.1 The 5 reserved addresses per subnet (CONFIRMED)

| Offset | Role |
|---|---|
| Base + 0 | Network address |
| Base + 1 | Reserved for the VPC router |
| Base + 2 | Reserved for the Amazon-provided DNS server |
| Base + 3 | Reserved for future AWS use |
| Base + (size−1) | Network broadcast address (AWS VPCs do not support broadcast, but the address is still reserved) |

Source: *Amazon VPC User Guide — Subnet sizing for IPv4*. Usable host count = subnet size − 5.

---

## 3. Route Table

1. **Configuration**: an ordered-by-specificity set of routes, each mapping a destination CIDR (IPv4 or IPv6) or a prefix list to a target (local, igw-id, nat-id, pcx-id, vpce-id, tgw-id, eni-id, etc.). Every VPC has exactly one **main route table** by default; additional **custom route tables** can be created and associated with specific subnets. — CONFIRMED (*Amazon VPC User Guide — Route tables*).
2. **Inputs**: n/a — a route table is consulted per-packet, not addressed directly. — CONFIRMED.
3. **Outputs**: n/a. — CONFIRMED.
4. **Dependencies**: a parent VPC. — CONFIRMED.
5. **Connectivity / routing behavior**: for every outbound packet, AWS's implicit router selects the **most specific matching route** (longest-prefix match) in the packet's subnet's associated route table. A `local` route for the VPC's own CIDR is always present and cannot be removed, and is always the most specific match for intra-VPC traffic regardless of what other routes exist. — CONFIRMED (*Amazon VPC User Guide — Route tables*, explicitly documents longest-prefix-match route selection).
6. **Route matching — worked example**: a table with `10.0.0.0/16 → local` and `0.0.0.0/0 → igw-xxxx` sends traffic for `10.0.5.10` via `local` (more specific `/16` beats the `/0` default) and everything else via the IGW. — CONFIRMED.
7. **Security**: route tables are not a security boundary — a route existing does not mean traffic is *allowed*, only that it is *directed*; Security Groups and NACLs make the allow/deny decision separately and are evaluated independently of routing. — CONFIRMED, and an important edge case: a route to an IGW plus a wide-open Security Group is what actually makes a subnet's resources internet-reachable; either one alone is not sufic.
8. **IAM**: `ec2:CreateRoute`, `ec2:CreateRouteTable`, `ec2:AssociateRouteTable`, etc. — CONFIRMED.
9. **State**: routes can be `active` or `blackhole` (target no longer exists, e.g. a deleted NAT Gateway or VPC Peering connection) — a blackhole route silently drops matching traffic rather than erroring. — CONFIRMED (*Amazon VPC User Guide — Route tables*, "blackhole route" is a documented AWS term).
10. **Failure modes**: the most common real-world failure is a **missing** route (e.g. a private subnet with no route to a NAT Gateway — outbound internet traffic simply has nowhere to go and times out) or a **blackholed** route (target deleted but route not cleaned up). — CONFIRMED.
11. **Restrictions**: default quota of 50 routes per route table (non-propagated), separate quota for routes propagated from a Virtual Private Gateway; a subnet can be associated with only one route table at a time (falls back to the VPC's main table if not explicitly associated). — CONFIRMED (*AWS General Reference — VPC quotas*).
12. **Edge cases**: changing a subnet's route table association takes effect immediately for new connections but does not retroactively affect already-established connection tracking in some edge cases involving stateful NAT devices — this specific interaction is APPROXIMATION (behavior can vary and is not exhaustively documented for every device type).
13. **Interactions**: referenced by Subnets (association) and populated by Internet Gateways, NAT Gateways, VPC Peering connections, VPC Endpoints (interface endpoints don't need routes; gateway endpoints do, via prefix-list routes), Transit Gateway attachments, and Virtual Private Gateways (VPN).

---

## 4. Route

1. **Configuration**: `{destination CIDR or prefix list, target}` — a single entry within a Route Table. — CONFIRMED.
2-4. **Inputs/Outputs/Dependencies**: n/a directly; inherits from Route Table. — CONFIRMED.
5. **Connectivity / matching semantics**: AWS always selects the single **most specific** (longest-prefix) matching route for a given destination address, never combines or load-balances across multiple matching routes of different specificity. When two routes have the *identical* destination CIDR, a **static route always takes precedence over a propagated (dynamic, e.g. BGP-learned via VPN/Direct Connect) route** for the same destination. — CONFIRMED (*Amazon VPC User Guide — Route tables* — route priority section).
6. **Source/destination semantics**: a route matches based on the packet's **destination** address only; it has no concept of source-based routing (source-based routing, i.e. policy-based routing, is not a native VPC route table feature — it requires other constructs like separate route tables per source subnet). — CONFIRMED.
7. **Security**: none — see Route Table §7. — CONFIRMED.
8. **IAM**: `ec2:CreateRoute`, `ec2:ReplaceRoute`, `ec2:DeleteRoute`. — CONFIRMED.
9. **State**: `active` or `blackhole`. — CONFIRMED.
10. **Failure modes**: see Route Table §10. — CONFIRMED.
11. **Restrictions**: counts against the parent route table's route quota. — CONFIRMED.
12. **Edge cases**: the local route for the VPC CIDR is immutable and always wins for intra-VPC destinations even if a more specific-looking manual route is added for a sub-range of the VPC CIDR pointing elsewhere (in practice AWS does not allow a route more specific than the VPC's own CIDR to override intra-VPC delivery for addresses that are actually in-use within the VPC — this exact override behavior for *unused* sub-ranges is APPROXIMATION, as it depends on whether the destination is actually assigned within the VPC).
13. **Interactions**: targets one of — `local`, Internet Gateway, NAT Gateway, VPC Peering connection, VPC Endpoint (gateway type), Transit Gateway attachment, Virtual Private Gateway, Network Interface (ENI), Instance.

---

## 5. Internet Gateway (IGW)

1. **Configuration**: created independently, then **attached** to exactly one VPC at a time (a VPC can have at most one attached IGW). — CONFIRMED (*Amazon VPC User Guide — Internet gateways*).
2. **Inputs**: inbound internet traffic destined for a public IPv4/IPv6 address that 1:1 NATs to a private ENI address inside the VPC. — CONFIRMED.
3. **Outputs**: outbound traffic from the VPC to the internet, source-NATed from the instance's public IP. — CONFIRMED.
4. **Dependencies**: a VPC to attach to; a route table entry (`0.0.0.0/0 → igw-id`, or the IPv6 equivalent) in the subnet whose resources need reachability; the target instance/ENI must itself have a public IPv4 address (or Elastic IP) for the 1:1 NAT to apply. — CONFIRMED.
5. **Connectivity**: an IGW performs **two functions**: (a) it is the target for the default route enabling internet-bound traffic, and (b) it performs 1:1 NAT translation between a resource's private IP and its public IP. Without BOTH the route AND a public IP on the resource, internet connectivity does not work even with the IGW attached. — CONFIRMED, and explicitly the reason "public subnet" is a routing-table property, not an inherent subnet property (see Subnet §5).
6. **Networking**: horizontally scaled and highly available by AWS design across all AZs in the Region automatically — there is no customer-visible IGW instance to place in an AZ or subnet. — CONFIRMED.
7. **Security**: an IGW itself performs no filtering — Security Groups and NACLs on the actual resources are what control access; the IGW indiscriminately passes any traffic the route table sends it. — CONFIRMED.
8. **IAM**: `ec2:CreateInternetGateway`, `ec2:AttachInternetGateway`, `ec2:DetachInternetGateway`. — CONFIRMED.
9. **State**: `attached` / `detached`/`available` — an IGW has no "capacity" or "health" metric exposed to customers; AWS manages its availability as part of the regional network fabric. — CONFIRMED.
10. **Failure modes**: from a customer's perspective, an IGW is designed to be non-failing (no SLA-visible outage unit); the practically-observed "IGW is down" scenario a student encounters is virtually always a **missing attachment** or a **missing/incorrect route**, not an actual regional IGW outage. — APPROXIMATION (AWS does not publish IGW-specific SLA/failure-rate documentation the way it does for e.g. NAT Gateway; treating an IGW as "cannot itself fail once attached, only be misconfigured" is a reasonable modeling stance but not something a single doc page states in those exact terms).
11. **Restrictions**: one IGW attached per VPC at a time; no bandwidth limit imposed by the IGW construct itself (scales with the instances behind it). — CONFIRMED.
12. **Edge cases**: detaching an IGW while instances have active connections through it drops those connections; an IGW attached to a VPC with no route to it anywhere provides no connectivity at all (attachment alone is necessary but not sufficient). — CONFIRMED.
13. **Interactions**: targeted by default routes in Route Tables; performs NAT for instances with public IPs/EIPs; is the mechanism through which an ALB/NLB with "internet-facing" scheme, or any public EC2 instance, becomes reachable.

---

## 6. NAT Gateway

1. **Configuration**: created inside a specific **public** subnet, requires an Elastic IP (for a public NAT Gateway) or is created with only a private IP (private NAT Gateway, for VPC-to-VPC/on-prem use only, no internet access). — CONFIRMED (*Amazon VPC User Guide — NAT gateways*).
2. **Inputs**: outbound-initiated traffic from private-subnet resources whose route table sends `0.0.0.0/0` (or a more specific private-destined range) to the NAT Gateway. — CONFIRMED.
3. **Outputs**: performs Source NAT (SNAT) — translates the private source IP to the NAT Gateway's Elastic IP before forwarding to the IGW; return traffic is translated back by the NAT Gateway to the original private IP. — CONFIRMED.
4. **Dependencies**: must sit in a subnet with a route to an Internet Gateway; the private subnets it serves must have a route pointing `0.0.0.0/0` (or relevant destination) to this NAT Gateway. — CONFIRMED.
5. **Connectivity / directionality**: a NAT Gateway is explicitly **one-directional-initiation**: it allows outbound-initiated connections from private resources to succeed and their return traffic to come back, but it does **not** allow unsolicited inbound connections from the internet to reach private resources — there is no inbound NAT/port-forwarding capability. — CONFIRMED (*Amazon VPC User Guide — NAT gateways*, "A NAT gateway... does not allow you to run a server").
6. **Networking**: must be placed in a public subnet (a subnet whose route table has an IGW route); serves one or more private subnets via their route tables. AWS recommends (not requires) **one NAT Gateway per Availability Zone** for AZ-independence — a single NAT Gateway is itself an AZ-scoped resource (it lives in one AZ's subnet), so if that AZ fails, all private subnets routing through it lose egress unless another NAT Gateway exists in another AZ. — CONFIRMED (*Amazon VPC User Guide — NAT gateways: Availability Zones*).
7. **Security**: cannot have a Security Group attached (Security Groups don't apply to NAT Gateways directly); NACLs on its own subnet still apply to its traffic. — CONFIRMED.
8. **IAM**: `ec2:CreateNatGateway`, `ec2:DeleteNatGateway`, `ec2:DescribeNatGateways`. — CONFIRMED.
9. **State**: `pending` → `available` → `deleting` → `deleted`; also `failed` if provisioning fails. — CONFIRMED.
10. **Failure modes**: an AZ outage taking down a NAT Gateway's subnet/AZ removes egress for every private subnet solely routed through it (no automatic failover to another AZ's NAT Gateway — that requires the customer to have provisioned per-AZ NAT Gateways with per-AZ route tables in the first place). — CONFIRMED.
11. **Restrictions**: a NAT Gateway supports up to 55,000 simultaneous connections per unique destination (per protocol); bandwidth scales automatically up to 100 Gbps. Placing a NAT Gateway in a private subnet (instead of public) leaves it with no path to the internet, since it has no IGW route to reach — this fails at the routing level, not at the NAT Gateway itself. — CONFIRMED (*Amazon VPC User Guide — NAT gateways — quotas*).
12. **Edge cases**: a NAT Gateway is billed per-hour plus per-GB processed regardless of whether it is actively used; a private subnet with resources needing to reach only S3/DynamoDB can avoid NAT Gateway data-processing charges entirely by using a **Gateway VPC Endpoint** instead (free, routed via a prefix-list route, no ENI/AZ dependency of its own). — CONFIRMED (*Amazon VPC User Guide — Gateway VPC endpoints*).
13. **Interactions**: targeted by private subnet route tables; itself depends on an IGW route in its own (public) subnet; commonly paired with, and made partially redundant by, Gateway VPC Endpoints for S3/DynamoDB traffic specifically.

---

## 7. Security Group

1. **Configuration**: a named set of **allow-only** rules (no explicit deny rule type exists), each specifying protocol, port range, and source/destination as a CIDR, another Security Group (by reference), or a prefix list. Inbound and outbound rule sets are independent. — CONFIRMED (*Amazon EC2 User Guide — Security groups for your instances*).
2. **Inputs**: evaluated against inbound traffic to the ENI(s) it is attached to. — CONFIRMED.
3. **Outputs**: evaluated against outbound traffic from the ENI(s) it is attached to. — CONFIRMED.
4. **Dependencies**: exists within a specific VPC; attached to one or more ENIs (an ENI can have up to 5 Security Groups attached simultaneously by default, quota raisable). — CONFIRMED.
5. **Connectivity / attachment semantics**: attachment is by **explicit reference** on the ENI (`security-group-ids`), completely independent of the ENI's subnet or physical/geometric placement — an instance's Security Group membership is a property of the instance/ENI, not of where it happens to be drawn or located. — CONFIRMED (*Amazon EC2 User Guide — Security groups*).
6. **Stateful behavior (the defining characteristic)**: Security Groups are **stateful** — if an inbound rule allows a connection in, the corresponding **return traffic is automatically allowed out** regardless of outbound rules, and vice versa for outbound-initiated connections. There is no need to separately configure a rule for response/return traffic. — CONFIRMED (*Amazon EC2 User Guide — Security groups*, explicitly states statefulness as a defining property, contrasted directly against NACLs).
7. **Security / rule evaluation**: all rules across all attached Security Groups are **evaluated together as a union** — if *any* attached Security Group (or any rule within one) allows the traffic, it is permitted; there is no "most specific rule wins" or deny-precedence concept, because there are no deny rules at all, only allow rules that are additive across every attached group. — CONFIRMED.
8. **IAM**: `ec2:CreateSecurityGroup`, `ec2:AuthorizeSecurityGroupIngress`, `ec2:AuthorizeSecurityGroupEgress`, `ec2:RevokeSecurityGroupIngress/Egress`. — CONFIRMED.
9. **State**: rules take effect immediately upon change (no propagation delay documented as a normal-case concern); a newly-created default Security Group **denies all inbound, allows all outbound**, and additionally allows all traffic among members of the same Security Group (a documented default self-referencing rule the default SG comes with). — CONFIRMED.
10. **Failure modes**: a "failure" here is always a misconfiguration (rule too narrow, wrong reference, forgetting a second protocol/port), never a runtime fault of the Security Group construct itself — it is a pure allow-list evaluated per-packet, not a stateful service that can be "down." — CONFIRMED.
11. **Restrictions**: default quota of 5 Security Groups per ENI, 60 inbound + 60 outbound rules per Security Group (both raisable quotas as of recent AWS documentation, exact current numbers should be re-verified against the live Service Quotas console since these move over time). — APPROXIMATION (the specific numeric quotas are correct as of the source doc consulted but are explicitly called out by AWS as adjustable and subject to change; treat the *existence* of a quota as CONFIRMED and the exact number as an approximation to re-verify).
12. **Edge cases**: referencing another Security Group *by ID* in a rule (rather than a CIDR) means the rule dynamically covers whatever instances are currently in that referenced group, including across the same VPC — this is a live reference, not a snapshot. Security Groups **cannot deny** — there is no way to explicitly block a specific source while allowing a broader range with a Security Group alone; that requires a NACL. — CONFIRMED.
13. **Interactions**: attached to ENIs (EC2, RDS, ElastiCache, Lambda-in-VPC, ALB/NLB, VPC Endpoints — anything with an ENI); evaluated strictly **after** the subnet's NACL for inbound traffic (packet must pass the NACL before the Security Group is even consulted).

---

## 8. Network ACL (NACL)

1. **Configuration**: an ordered list of numbered rules (evaluated lowest-number-first), each with protocol/port/CIDR and an explicit **ALLOW or DENY** action; separate inbound and outbound rule lists; always ends with an implicit, non-removable `* DENY ALL` catch-all rule at the highest rule number. — CONFIRMED (*Amazon VPC User Guide — Network ACLs*).
2. **Inputs**: evaluated against all traffic entering the subnet it's associated with (both traffic from outside the subnet and traffic between the subnet and the rest of the VPC). — CONFIRMED.
3. **Outputs**: evaluated against all traffic leaving the subnet. — CONFIRMED.
4. **Dependencies**: associated with one or more **subnets** (never with an individual instance/ENI directly); a subnet has exactly one NACL association at a time; every VPC has a **default NACL** (allows all inbound/outbound) automatically associated with every subnet that doesn't have an explicit custom association. — CONFIRMED.
5. **Connectivity / evaluation order**: for a given packet, NACL rules are evaluated **in ascending rule-number order, first match wins** — once a rule matches (by protocol/port/CIDR), its action is applied immediately and no further (higher-numbered) rules are considered, including the final implicit deny. — CONFIRMED (*Amazon VPC User Guide — Network ACLs*, explicitly documents "the rule with the lowest number ... determines whether traffic is allowed").
6. **Stateless behavior (the defining characteristic, contrasted with Security Groups)**: NACLs are **stateless** — an inbound-allow rule does **not** automatically permit the corresponding return traffic outbound; the outbound rule set must independently and explicitly allow it (commonly by allowing the client's **ephemeral port range**, typically 1024-65535, since that's where a client's outbound-originated connection's return traffic will be addressed to on the way back in, or vice versa for inbound response legs). Forgetting this explicit ephemeral-port rule is the single most commonly documented NACL misconfiguration, producing exactly the "connection succeeds outbound, but times out" symptom. — CONFIRMED (*Amazon VPC User Guide — Network ACLs — Ephemeral ports*, which is an entire dedicated documentation section specifically because of how often this is misunderstood).
7. **Security**: a NACL's implicit-deny final rule means **anything not explicitly allowed is blocked** — the opposite default posture from a Security Group's allow-list-only model (which has no way to express a deny at all). — CONFIRMED.
8. **IAM**: `ec2:CreateNetworkAcl`, `ec2:CreateNetworkAclEntry`, `ec2:ReplaceNetworkAclEntry`, `ec2:AssociateNetworkAcl`. — CONFIRMED.
9. **State**: rule changes apply immediately to new and existing connections (since NACLs are stateless, there's no connection-tracking state to invalidate — every packet is evaluated fresh against the current rule set every time). — CONFIRMED.
10. **Failure modes**: the "stateless timeout" pattern — outbound request permitted, but the response is blocked by the destination-side (or origin-side) NACL's outbound/inbound rules lacking an ephemeral-port allow — manifests to an application as a connection timeout, not an immediate rejection (a stateless DENY silently drops the packet rather than sending an RST/ICMP-unreachable in the way a Security Group-style stateful reject conceptually might be imagined to). — CONFIRMED.
11. **Restrictions**: default quota of 20 rules per direction per NACL (raisable, current default per AWS documentation — re-verify against live quotas); rule numbers 1-32766 usable by customers, 32767 reserved for the implicit final deny. — CONFIRMED for the structural facts (rule number range, reserved final rule); APPROXIMATION for the exact current numeric rule-count quota (subject to AWS quota changes).
12. **Edge cases**: a NACL evaluates **both directions independently per rule set** — an inbound ALLOW and its corresponding outbound ALLOW for the return leg are two separate rules that must each be present; a single "bidirectional" rule concept does not exist in a NACL the way it implicitly does in a stateful Security Group. Rule numbers must be unique within a direction; lower always wins regardless of how "specific" a higher-numbered rule might look. — CONFIRMED.
13. **Interactions**: associated with Subnets; evaluated **before** any Security Group for inbound traffic to a resource in that subnet (packet must clear the NACL first); does not interact with individual ENIs directly.

---

## 9. ENI (Elastic Network Interface)

1. **Configuration**: primary private IPv4 address (plus optional secondary private IPs), optional IPv6 addresses, one or more attached Security Groups, a MAC address, optionally an associated Elastic IP or auto-assigned public IP. — CONFIRMED (*Amazon EC2 User Guide — Elastic network interfaces*).
2-3. **Inputs/Outputs**: the actual network I/O surface for whatever resource it's attached to (EC2 instance, NAT Gateway, ALB/NLB node, RDS instance, Lambda-in-VPC execution environment, VPC Endpoint). — CONFIRMED.
4. **Dependencies**: exists within exactly **one subnet** in exactly one AZ — this binding is permanent for the life of the ENI (an ENI cannot move between subnets/AZs; a replacement ENI in a different subnet is required instead). — CONFIRMED.
5. **Connectivity**: an ENI's actual reachability is the intersection of its subnet's routing (public vs. private), its attached Security Groups (stateful allow), and its subnet's NACL (stateless allow/deny) — no single one of these three alone determines reachability. — CONFIRMED, and this exact three-way intersection is the core reachability model the whole networking spec in this document composes into.
6. **Networking**: an ENI is the concrete binding of "this resource lives in exactly this subnet" that this simulator's whole geometry-derived-subnet design (see `docs/codebase/NETWORKING_CURRENT_STATE.md`) is a simplified stand-in for — in real AWS, every VPC-hosted resource that needs network reachability has at least one ENI, and that ENI's subnet is what actually determines its AZ and public/private routing eligibility, not the resource type itself. — CONFIRMED.
7. **Security**: Security Groups attach to the ENI, not to the parent resource abstractly. — CONFIRMED.
8. **IAM**: `ec2:CreateNetworkInterface`, `ec2:AttachNetworkInterface`, `ec2:ModifyNetworkInterfaceAttribute`. — CONFIRMED.
9. **State**: `available` / `in-use` / `attaching` / `detaching`. — CONFIRMED.
10. **Failure modes**: exhausting a subnet's available IP addresses prevents new ENI creation there (see Subnet §10); an ENI itself does not have a distinct "failure" state independent of its underlying host/service failing. — CONFIRMED.
11. **Restrictions**: the number of ENIs (and secondary private IPs) an EC2 instance can have is capped by instance type; every ENI belongs to exactly one subnet and cannot span or move across subnets/AZs. — CONFIRMED.
12. **Edge cases**: an EC2 instance can have multiple ENIs, each in a *different subnet within the same AZ* (not across AZs — an instance itself is pinned to one AZ, and each of its ENIs must be in a subnet in that same AZ), enabling dual-homed network designs. — CONFIRMED.
13. **Interactions**: the attachment point for Security Groups; lives within exactly one Subnet; every resource type this spec covers that has "networking" behavior (EC2, RDS, ElastiCache, ALB/NLB, NAT Gateway, Lambda-in-VPC, Interface VPC Endpoints) is, under the hood, one or more ENIs.

---

## 10. Elastic IP (EIP)

1. **Configuration**: a static, account-owned public IPv4 address, allocated independently of any resource, then optionally **associated** with an ENI (or an instance's primary ENI) or a NAT Gateway. — CONFIRMED (*Amazon VPC User Guide — Elastic IP addresses*).
2-3. **Inputs/Outputs**: acts as the public-facing address for whatever it's associated with; the IGW performs the actual 1:1 NAT translation between the EIP and the associated resource's private IP. — CONFIRMED.
4. **Dependencies**: none to allocate; requires a VPC-resident ENI/NAT Gateway to be useful once associated. — CONFIRMED.
5. **Connectivity**: an EIP does not itself provide connectivity — reachability still requires the hosting subnet to have an IGW route; the EIP only fixes *which* public address is used (as opposed to an ephemeral auto-assigned public IP that changes if the instance is stopped/started). — CONFIRMED.
6. **Networking**: remains with the AWS account (not the instance) until explicitly released — reassociating an EIP to a different instance/ENI is a fast, independent operation from instance lifecycle. — CONFIRMED.
7-8. **Security/IAM**: `ec2:AllocateAddress`, `ec2:AssociateAddress`, `ec2:ReleaseAddress`. — CONFIRMED.
9. **State**: an EIP is either `unassociated` or `associated`. — CONFIRMED.
10. **Failure modes**: no failure mode of its own; it is a static address record, not an active device. — CONFIRMED.
11. **Restrictions**: default quota of 5 EIPs per Region per account (soft, raisable); **AWS charges for an EIP that is allocated but not associated with a running resource** (an idle-address charge, specifically to discourage hoarding scarce public IPv4 addresses) — this billing behavior is explicitly documented AWS policy. — CONFIRMED (*Amazon VPC User Guide — Elastic IP addresses* / *AWS Pricing — Public IPv4 addresses*).
12. **Edge cases**: an EIP associated with a stopped-then-started EC2 instance stays with it (unlike an auto-assigned public IP, which is released and reassigned on stop/start) — this is the entire reason EIPs exist as a distinct concept from auto-assigned public IPs. — CONFIRMED.
13. **Interactions**: associated with an ENI (EC2 instance) or a NAT Gateway; the mechanism an Internet Gateway NATs against.

---

## 11. VPC Endpoint

Two distinct types with materially different behavior — treating them as one concept is a common source of error.

### 11a. Gateway VPC Endpoint (S3 and DynamoDB only)

1. **Configuration**: a **route-table-based** construct — creates a prefix-list target that route tables can point to; no ENI, no IP address, no Security Group. — CONFIRMED (*Amazon VPC User Guide — Gateway VPC endpoints*).
5. **Connectivity**: added as a route (via a managed prefix list) in the route table of any subnet that should use it; traffic to S3/DynamoDB from that subnet is automatically routed over the AWS private network instead of via the IGW/NAT Gateway, entirely transparently to the application (no code or endpoint-hostname changes needed). — CONFIRMED.
7. **Security**: has its own optional **endpoint policy** (a resource policy limiting which S3 buckets/DynamoDB tables/actions are reachable through it) in addition to whatever IAM/bucket policy already applies — this is an additional, independent authorization layer, not a replacement for IAM. — CONFIRMED.
10. **Failure modes**: none of its own (highly available by design, no ENI/AZ dependency); a private subnet relying on a Gateway Endpoint for S3 access has zero NAT Gateway dependency for that specific traffic, meaning an NAT Gateway or AZ outage does not affect S3/DynamoDB reachability through the endpoint. — CONFIRMED.
11. **Restrictions**: only supports Amazon S3 and Amazon DynamoDB. — CONFIRMED.
13. **Interactions**: replaces the need for NAT Gateway egress specifically for S3/DynamoDB traffic; free of charge (no hourly or per-GB fee), unlike a NAT Gateway or Interface Endpoint. — CONFIRMED.

### 11b. Interface VPC Endpoint (PrivateLink) — most other AWS services

1. **Configuration**: creates one or more **ENIs** (with private IPs) directly inside chosen subnets, one per AZ for high availability; backed by AWS PrivateLink. — CONFIRMED (*Amazon VPC User Guide — Interface VPC endpoints*).
5. **Connectivity**: consuming resources reach the service via the endpoint's private DNS hostname (if private DNS is enabled) or its endpoint-specific DNS name — no route table changes needed; it works because it *is* an ENI with an IP inside the subnet, not because of a route. — CONFIRMED.
6. **Networking**: since it's ENI-based, it is subject to Security Groups (you attach a Security Group to the endpoint's ENIs to control what can reach it) and lives in specific AZs/subnets like any other ENI-backed resource — this is the key structural difference from a Gateway Endpoint. — CONFIRMED.
7. **Security**: also supports an optional endpoint policy (resource policy), same concept as Gateway Endpoints. — CONFIRMED.
10. **Failure modes**: is AZ-scoped per-ENI like any ENI-backed resource — losing the AZ containing the only provisioned interface-endpoint ENI removes connectivity through that specific ENI (mitigated by provisioning one endpoint ENI per AZ, the AWS-recommended pattern). — CONFIRMED.
11. **Restrictions**: billed hourly per AZ plus per-GB data processed (unlike the free Gateway Endpoint); supports the majority of AWS services (not just S3/DynamoDB). — CONFIRMED.
13. **Interactions**: this app's `privatelink` catalog service id models this type generically. — CONFIRMED as a real AWS concept; the specific catalog id is this app's own naming choice (see `docs/codebase/SERVICE_SYSTEM.md`), not an AWS-standard term for the whole PrivateLink product.

---

## 12. VPC Peering

*Not currently modeled by this simulator at all — see `docs/codebase/SERVICE_SYSTEM.md`/`NETWORKING_CURRENT_STATE.md`, which confirm no peering-related logic exists in `requestSimulator.ts` or `containment.ts`. Documented here as ground truth for future implementation.*

1. **Configuration**: a 1:1 connection between exactly two VPCs (same or different accounts/Regions), established via a request/accept handshake. — CONFIRMED (*Amazon VPC Peering Guide*).
5. **Connectivity / routing**: **not transitive** — if VPC A peers with VPC B, and VPC B peers with VPC C, A cannot reach C through B; each pair needing connectivity must have its own explicit peering connection. This is one of the most consistently tested/documented VPC Peering facts. — CONFIRMED (*Amazon VPC Peering Guide — invalid peering configurations*, explicitly documents non-transitivity).
6. **Networking**: requires non-overlapping CIDR blocks between the two VPCs; requires explicit routes in both VPCs' route tables pointing relevant destination CIDRs at the peering connection (`pcx-id`); requires Security Groups to allow the peer CIDR (can also reference peer Security Groups by ID if in the same Region, with additional configuration). — CONFIRMED.
11. **Restrictions**: no transitive routing (see above); default quota of 50 active peering connections per VPC (raisable); cannot peer VPCs with overlapping/identical CIDR ranges. — CONFIRMED.
12. **Edge cases**: DNS resolution of private hostnames across a peering connection requires explicitly enabling that option on both sides — not on by default. — CONFIRMED.
13. **Interactions**: consumes route table entries and Security Group rules in both peered VPCs; does not involve any gateway device the way IGW/NAT Gateway do — it's a purely virtual, non-transitive routing construct.

---

## 13. Transit Gateway

*Not currently modeled by this simulator — documented here as ground truth for future implementation.*

1. **Configuration**: a regional (or, with peering, inter-Region) network transit hub that multiple VPCs, VPNs, and Direct Connect connections attach to. — CONFIRMED (*AWS Transit Gateway documentation*).
5. **Connectivity / routing**: unlike VPC Peering, Transit Gateway routing **can be transitive** — traffic between two attached VPCs can flow through the Transit Gateway's own route tables, which are a separate, independent routing domain from any individual VPC's route tables. — CONFIRMED, and this transitivity is the primary documented reason to choose Transit Gateway over a mesh of VPC Peering connections at scale.
6. **Networking**: supports route table **segmentation** — different attachments can be associated with different Transit Gateway route tables, enabling controlled (non-full-mesh) transitivity, e.g. isolating a "shared services" VPC's reachability from two otherwise-isolated spoke VPCs. — CONFIRMED.
11. **Restrictions**: quotas on attachments per Transit Gateway and routes per Transit Gateway route table exist and are raisable; cross-Region requires Transit Gateway peering (itself non-transitive, similar to VPC Peering's non-transitivity, i.e. TGW peering does not chain further). — APPROXIMATION on the exact current numeric quotas (subject to change); CONFIRMED on the structural cross-Region-requires-peering fact.
13. **Interactions**: attaches to VPCs (via subnet-specific ENIs, one for AZs you choose), Site-to-Site VPN connections, Direct Connect gateways, and other Transit Gateways (peering).

---

## 14. DNS (Amazon-provided VPC DNS / Route 53 Resolver)

1. **Configuration**: every VPC gets an Amazon-provided DNS server reachable at the base of the VPC's CIDR range plus two (see Subnet §2.1 — reserved offset +2 in every subnet), toggled on/off via the VPC's "DNS resolution" and "DNS hostnames" attributes. — CONFIRMED (*Amazon VPC User Guide — DNS attributes for your VPC*).
5. **Connectivity**: resolves both public DNS names and, when "DNS hostnames" is enabled, private DNS hostnames for VPC resources and Interface VPC Endpoints. — CONFIRMED.
7. **Security**: DNS queries within a VPC to the Amazon-provided resolver are not subject to Security Group/NACL filtering the way application traffic is (it's a special reserved-address service), though outbound DNS to external resolvers over the internet is normal traffic subject to the usual rules. — APPROXIMATION (the exact interaction between the reserved DNS IP and NACL/SG evaluation for that specific address is not the primary subject of a single authoritative doc page consulted here; treated as a reasonable characterization, not a verified edge-by-edge CONFIRMED claim).
10. **Failure modes**: if DNS hostnames/resolution is disabled on a VPC, private DNS names (including for Interface VPC Endpoints relying on private DNS) will not resolve, which surfaces to an application as a name-resolution failure, not a network-reachability failure — an easy category-confusion in troubleshooting. — CONFIRMED.
13. **Interactions**: required for Interface VPC Endpoint private DNS names to resolve to the endpoint's ENI addresses instead of the public service endpoint; required for EC2 "auto-assign DNS hostname" features.

---

## 15. IPv4

1. **Configuration**: the default addressing scheme for VPCs and subnets; CIDR notation, `/16` to `/28` at the VPC level, `/16` to `/28` at the subnet level too (a subnet's CIDR must be a valid subset of its VPC's CIDR). — CONFIRMED.
11. **Restrictions**: RFC 1918 private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) are typical for VPC CIDRs but not enforced by AWS — non-RFC-1918 ("publicly routable") ranges can technically be used inside a VPC too, with important caveats around actual internet routability and potential conflicts. — CONFIRMED.
12. **Edge cases**: public IPv4 addresses (auto-assigned or EIP) are now a metered, billed resource for every hour they're allocated, following an AWS pricing change — a fact relevant to any cost-modeling logic (see `docs/codebase/ANALYSIS_ENGINE.md` for how this simulator's own cost calculator does or doesn't reflect it). — CONFIRMED (*AWS Public IPv4 Address Charge* announcement/pricing page).

## 16. IPv6

1. **Configuration**: optional, additive to (not a replacement for) IPv4 in a VPC; Amazon-provided `/56` VPC block subdivided into `/64` per subnet (fixed size — unlike IPv4, IPv6 subnets are always exactly `/64`), or a customer-owned IPv6 pool. — CONFIRMED (*Amazon VPC User Guide — IP addressing for your VPC*).
5. **Connectivity**: IPv6 addresses assigned within a VPC are, by AWS design, globally unique/routable by default (no NAT/private-IPv6 concept analogous to IPv4 private ranges) — reachability is still gated the same way as IPv4 (route table + Security Group + NACL), an instance does not become internet-reachable over IPv6 merely by having an IPv6 address, it still needs an IGW route (or an **Egress-Only Internet Gateway** for IPv6 outbound-only, NAT-Gateway-equivalent semantics). — CONFIRMED.
13. **Interactions**: Egress-Only Internet Gateway is the IPv6-specific analogue to a NAT Gateway (outbound-initiated only, no inbound) — CONFIRMED, though this simulator does not model it as a distinct construct (not in the 28-service behavioral list).

## 17. Availability Zones (AZs)

1. **Configuration**: not directly configurable — a Region contains multiple AZs (each one or more discrete physical data centers with independent power/cooling/networking), and AWS maps a friendly per-account AZ name (e.g. `us-east-1a`) to a physical AZ using an account-specific mapping, specifically so that "AZ-a" does not mean the same physical location for every AWS account (spreads load across physical AZs at the fleet level). — CONFIRMED (*AWS documentation — Regions and Zones*, explicitly documents the per-account AZ ID mapping).
5. **Connectivity**: AZs within a Region are connected by high-bandwidth, low-latency private AWS backbone links — traffic between AZs in the same Region does not traverse the public internet. — CONFIRMED.
9. **State**: an AZ can experience a full outage (power, cooling, network) independent of other AZs in the same Region — this is the entire architectural reason AWS documentation recommends Multi-AZ deployment for high availability. — CONFIRMED.
11. **Restrictions**: a subnet, and therefore any ENI/instance within it, is permanently pinned to one AZ; achieving Multi-AZ redundancy requires deploying resources into subnets in multiple distinct AZs, not a configuration flag on a single resource (except where AWS provides a managed abstraction over this, like RDS's "Multi-AZ" flag, which under the hood provisions a standby instance in a second AZ's subnet on the customer's behalf). — CONFIRMED.
13. **Interactions**: every Subnet belongs to exactly one AZ; NAT Gateways, ALB/NLB nodes, and RDS Multi-AZ standbys are all examples of AZ-scoped or AZ-aware resources whose resilience design depends directly on this primitive.
