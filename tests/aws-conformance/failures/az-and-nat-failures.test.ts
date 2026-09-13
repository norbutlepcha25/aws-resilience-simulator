import { runConformanceCases, type ConformanceCase } from '../harness.ts';
import { createFailure, analyzeFailureImpact } from '../../../src/engine/failure/propagation.ts';
import { REFERENCE_ARCHITECTURES } from '../../../src/data/referenceArchitectures.ts';

const haArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'highly-available-multiaz')!;

const CASES: ConformanceCase<any>[] = [
  {
    id: 'FAIL-AZ-001',
    awsBehavior: 'An Availability Zone outage affects only the resources physically deployed in that AZ - resources in a different AZ, and load balancers with a healthy target elsewhere, are unaffected.',
    reference: 'AWS Well-Architected Framework - "Reliability Pillar": Availability Zones are isolated failure domains',
    scenario: 'AZ-A fails in a Highly Available Multi-AZ architecture with an ALB fronting one ECS task per AZ.',
    configuration: { failedAz: 'AZ-A', targets: ['node-ecs-az-a (AZ-A)', 'node-ecs-az-b (AZ-B)'] },
    request: { operation: 'AZ-A outage' },
    expected: { azBAffected: false, albSurvives: true },
    run: () => {
      const failure = createFailure({ targetResourceId: 'AZ-A', failureType: 'az_failure', severity: 'critical', trigger: 'manual' });
      const impact = analyzeFailureImpact(haArch.nodes as any, haArch.edges as any, failure);
      return {
        azBAffected: impact.affectedNodeIds.includes('node-ecs-az-b'),
        albSurvives: impact.survivingNodeIds.includes('node-alb') && !impact.cascadingFailedNodeIds.includes('node-alb')
      };
    },
    explain: (actual) => (!actual.azBAffected && actual.albSurvives)
      ? 'The simulator correctly isolates the AZ-A outage from AZ-B and lets the ALB fail over to its remaining healthy target.'
      : 'The simulator let an AZ-A outage affect AZ-B or the ALB itself - a single AZ failure must never destroy resources in another AZ (or the load balancer routing around it).'
  },
  {
    id: 'FAIL-NAT-001',
    awsBehavior: 'A NAT Gateway is scoped to one Availability Zone with no automatic cross-AZ failover - its outage breaks internet egress only for private-subnet resources routed through it, not intra-VPC traffic (e.g. to a database).',
    reference: 'Amazon VPC User Guide - "NAT gateways": NAT gateways are AZ-scoped',
    scenario: 'A NAT Gateway fails; a private EC2 instance has both an internet-bound dependency and an intra-VPC (RDS) dependency.',
    configuration: { natGateway: 'failed' },
    request: { operation: 'NAT Gateway outage' },
    expected: { egressBlocked: true, intraVpcBlocked: false },
    run: () => {
      const nodes: any[] = [
        { id: 'nat-1', type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId: 'nat_gateway', label: 'NAT', category: 'Networking & Content Delivery', health: 'healthy', az: 'AZ-A', subnet: 'public', replicas: 1, multiAz: false } },
        { id: 'ec2-1', type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId: 'ec2', label: 'Private EC2', category: 'Compute', health: 'healthy', az: 'AZ-A', subnet: 'private', replicas: 1, multiAz: false } },
        { id: 'ext-1', type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId: 'third_party_api', label: 'External API', category: 'Client / Ingress', health: 'healthy', az: 'Edge / Global', subnet: 'global', replicas: 1, multiAz: false } },
        { id: 'rds-1', type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId: 'rds', label: 'RDS', category: 'Databases', health: 'healthy', az: 'AZ-A', subnet: 'private', replicas: 1, multiAz: false } }
      ];
      const edges: any[] = [
        { id: 'e-egress', source: 'ec2-1', target: 'ext-1', data: { protocol: 'HTTPS' } },
        { id: 'e-db', source: 'ec2-1', target: 'rds-1', data: { protocol: 'SQL' } }
      ];
      const failure = createFailure({ targetResourceId: 'nat-1', failureType: 'nat_failure', severity: 'high', trigger: 'manual' });
      const impact = analyzeFailureImpact(nodes, edges, failure);
      return {
        egressBlocked: impact.blockedEdgeIds.includes('e-egress'),
        intraVpcBlocked: impact.blockedEdgeIds.includes('e-db')
      };
    },
    explain: (actual) => (actual.egressBlocked && !actual.intraVpcBlocked)
      ? 'The simulator correctly scopes the NAT Gateway failure to internet-bound egress only, leaving the intra-VPC database path untouched.'
      : 'The simulator either failed to block the internet-bound path or incorrectly blocked the unrelated intra-VPC database path - a NAT Gateway failure should never affect traffic that never touched it.'
  },
  {
    id: 'FAIL-BLAST-RADIUS-001',
    awsBehavior: 'A resource\'s failure cascades to its dependents ONLY when they have no redundancy (no Multi-AZ failover, no cache fallback, no healthy sibling target) - it must not blanket-fail every downstream resource by default.',
    reference: 'AWS Well-Architected Framework - "Reliability Pillar": fault isolation and graceful degradation',
    scenario: 'A Single-AZ RDS instance with a single dependent EC2 application server fails.',
    configuration: { serviceId: 'rds', multiAz: false },
    request: { operation: 'database failure' },
    expected: { cascades: true, redundancyMechanismFound: false },
    run: () => {
      const nodes: any[] = [
        { id: 'ec2-1', type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId: 'ec2', label: 'App Server', category: 'Compute', health: 'healthy', az: 'AZ-A', subnet: 'private', replicas: 1, multiAz: false } },
        { id: 'rds-1', type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId: 'rds', label: 'RDS', category: 'Databases', health: 'healthy', az: 'AZ-A', subnet: 'private', replicas: 1, multiAz: false } }
      ];
      const edges: any[] = [{ id: 'e1', source: 'ec2-1', target: 'rds-1', data: { protocol: 'SQL' } }];
      const failure = createFailure({ targetResourceId: 'rds-1', failureType: 'database_unavailable', severity: 'critical', trigger: 'manual' });
      const impact = analyzeFailureImpact(nodes, edges, failure);
      return {
        cascades: impact.cascadingFailedNodeIds.includes('ec2-1'),
        redundancyMechanismFound: impact.survivingNodeIds.includes('ec2-1')
      };
    },
    explain: (actual) => (actual.cascades && !actual.redundancyMechanismFound)
      ? 'The simulator correctly cascades the database failure to its sole, non-redundant dependent - there is genuinely no Multi-AZ failover or cache fallback here.'
      : 'The simulator either failed to cascade a genuinely unrecoverable failure, or falsely reported a redundancy mechanism that does not exist in this configuration.'
  }
];

runConformanceCases(CASES);
