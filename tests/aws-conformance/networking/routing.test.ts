import { runConformanceCases, type ConformanceCase } from '../harness.ts';
import { resolveRoute, buildPublicRouteTable, buildPrivateRouteTable, type RouteTable } from '../../../src/engine/network/routeTable.ts';
import { validateNatGatewayPlacement, resolveNatEgress } from '../../../src/engine/network/nat.ts';

interface RouteResult { targetType: string | null; blocked: boolean }
interface NatResult { outcome: string }

const customTable: RouteTable = {
  id: 'rtb-1',
  label: 'Custom Route Table',
  routes: [
    { destinationCidr: '10.0.0.0/16', target: { type: 'local', label: 'local' } },
    { destinationCidr: '10.0.1.0/24', target: { type: 'vpce', targetId: 'vpce-1', label: 'S3 Gateway Endpoint' } },
    { destinationCidr: '0.0.0.0/0', target: { type: 'igw', targetId: 'igw-1', label: 'Internet Gateway' } }
  ]
};

const CASES: ConformanceCase<any>[] = [
  {
    id: 'NET-ROUTE-001',
    awsBehavior: 'Every VPC route table has an immutable, implicit "local" route for the VPC\'s own CIDR block, enabling routing between all subnets in the VPC.',
    reference: 'Amazon VPC User Guide - "Route tables": the local route',
    scenario: 'A route table for VPC 10.0.0.0/16 is asked to resolve a destination inside the VPC.',
    configuration: { routes: customTable.routes.map(r => r.destinationCidr) },
    request: { destination: '10.0.5.10' },
    expected: { targetType: 'local', blocked: false },
    run: () => {
      const r = resolveRoute(customTable, '10.0.5.10');
      return { targetType: r.selectedRoute?.target.type ?? null, blocked: r.selectedRoute === null };
    },
    explain: (actual) => actual.targetType === 'local'
      ? 'The simulator correctly resolves an in-VPC destination via the implicit local route.'
      : `The simulator resolved to "${actual.targetType}" instead of the implicit local route.`
  },
  {
    id: 'NET-ROUTE-002',
    awsBehavior: 'When multiple routes cover a destination, AWS selects the MOST SPECIFIC route (longest prefix match), regardless of the routes\' order in the table.',
    reference: 'Amazon VPC User Guide - "Route tables": route priority (longest prefix match)',
    scenario: 'A destination (10.0.1.55) matches both a broad VPC-local /16 route and a more specific /24 VPC-endpoint route.',
    configuration: { routes: customTable.routes.map(r => r.destinationCidr) },
    request: { destination: '10.0.1.55' },
    expected: { targetType: 'vpce', blocked: false },
    run: () => {
      const r = resolveRoute(customTable, '10.0.1.55');
      return { targetType: r.selectedRoute?.target.type ?? null, blocked: r.selectedRoute === null };
    },
    explain: (actual) => actual.targetType === 'vpce'
      ? 'The simulator correctly prefers the more specific /24 route over the broader /16 local route.'
      : `The simulator selected "${actual.targetType}" - AWS always prefers the longest matching prefix, which here is the /24 VPC endpoint route.`
  },
  {
    id: 'NET-ROUTE-003',
    awsBehavior: 'A destination with no matching route in the table (not even a default 0.0.0.0/0) has no path at all - traffic to it is dropped.',
    reference: 'Amazon VPC User Guide - "Route tables": routes',
    scenario: 'A route table with only a local route and no default route is asked to resolve an external destination.',
    configuration: { routes: ['10.0.0.0/16'] },
    request: { destination: '8.8.8.8' },
    expected: { targetType: null, blocked: true },
    run: () => {
      const noDefaultTable: RouteTable = { id: 'rtb-2', routes: [{ destinationCidr: '10.0.0.0/16', target: { type: 'local' } }] };
      const r = resolveRoute(noDefaultTable, '8.8.8.8');
      return { targetType: r.selectedRoute?.target.type ?? null, blocked: r.selectedRoute === null };
    },
    explain: (actual) => actual.blocked
      ? 'The simulator correctly reports no route (and thus no path) when nothing in the table covers the destination.'
      : 'The simulator resolved a route for a destination nothing in the table actually covers.'
  },
  {
    id: 'NET-ROUTE-004',
    awsBehavior: 'A public subnet\'s route table sends 0.0.0.0/0 traffic to an Internet Gateway.',
    reference: 'Amazon VPC User Guide - "Route tables": public subnet',
    scenario: 'A standard public-subnet route table (built via the simulator\'s own helper) resolves an external destination.',
    configuration: { helper: 'buildPublicRouteTable' },
    request: { destination: '1.1.1.1' },
    expected: { targetType: 'igw', blocked: false },
    run: () => {
      const table = buildPublicRouteTable('rtb-public', '10.0.0.0/16', 'igw-1');
      const r = resolveRoute(table, '1.1.1.1');
      return { targetType: r.selectedRoute?.target.type ?? null, blocked: r.selectedRoute === null };
    },
    explain: (actual) => actual.targetType === 'igw'
      ? 'A public subnet\'s default route correctly points external traffic at the Internet Gateway.'
      : `Expected the Internet Gateway route, got "${actual.targetType}".`
  },
  {
    id: 'NET-ROUTE-005',
    awsBehavior: 'A private subnet\'s route table sends 0.0.0.0/0 traffic to a NAT Gateway, never directly to an Internet Gateway.',
    reference: 'Amazon VPC User Guide - "NAT gateways": private subnet routing',
    scenario: 'A standard private-subnet route table (built via the simulator\'s own helper) resolves an external destination.',
    configuration: { helper: 'buildPrivateRouteTable' },
    request: { destination: '1.1.1.1' },
    expected: { targetType: 'nat', blocked: false },
    run: () => {
      const table = buildPrivateRouteTable('rtb-private', '10.0.0.0/16', 'nat-1');
      const r = resolveRoute(table, '1.1.1.1');
      return { targetType: r.selectedRoute?.target.type ?? null, blocked: r.selectedRoute === null };
    },
    explain: (actual) => actual.targetType === 'nat'
      ? 'A private subnet\'s default route correctly points external traffic at the NAT Gateway.'
      : `Expected the NAT Gateway route, got "${actual.targetType}".`
  },
  {
    id: 'NET-IGW-001',
    awsBehavior: 'A NAT Gateway must be deployed in a PUBLIC subnet (one with a route to an Internet Gateway) to have any path to the internet at all.',
    reference: 'Amazon VPC User Guide - "NAT gateways": NAT gateway basics',
    scenario: 'A NAT Gateway is deployed in a private subnet instead of a public one.',
    configuration: { natSubnet: 'private' },
    request: { operation: 'validate NAT Gateway placement' },
    expected: { outcome: 'misplaced' },
    run: (): NatResult => ({ outcome: validateNatGatewayPlacement('NAT-1', 'private').outcome }),
    explain: (actual) => actual.outcome === 'misplaced'
      ? 'The simulator correctly rejects a NAT Gateway placed outside a public subnet.'
      : 'The simulator failed to flag a NAT Gateway with no route to an Internet Gateway.'
  },
  {
    id: 'NET-NAT-001',
    awsBehavior: 'A private-subnet resource with no NAT Gateway (and no VPC endpoint) has no route to the internet - outbound requests time out.',
    reference: 'Amazon VPC User Guide - "NAT gateways": private subnet egress',
    scenario: 'A private EC2 instance attempts an outbound HTTPS call with no NAT Gateway present anywhere in the VPC.',
    configuration: { natGateway: null },
    request: { source: 'EC2-Private', destination: 'api.example.com' },
    expected: { outcome: 'missing' },
    run: (): NatResult => ({ outcome: resolveNatEgress('EC2-Private', 'api.example.com', undefined).outcome }),
    explain: (actual) => actual.outcome === 'missing'
      ? 'The simulator correctly identifies that private-subnet egress has no path without a NAT Gateway.'
      : 'The simulator allowed private-subnet egress with no NAT Gateway present - AWS has no such path.'
  },
  {
    id: 'NET-NAT-002',
    awsBehavior: 'A NAT Gateway is a single, AZ-scoped managed resource - if it is unhealthy, every private-subnet resource routed through it loses egress.',
    reference: 'Amazon VPC User Guide - "NAT gateways": NAT Gateway is a managed, single point per AZ',
    scenario: 'A private EC2 instance attempts egress through a NAT Gateway that is currently unhealthy.',
    configuration: { natGateway: { label: 'NAT-1', health: 'failed' } },
    request: { source: 'EC2-Private', destination: 'api.example.com' },
    expected: { outcome: 'failed' },
    run: (): NatResult => ({ outcome: resolveNatEgress('EC2-Private', 'api.example.com', { label: 'NAT-1', health: 'failed' }).outcome }),
    explain: (actual) => actual.outcome === 'failed'
      ? 'The simulator correctly propagates a failed NAT Gateway to every dependent egress request.'
      : 'The simulator did not detect that egress depends on the NAT Gateway\'s health.'
  }
];

runConformanceCases(CASES);
