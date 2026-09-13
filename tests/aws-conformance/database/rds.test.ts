import { runConformanceCases, type ConformanceCase } from '../harness.ts';
import { runSimulation } from '../../../src/engine/simulation/requestSimulator.ts';
import { resolveServiceModel } from '../../../src/engine/service/registry.ts';
import { validateArchitecture } from '../../../src/engine/validation/index.ts';
import { analyzeArchitectureFindings } from '../../../src/engine/analysis/architecturalFindings.ts';
import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData, SimulationScenario } from '../../../src/types/index.ts';

function svc(id: string, serviceId: string, overrides: Partial<ServiceNodeData> = {}): Node<ServiceNodeData> {
  return { id, type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId, label: id, category: 'Databases', health: 'healthy', az: 'AZ-A', subnet: 'private', replicas: 1, multiAz: false, ...overrides } };
}
function edge(id: string, source: string, target: string, protocol = 'SQL'): Edge<ConnectionData> {
  return { id, source, target, type: 'custom', data: { protocol: protocol as any, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 3000 } };
}
const scenario = (startNodeId: string): SimulationScenario => ({ id: 's', name: 'GET', method: 'GET', path: '/', startNodeId, trafficLevel: 'normal' });

const CASES: ConformanceCase<any>[] = [
  {
    id: 'SVC-RDS-MODEL-001',
    awsBehavior: 'RDS is one of the "deeply supported" services with a dedicated behavioral model.',
    reference: 'Simulator-internal: engine/service/registry.ts (regression guard)',
    scenario: 'Resolving the service model for serviceId "rds".',
    configuration: {},
    request: { serviceId: 'rds' },
    expected: { tier: 1 },
    run: () => ({ tier: resolveServiceModel('rds')?.tier }),
    explain: (actual) => actual.tier === 1 ? 'RDS correctly resolves to a Tier 1 model.' : 'RDS unexpectedly did not resolve to a Tier 1 model.'
  },
  {
    id: 'SVC-RDS-CONFIG-001',
    awsBehavior: 'A Single-AZ RDS instance is a documented, real single point of failure - it has no automatic standby to fail over to.',
    reference: 'Amazon RDS User Guide - "High availability (Multi-AZ) for Amazon RDS"',
    scenario: 'A Single-AZ RDS instance (no Multi-AZ, no read replica) is analyzed for architectural risk.',
    configuration: { multiAz: false },
    request: { operation: 'architectural analysis' },
    expected: { hasRedundancyFinding: true },
    run: () => {
      const rds = svc('rds-1', 'rds', { multiAz: false });
      const findings = analyzeArchitectureFindings([rds], []);
      return { hasRedundancyFinding: findings.some(f => f.subcategory === 'redundancy' && f.resourceId === 'rds-1') };
    },
    explain: (actual) => actual.hasRedundancyFinding
      ? 'The simulator correctly flags a Single-AZ RDS instance as lacking redundancy.'
      : 'The simulator failed to flag a Single-AZ RDS instance as a redundancy risk.'
  },
  {
    id: 'SVC-RDS-SUCCESS-001',
    awsBehavior: 'A healthy RDS instance accepts SQL connections from an application tier permitted by its network configuration.',
    reference: 'Amazon RDS User Guide - "Connecting to a DB instance"',
    scenario: 'An EC2 application server connects to a healthy RDS instance.',
    configuration: { health: 'healthy' },
    request: { protocol: 'SQL' },
    expected: { success: true },
    run: () => {
      const ec2 = svc('ec2-1', 'ec2', { category: 'Compute' });
      const rds = svc('rds-1', 'rds');
      const result = runSimulation([ec2, rds], [edge('e1', 'ec2-1', 'rds-1')], scenario('ec2-1'));
      return { success: result.success };
    },
    explain: (actual) => actual.success ? 'The simulator correctly serves a SQL request against a healthy RDS instance.' : 'Request unexpectedly failed against a healthy RDS instance.'
  },
  {
    id: 'SVC-RDS-NETWORK-FAILURE-001',
    awsBehavior: 'An RDS instance\'s Security Group must explicitly permit the application tier\'s inbound traffic - without a matching rule, the connection is denied.',
    reference: 'Amazon RDS User Guide - "Controlling access with security groups"',
    scenario: 'An EC2 application server attempts to connect to RDS, but the RDS Security Group has no matching inbound rule.',
    configuration: { securityGroup: 'no matching rule' },
    request: { protocol: 'SQL' },
    expected: { success: false, statusCode: 403 },
    run: () => {
      const sg = { id: 'sg-1', type: 'boundaryNode', position: { x: 0, y: 0 }, data: { label: 'RDS-SG', boundaryType: 'security_group', width: 100, height: 100, securityGroupRules: { inbound: [], outbound: [] } } };
      const ec2 = svc('ec2-1', 'ec2', { category: 'Compute' });
      const rds = svc('rds-1', 'rds', { securityGroupIds: ['sg-1'] });
      const result = runSimulation([ec2, rds, sg] as any, [edge('e1', 'ec2-1', 'rds-1')], scenario('ec2-1'));
      return { success: result.success, statusCode: result.statusCode };
    },
    explain: (actual) => actual.statusCode === 403
      ? 'The simulator correctly blocks the connection when RDS\'s Security Group has no matching inbound rule.'
      : `Got status ${actual.statusCode} - an RDS Security Group with zero inbound rules should deny all connections.`
  },
  {
    id: 'SVC-RDS-IAM-N/A-001',
    awsBehavior: 'By default, RDS authenticates database connections with database credentials (username/password), not IAM - IAM database authentication is an optional, separately-enabled feature. A plain SQL connection is therefore not an IAM-authorized action.',
    reference: 'Amazon RDS User Guide - "IAM database authentication" (opt-in feature; default is database-native auth)',
    scenario: 'An EC2 instance with no IAM role connects to RDS over SQL (default database-credential authentication).',
    configuration: { iamRole: 'none', iamDbAuth: 'not enabled' },
    request: { protocol: 'SQL' },
    expected: { hasIamFinding: false },
    run: () => {
      const ec2 = svc('ec2-1', 'ec2', { category: 'Compute' });
      const rds = svc('rds-1', 'rds');
      const findings = validateArchitecture([ec2, rds], [edge('e1', 'ec2-1', 'rds-1')]);
      return { hasIamFinding: findings.some(f => f.subcategory === 'iam' && f.resourceId === 'ec2-1') };
    },
    explain: (actual) => !actual.hasIamFinding
      ? 'The simulator correctly does not require IAM for a plain SQL connection to RDS - database credentials are the default auth mechanism, not IAM.'
      : 'The simulator incorrectly required an IAM role for a plain database-credential SQL connection - this would misteach RDS\'s default authentication model.'
  },
  {
    id: 'SVC-RDS-SERVICE-FAILURE-001',
    awsBehavior: 'A Single-AZ RDS instance that fails has no standby to promote - the connection fails outright with no automatic recovery.',
    reference: 'Amazon RDS User Guide - "High availability (Multi-AZ) for Amazon RDS": Single-AZ has no automatic failover',
    scenario: 'A Single-AZ RDS instance is marked failed; an application attempts to query it.',
    configuration: { multiAz: false, health: 'failed' },
    request: { protocol: 'SQL' },
    expected: { success: false, statusCode: 504 },
    run: () => {
      const ec2 = svc('ec2-1', 'ec2', { category: 'Compute' });
      const rds = svc('rds-1', 'rds', { multiAz: false, health: 'failed' });
      const result = runSimulation([ec2, rds], [edge('e1', 'ec2-1', 'rds-1')], scenario('ec2-1'));
      return { success: result.success, statusCode: result.statusCode };
    },
    explain: (actual) => actual.statusCode === 504
      ? 'The simulator correctly fails the request with no automatic recovery for a Single-AZ RDS failure.'
      : `Got status ${actual.statusCode} - a Single-AZ RDS failure has no standby, so this should be a hard failure (504), not a recovered success.`
  },
  {
    id: 'SVC-RDS-MULTIAZ-FAILOVER-001',
    awsBehavior: 'A Multi-AZ RDS deployment automatically fails over to its synchronous standby in a second AZ when the primary fails - the application-visible outcome is a successful (if slightly delayed) connection, not a hard failure.',
    reference: 'Amazon RDS User Guide - "High availability (Multi-AZ) for Amazon RDS": automatic failover',
    scenario: 'A Multi-AZ RDS deployment\'s primary instance is marked failed; an application queries it.',
    configuration: { multiAz: true, health: 'failed' },
    request: { protocol: 'SQL' },
    expected: { success: true },
    run: () => {
      const ec2 = svc('ec2-1', 'ec2', { category: 'Compute' });
      const rds = svc('rds-1', 'rds', { multiAz: true, health: 'failed' });
      const result = runSimulation([ec2, rds], [edge('e1', 'ec2-1', 'rds-1')], scenario('ec2-1'));
      return { success: result.success };
    },
    explain: (actual) => actual.success
      ? 'The simulator correctly models Multi-AZ automatic failover as a successful (recovered) outcome.'
      : 'The simulator failed a Multi-AZ RDS request - Multi-AZ is specifically designed to survive exactly this failure via automatic failover.'
  }
];

runConformanceCases(CASES);
