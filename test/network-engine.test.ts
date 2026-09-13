// Unit tests for the standalone AWS networking behavioral engine (src/engine/network/) -
// Phase 5 of docs/target-architecture/MIGRATION_PLAN.md. These test the engine's primitives in
// isolation (CIDR math, route resolution, NACL/SG rule evaluation, NAT chain validation) rather
// than the live per-hop simulator trace, which is already covered end-to-end by test/engine.test.ts
// (NOT modified here - every one of its 50 tests must keep passing unchanged).
import assert from 'node:assert';
import test from 'node:test';

import { cidrContains, cidrsOverlap, parsePortRange, portInRange, pickMostSpecific } from '../src/engine/network/cidr.ts';
import { resolveRoute, buildPublicRouteTable, buildPrivateRouteTable, type RouteTable } from '../src/engine/network/routeTable.ts';
import { evaluateNaclRules } from '../src/engine/network/nacl.ts';
import { evaluateSecurityGroup, legacyAllowedProtocolsToRules, type SecurityGroupRules } from '../src/engine/network/securityGroup.ts';
import { validateNatGatewayPlacement, resolveNatEgress } from '../src/engine/network/nat.ts';
import { buildPacket, derivePlaceholderIp } from '../src/engine/network/packet.ts';
import { formatDecisionTrace } from '../src/engine/network/explain.ts';
import { checkNetworkFirewalls } from '../src/engine/simulation/networkFirewalls.ts';
import type { NaclRule, SimulationScenario } from '../src/types/index.ts';

// ---------------------------------------------------------------------------
// CIDR math
// ---------------------------------------------------------------------------

test('N1. CIDR Containment: A Subnet Block Is Contained Within Its VPC, Not Vice Versa', () => {
  assert.strictEqual(cidrContains('10.0.0.0/16', '10.0.1.0/24'), true, 'A /24 subnet must be contained in its /16 VPC');
  assert.strictEqual(cidrContains('10.0.1.0/24', '10.0.0.0/16'), false, 'A /16 VPC is broader than a /24 - it cannot be "contained" in the subnet');
  assert.strictEqual(cidrContains('10.0.0.0/16', '10.1.0.0/24'), false, 'A block from a different /16 range is not contained');
  assert.strictEqual(cidrContains('10.0.0.0/24', '10.0.0.5'), true, 'A bare IP inside the block is contained (treated as /32)');
  assert.strictEqual(cidrContains('10.0.0.0/24', '10.0.1.5'), false, 'A bare IP outside the block is not contained');
});

test('N2. CIDR Overlap: Detects Address-Space Collisions Regardless of Direction', () => {
  assert.strictEqual(cidrsOverlap('10.0.0.0/24', '10.0.0.128/25'), true, 'A sub-block overlaps its parent block');
  assert.strictEqual(cidrsOverlap('10.0.0.0/24', '10.0.1.0/24'), false, 'Adjacent, non-overlapping /24s must not overlap');
  assert.strictEqual(cidrsOverlap('0.0.0.0/0', '172.16.5.0/24'), true, 'Every block overlaps the all-addresses CIDR');
  assert.strictEqual(cidrsOverlap('not-a-cidr', '10.0.0.0/24'), false, 'Malformed input must fail closed (no overlap), never throw');
});

test('N3. CIDR: Port-Range Parsing and Matching', () => {
  assert.deepStrictEqual(parsePortRange('443'), { min: 443, max: 443 });
  assert.deepStrictEqual(parsePortRange('1024-65535'), { min: 1024, max: 65535 });
  assert.deepStrictEqual(parsePortRange('All'), { min: 0, max: 65535 });
  assert.deepStrictEqual(parsePortRange(undefined), { min: 0, max: 65535 });
  assert.strictEqual(portInRange(443, parsePortRange('1024-65535')), false);
  assert.strictEqual(portInRange(2048, parsePortRange('1024-65535')), true);
});

test('N4. CIDR: Longest-Prefix-Match Picks the Most Specific Candidate', () => {
  const candidates = [{ cidr: '0.0.0.0/0', id: 'default' }, { cidr: '10.0.0.0/16', id: 'vpc-local' }, { cidr: '10.0.1.0/24', id: 'subnet-local' }];
  assert.strictEqual(pickMostSpecific(candidates)!.id, 'subnet-local', 'The /24 is more specific than the /16 or the default route');
  assert.strictEqual(pickMostSpecific([])!, null as any, 'Empty candidate list resolves to null');
});

// ---------------------------------------------------------------------------
// Route Table resolution
// ---------------------------------------------------------------------------

test('N5. Route Resolution: Public Subnet Sends Internet-Bound Traffic to the Internet Gateway', () => {
  const table = buildPublicRouteTable('rt-public', '10.0.0.0/16', 'igw-1', 'Main IGW');
  const resolution = resolveRoute(table, '8.8.8.8');

  assert.ok(resolution.selectedRoute, 'A default route must be selected for an internet destination');
  assert.strictEqual(resolution.selectedRoute!.target.type, 'igw');
  assert.strictEqual(resolution.selectedRoute!.destinationCidr, '0.0.0.0/0');
  assert.ok(resolution.reason.includes('igw'), 'Reason must name the selected route target type');

  // The local VPC route exists in the same table but must be explicitly rejected as "less specific".
  const localAlternative = resolution.alternatives.find(a => a.route.target.type === 'local');
  assert.ok(localAlternative, 'The local route must appear as a considered alternative');
  assert.ok(localAlternative!.whyNotSelected.includes('does not contain'), 'Local VPC route does not cover an internet destination, so it is correctly excluded, not just out-prefixed');
});

test('N6. Route Resolution: Intra-VPC Traffic Prefers the Local Route Over the Default Route', () => {
  const table = buildPublicRouteTable('rt-public', '10.0.0.0/16', 'igw-1');
  const resolution = resolveRoute(table, '10.0.5.20');

  assert.strictEqual(resolution.selectedRoute!.target.type, 'local', 'A destination inside the VPC CIDR must resolve to the local route, not the internet default route');
  const defaultAlternative = resolution.alternatives.find(a => a.route.destinationCidr === '0.0.0.0/0');
  assert.ok(defaultAlternative!.whyNotSelected.includes('more specific'), 'Must explain the local route won because it is more specific, not because the default route was invalid');
});

test('N7. Route Resolution: Private Subnet Egress Resolves to the NAT Gateway', () => {
  const table = buildPrivateRouteTable('rt-private', '10.0.0.0/16', 'nat-1', 'NAT GW A');
  const resolution = resolveRoute(table, '93.184.216.34');
  assert.strictEqual(resolution.selectedRoute!.target.type, 'nat');
  assert.strictEqual(resolution.selectedRoute!.target.targetId, 'nat-1');
});

test('N8. Route Resolution: Missing Route Is Explained, Not Silently Allowed', () => {
  const emptyTable: RouteTable = { id: 'rt-empty', routes: [{ destinationCidr: '10.0.0.0/16', target: { type: 'local' } }] };
  const resolution = resolveRoute(emptyTable, '203.0.113.9');

  assert.strictEqual(resolution.selectedRoute, null, 'No route covers a destination outside the VPC and there is no default route');
  assert.ok(resolution.reason.includes('No route'), 'Must explicitly say no route covers the destination');
  assert.strictEqual(resolution.alternatives.length, 1, 'The local route is still reported as a considered-but-non-matching alternative');
});

test('N9. Route Resolution: Invalid Destination Is Rejected, Not Crashed On', () => {
  const table = buildPublicRouteTable('rt', '10.0.0.0/16', 'igw-1');
  const resolution = resolveRoute(table, 'not-an-ip');
  assert.strictEqual(resolution.selectedRoute, null);
  assert.ok(resolution.reason.includes('not a valid'), 'Must explain the destination itself is malformed');
});

// ---------------------------------------------------------------------------
// NACL: first-match ordering, stateless behavior, denial
// ---------------------------------------------------------------------------

test('N10. NACL: Rules Evaluate in Ascending Rule-Number Order Regardless of Array Order', () => {
  // Rule 200 (DENY) is listed FIRST in the array but rule 100 (ALLOW) has the lower number and
  // must be checked first - first-match by rule number, not by array position.
  const rules: NaclRule[] = [
    { ruleNumber: 200, type: 'HTTP', protocol: 'TCP', portRange: '80', cidr: '0.0.0.0/0', action: 'DENY' },
    { ruleNumber: 100, type: 'HTTP', protocol: 'TCP', portRange: '80', cidr: '0.0.0.0/0', action: 'ALLOW' }
  ];
  const result = evaluateNaclRules(rules, 'HTTP');
  assert.strictEqual(result.blocked, false, 'Rule 100 (ALLOW) must win because it has the lower rule number');
  assert.strictEqual(result.decidingRule.ruleNumber, 100);
  assert.strictEqual(result.evaluatedRules[0].rule.ruleNumber, 100, 'Rule 100 must be the first one evaluated');
});

test('N11. NACL: First Match Wins - a Later, More Specific Rule Never Overrides an Earlier Match', () => {
  const rules: NaclRule[] = [
    { ruleNumber: 50, type: 'ALL TRAFFIC', protocol: 'ALL', portRange: 'All', cidr: '0.0.0.0/0', action: 'DENY' },
    { ruleNumber: 60, type: 'HTTPS', protocol: 'TCP', portRange: '443', cidr: '0.0.0.0/0', action: 'ALLOW' }
  ];
  const result = evaluateNaclRules(rules, 'HTTPS');
  assert.strictEqual(result.blocked, true, 'Rule 50 (broad DENY) matches first and wins, even though rule 60 would otherwise allow HTTPS specifically');
  assert.strictEqual(result.decidingRule.ruleNumber, 50);
});

test('N12. NACL: Implicit Final DENY (Rule 32767) When Nothing Configured Matches', () => {
  const rules: NaclRule[] = [{ ruleNumber: 90, type: 'HTTP', protocol: 'TCP', portRange: '80', cidr: '0.0.0.0/0', action: 'ALLOW' }];
  const result = evaluateNaclRules(rules, 'SQL');
  assert.strictEqual(result.blocked, true);
  assert.strictEqual(result.decidingRule.ruleNumber, 32767, 'Unmatched traffic must be denied by the synthetic implicit-deny rule');
  assert.ok(result.evaluatedRules.every(r => r.rule.ruleNumber !== 32767 ? true : r.matched), 'Implicit deny entry must be recorded as the matching entry in the explainability list');
});

test('N13. NACL Is Stateless: An Allowed Inbound Rule Does Not Imply Anything About the Return Direction', () => {
  // Contrast with Security Group statefulness (N16/N17 below): a NACL evaluation never takes
  // "was this connection already allowed the other way" into account - each direction is scored
  // independently, from its own rule list, every time.
  const inboundAllow: NaclRule[] = [{ ruleNumber: 100, type: 'HTTPS', protocol: 'TCP', portRange: '443', cidr: '0.0.0.0/0', action: 'ALLOW' }];
  const outboundRulesForReturn: NaclRule[] = []; // no ephemeral-port return rule configured
  const inboundResult = evaluateNaclRules(inboundAllow, 'HTTPS');
  const returnResult = evaluateNaclRules(outboundRulesForReturn, 'HTTPS', { port: 51000 });

  assert.strictEqual(inboundResult.blocked, false, 'The forward request is allowed');
  assert.strictEqual(returnResult.blocked, true, 'The return leg has its own empty rule list and is independently denied by the implicit final DENY - allowing the forward direction bought it nothing');
});

// ---------------------------------------------------------------------------
// Security Group: real rule semantics, CIDR, SG references, statefulness
// ---------------------------------------------------------------------------

test('N14. Security Group: Protocol + Port + CIDR Source Matching (Not a Bare Service-Name List)', () => {
  const rules: SecurityGroupRules = {
    inbound: [{ protocol: 'TCP', portRange: '443', source: { type: 'cidr', cidr: '10.0.1.0/24' } }],
    outbound: []
  };

  const fromAllowedSubnet = evaluateSecurityGroup(rules, { direction: 'inbound', protocol: 'TCP', port: 443, sourceCidr: '10.0.1.55', connectionState: 'new' });
  assert.strictEqual(fromAllowedSubnet.allowed, true, 'Traffic from within the allow-listed CIDR on the allowed port must pass');

  const wrongPort = evaluateSecurityGroup(rules, { direction: 'inbound', protocol: 'TCP', port: 8080, sourceCidr: '10.0.1.55', connectionState: 'new' });
  assert.strictEqual(wrongPort.allowed, false, 'Same source and protocol but a port outside the rule must be denied');

  const wrongSource = evaluateSecurityGroup(rules, { direction: 'inbound', protocol: 'TCP', port: 443, sourceCidr: '172.31.0.5', connectionState: 'new' });
  assert.strictEqual(wrongSource.allowed, false, 'Same protocol and port but from outside the allow-listed CIDR must be denied');
});

test('N15. Security Group: Rules Can Reference Another Security Group Instead of a CIDR', () => {
  const rules: SecurityGroupRules = {
    inbound: [{ protocol: 'SQL', portRange: 'ALL', source: { type: 'securityGroup', securityGroupId: 'sg-app-tier' } }],
    outbound: []
  };

  const fromAppTier = evaluateSecurityGroup(rules, { direction: 'inbound', protocol: 'SQL', peerSecurityGroupIds: ['sg-app-tier'], connectionState: 'new' });
  assert.strictEqual(fromAppTier.allowed, true, 'A peer carrying the referenced Security Group id must be allowed, regardless of its actual address');

  const fromUnrelatedGroup = evaluateSecurityGroup(rules, { direction: 'inbound', protocol: 'SQL', peerSecurityGroupIds: ['sg-public-web'], connectionState: 'new' });
  assert.strictEqual(fromUnrelatedGroup.allowed, false, 'A peer without the referenced Security Group id must be denied, even on the right protocol');
});

test('N16. Security Group Is Stateful: An Established Connection\'s Return Traffic Needs No Matching Rule', () => {
  const rules: SecurityGroupRules = { inbound: [], outbound: [] }; // deliberately zero rules in either direction
  const established = evaluateSecurityGroup(rules, { direction: 'outbound', protocol: 'HTTPS', connectionState: 'established' });
  assert.strictEqual(established.allowed, true, 'Statefulness alone permits the reply, even with an empty outbound rule set');

  const newConnectionSameRules = evaluateSecurityGroup(rules, { direction: 'outbound', protocol: 'HTTPS', connectionState: 'new' });
  assert.strictEqual(newConnectionSameRules.allowed, false, 'A brand-new connection against the same empty rule set is correctly denied - only an already-established flow is exempt');
});

test('N17. Security Group: Legacy allowedProtocols List Still Evaluates Through the Same Real Engine', () => {
  const rules = legacyAllowedProtocolsToRules(['SQL', 'HTTPS']);
  const allowed = evaluateSecurityGroup(rules, { direction: 'inbound', protocol: 'SQL', connectionState: 'new' });
  const denied = evaluateSecurityGroup(rules, { direction: 'inbound', protocol: 'HTTP', connectionState: 'new' });
  assert.strictEqual(allowed.allowed, true);
  assert.strictEqual(denied.allowed, false, 'A protocol absent from the legacy list must still be denied');
});

test('N18. Security Group Reference Enforcement Through the Live Firewall Check', () => {
  // End-to-end (but still below the full runSimulation trace): an RDS instance whose Security
  // Group only allows SQL from an app-tier Security Group, exercised via checkNetworkFirewalls
  // with the real source node passed through (the new 4th parameter).
  const appSg: any = { id: 'sg-app', type: 'boundaryNode', position: { x: 0, y: 0 }, data: { boundaryType: 'security_group', width: 50, height: 50, label: 'App SG' } };
  const dbSg: any = {
    id: 'sg-db', type: 'boundaryNode', position: { x: 100, y: 0 },
    data: {
      boundaryType: 'security_group', width: 50, height: 50, label: 'DB SG',
      securityGroupRules: { inbound: [{ protocol: 'SQL', portRange: 'ALL', source: { type: 'securityGroup', securityGroupId: 'sg-app' } }], outbound: [] }
    }
  };
  const appServer: any = { id: 'app1', position: { x: 0, y: 50 }, data: { serviceId: 'ec2', securityGroupIds: ['sg-app'] } };
  const otherServer: any = { id: 'other1', position: { x: 0, y: 50 }, data: { serviceId: 'ec2', securityGroupIds: [] } };
  const db: any = { id: 'db1', position: { x: 100, y: 50 }, data: { serviceId: 'rds', securityGroupIds: ['sg-db'] } };
  const boundaries = [appSg, dbSg];

  const fromApp = checkNetworkFirewalls('SQL', db, boundaries, appServer);
  assert.strictEqual(fromApp.securityGroup.blocked, false, 'The app-tier server carries the referenced Security Group and must be allowed');

  const fromOther = checkNetworkFirewalls('SQL', db, boundaries, otherServer);
  assert.strictEqual(fromOther.securityGroup.blocked, true, 'A server without the referenced Security Group must be blocked, even on the same protocol');
});

// ---------------------------------------------------------------------------
// NAT Gateway chain: private resource -> NAT -> IGW -> Internet
// ---------------------------------------------------------------------------

test('N19. NAT: A NAT Gateway Deployed in a Private Subnet Cannot Reach the Internet', () => {
  const decision = validateNatGatewayPlacement('NAT GW', 'private');
  assert.strictEqual(decision.outcome, 'misplaced');
  assert.strictEqual(decision.statusCode, 502);
});

test('N20. NAT: Egress Resolution Distinguishes Missing vs Failed vs Healthy Gateway', () => {
  const missing = resolveNatEgress('App Server', 'Payment API', undefined);
  assert.strictEqual(missing.outcome, 'missing');
  assert.strictEqual(missing.statusCode, 504);

  const failed = resolveNatEgress('App Server', 'Payment API', { label: 'NAT GW', health: 'failed' });
  assert.strictEqual(failed.outcome, 'failed');
  assert.strictEqual(failed.statusCode, 504);

  const healthy = resolveNatEgress('App Server', 'Payment API', { label: 'NAT GW', health: 'healthy' });
  assert.strictEqual(healthy.outcome, 'ok');
  assert.ok(healthy.explanation.includes('Payment API'), 'A successful SNAT hop must name the actual destination, not just the NAT Gateway itself');
});

// ---------------------------------------------------------------------------
// Packet model and explainability
// ---------------------------------------------------------------------------

test('N21. Packet Model: Deterministic Fields Derived From Real Canvas Data', () => {
  const source: any = { id: 'node-web', data: { label: 'Web Server', serviceId: 'ec2' } };
  const destination: any = { id: 'node-db', data: { label: 'Database', serviceId: 'rds' } };
  const scenario: SimulationScenario = { id: 's1', name: 'Test', method: 'GET', path: '/orders', startNodeId: 'node-web', trafficLevel: 'normal' };

  const packet = buildPacket(source, destination, 'SQL', scenario);
  assert.strictEqual(packet.service, 'rds');
  assert.strictEqual(packet.destinationPort, 3306);
  assert.strictEqual(packet.requestContext.path, '/orders');
  assert.strictEqual(packet.source.ip, derivePlaceholderIp('node-web'), 'IP must be deterministically derived from the node id');
  assert.strictEqual(derivePlaceholderIp('node-web'), derivePlaceholderIp('node-web'), 'Same node id must always yield the same placeholder IP within a run');
});

test('N22. Explainability: Renders the Route / NACL / Security Group / RESULT Trace Block', () => {
  const source: any = { id: 'node-web', data: { label: 'Web Server', serviceId: 'ec2' } };
  const destination: any = { id: 'node-db', data: { label: 'Database', serviceId: 'rds' } };
  const scenario: SimulationScenario = { id: 's1', name: 'Test', method: 'GET', path: '/orders', startNodeId: 'node-web', trafficLevel: 'normal' };
  const packet = buildPacket(source, destination, 'HTTPS', scenario);

  const nacl = evaluateNaclRules([{ ruleNumber: 100, type: 'HTTPS', protocol: 'TCP', portRange: '443', cidr: '0.0.0.0/0', action: 'ALLOW' }], 'HTTPS');
  const sg = evaluateSecurityGroup(legacyAllowedProtocolsToRules(['HTTPS']), { direction: 'inbound', protocol: 'HTTPS', connectionState: 'new' });

  const text = formatDecisionTrace({ packet, nacl, securityGroup: sg, allowed: true });
  assert.ok(text.includes('Route:') === false, 'No route stage was supplied, so it must not appear in the block');
  assert.ok(text.includes('NACL:'));
  assert.ok(text.includes('Rule 100 → ALLOW'));
  assert.ok(text.includes('Security Group:'));
  assert.ok(text.includes('RESULT:'));
  assert.ok(text.includes('NETWORK CONNECTION ALLOWED'));
});

// ---------------------------------------------------------------------------
// Invalid configuration handling
// ---------------------------------------------------------------------------

test('N23. Invalid Configuration: Malformed CIDRs Fail Closed, Never Throw', () => {
  assert.doesNotThrow(() => cidrContains('garbage', '10.0.0.0/24'));
  assert.doesNotThrow(() => cidrsOverlap('10.0.0.0/24', ''));
  assert.strictEqual(cidrContains('garbage', '10.0.0.0/24'), false);

  const table: RouteTable = { id: 'rt', routes: [{ destinationCidr: 'not-a-cidr', target: { type: 'local' } }] };
  const resolution = resolveRoute(table, '10.0.0.5');
  assert.strictEqual(resolution.selectedRoute, null, 'A malformed route entry can never match a valid destination, and must not crash resolution');
});

test('N24. Denied Traffic Is Always Explained, Not Just Flagged', () => {
  const naclDeny = evaluateNaclRules([], 'HTTPS');
  assert.strictEqual(naclDeny.blocked, true);
  assert.ok(naclDeny.reason.length > 0);

  const sgDeny = evaluateSecurityGroup({ inbound: [], outbound: [] }, { direction: 'inbound', protocol: 'HTTPS', connectionState: 'new' });
  assert.strictEqual(sgDeny.allowed, false);
  assert.ok(sgDeny.reason.includes('No inbound rules'), 'An empty rule set must explain itself as allow-list-only, not just say "denied"');
});
