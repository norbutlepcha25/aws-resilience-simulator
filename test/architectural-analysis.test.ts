import assert from 'node:assert';
import test from 'node:test';
import type { Node, Edge } from '@xyflow/react';

import { REFERENCE_ARCHITECTURES } from '../src/data/referenceArchitectures.ts';
import { validateArchitecture } from '../src/engine/validation/index.ts';
import { analyzeArchitectureFindings } from '../src/engine/analysis/architecturalFindings.ts';
import { runSimulation } from '../src/engine/simulation/requestSimulator.ts';
import type { ServiceNodeData, ConnectionData, SimulationScenario } from '../src/types/index.ts';

const haArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'highly-available-multiaz')!;
const spofArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'basic-spof-app')!;
assert.ok(haArch);
assert.ok(spofArch);

function service(id: string, serviceId: string, overrides: Partial<ServiceNodeData> = {}): Node<ServiceNodeData> {
  return {
    id, type: 'serviceNode', position: { x: 0, y: 0 },
    data: {
      serviceId, label: id, category: 'Compute', health: 'healthy', az: 'AZ-A',
      subnet: 'private', replicas: 1, multiAz: false, ...overrides
    }
  };
}
function edge(id: string, source: string, target: string, protocol = 'HTTP'): Edge<ConnectionData> {
  return { id, source, target, type: 'custom', data: { protocol: protocol as any, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 } };
}
function sg(id: string, rules: any): Node<any> {
  return { id, type: 'boundaryNode', position: { x: 0, y: 0 }, data: { label: id, boundaryType: 'security_group', width: 100, height: 100, securityGroupRules: rules } };
}

test('1. SPOF: a single-instance compute node is flagged, via the existing detector', () => {
  const findings = analyzeArchitectureFindings(spofArch.nodes as any, spofArch.edges as any);
  const spofFindings = findings.filter(f => f.subcategory === 'spof');
  assert.ok(spofFindings.length > 0);
  assert.ok(spofFindings.every(f => f.category === 'architecture'));
});

test('2. Bottlenecks: high compute capacity fanning into one DB with no cache is flagged', () => {
  const nodes = [
    service('node-user', 'user', { category: 'Client / Ingress', subnet: 'global', az: 'Edge / Global' }),
    service('node-ec2-1', 'ec2', { replicas: 4 }),
    service('node-rds', 'rds', { category: 'Databases', subnet: 'private' })
  ];
  const edges = [
    edge('e1', 'node-user', 'node-ec2-1'),
    edge('e2', 'node-ec2-1', 'node-rds', 'SQL')
  ];
  const findings = analyzeArchitectureFindings(nodes, edges);
  assert.ok(findings.some(f => f.subcategory === 'bottleneck'));
});

test('3. Public exposure: RDS in a public subnet is flagged', () => {
  const nodes = [service('node-rds', 'rds', { category: 'Databases', subnet: 'public' })];
  const findings = analyzeArchitectureFindings(nodes, []);
  const finding = findings.find(f => f.subcategory === 'public_exposure' && f.resourceId === 'node-rds');
  assert.ok(finding);
  assert.strictEqual(finding!.severity, 'HIGH');
});

test('4. Public exposure: client connecting directly to a database bypassing the app tier', () => {
  const nodes = [
    service('node-user', 'user', { category: 'Client / Ingress', subnet: 'global', az: 'Edge / Global' }),
    service('node-rds', 'rds', { category: 'Databases', subnet: 'private' })
  ];
  const edges = [edge('e1', 'node-user', 'node-rds', 'SQL')];
  const findings = analyzeArchitectureFindings(nodes, edges);
  assert.ok(findings.some(f => f.subcategory === 'public_exposure' && f.severity === 'CRITICAL'));
});

test('5. Missing redundancy: single-instance compute and Single-AZ RDS are both flagged', () => {
  const findings = analyzeArchitectureFindings(spofArch.nodes as any, spofArch.edges as any);
  const redundancyFindings = findings.filter(f => f.subcategory === 'redundancy');
  assert.ok(redundancyFindings.some(f => f.resourceId === 'node-ec2'));
  assert.ok(redundancyFindings.some(f => f.resourceId === 'node-rds'));
});

test('5b. Missing redundancy: a properly Multi-AZ template raises no redundancy findings for its DB/compute', () => {
  const findings = analyzeArchitectureFindings(haArch.nodes as any, haArch.edges as any);
  const redundancyFindings = findings.filter(f => f.subcategory === 'redundancy');
  assert.deepStrictEqual(redundancyFindings, []);
});

test('6. Dependency concentration: one node with many distinct dependents is flagged', () => {
  const nodes = [
    service('node-rds', 'rds', { category: 'Databases', subnet: 'private', multiAz: true }),
    service('node-a', 'ec2'), service('node-b', 'ec2'), service('node-c', 'ec2'), service('node-d', 'ec2')
  ];
  const edges = ['node-a', 'node-b', 'node-c', 'node-d'].map((s, i) => edge(`e${i}`, s, 'node-rds', 'SQL'));
  const findings = analyzeArchitectureFindings(nodes, edges);
  const finding = findings.find(f => f.subcategory === 'dependency_concentration' && f.resourceId === 'node-rds');
  assert.ok(finding, 'expected a dependency-concentration finding on node-rds');
});

test('7. Failure blast radius: reuses the Phase 9 propagation engine to size the cascade', () => {
  const findings = analyzeArchitectureFindings(spofArch.nodes as any, spofArch.edges as any);
  const finding = findings.find(f => f.subcategory === 'blast_radius' && f.resourceId === 'node-rds');
  assert.ok(finding, 'expected node-rds\'s failure to be flagged as a large blast radius (it cascades to node-ec2)');
});

test('7b. Failure blast radius: an AZ-A ECS task in the HA template has a small, contained blast radius', () => {
  const findings = analyzeArchitectureFindings(haArch.nodes as any, haArch.edges as any);
  assert.ok(!findings.some(f => f.subcategory === 'blast_radius' && f.resourceId === 'node-ecs-az-a'),
    'ALB failover means a single ECS task failing should not register as a large blast radius');
});

test('8. Security risk: no WAF on a public ALB entry point is flagged, distinct from public_exposure', () => {
  const nodes = [
    service('node-alb', 'alb', { category: 'Load Balancing', subnet: 'public' }),
    service('node-ec2', 'ec2')
  ];
  const edges = [edge('e1', 'node-alb', 'node-ec2')];
  const findings = analyzeArchitectureFindings(nodes, edges);
  assert.ok(findings.some(f => f.subcategory === 'security_risk' && f.problem.includes('WAF')));
});

// --- The core lesson of Phase 10: VALID CONFIGURATION, SUCCESSFUL REQUEST, and GOOD ARCHITECTURE
// are three different questions, and a single architecture can score differently on all three. ---
test('9. IMPORTANT DISTINCTION: an RDS SG rule open to 0.0.0.0/0 is valid config, a successful request, and a bad architecture - all at once', () => {
  const nodes = [
    service('node-user', 'user', { category: 'Client / Ingress', subnet: 'global', az: 'Edge / Global' }),
    service('node-igw', 'internet_gateway', { category: 'Networking & Content Delivery', subnet: 'global', az: 'Edge / Global' }),
    service('node-ec2', 'ec2', { subnet: 'public' }),
    service('node-rds', 'rds', { category: 'Databases', subnet: 'private', securityGroupIds: ['box-db-sg'] }),
    sg('box-db-sg', { inbound: [{ protocol: 'SQL', portRange: '3306', source: { type: 'cidr', cidr: '0.0.0.0/0' } }], outbound: [] })
  ];
  const edges = [
    edge('e1', 'node-user', 'node-igw'),
    edge('e0', 'node-igw', 'node-ec2'),
    edge('e2', 'node-ec2', 'node-rds', 'SQL')
  ];

  // 1. VALID CONFIGURATION: the rule is syntactically and structurally legal - AWS would accept
  // it exactly as written. No CRITICAL validation finding should exist for it.
  const validation = validateArchitecture(nodes, edges);
  assert.ok(
    !validation.some(f => f.subcategory === 'security_group' && f.severity === 'CRITICAL'),
    'a 0.0.0.0/0 Security Group rule is legal AWS config and must not be reported as an invalid rule'
  );

  // 2. SUCCESSFUL REQUEST: nothing about this rule blocks the simulated request - it still
  // reaches the database and succeeds.
  const scenario: SimulationScenario = { id: 's', name: 'GET', method: 'GET', path: '/', startNodeId: 'node-user', trafficLevel: 'normal' };
  const result = runSimulation(nodes, edges, scenario);
  assert.strictEqual(result.success, true, 'the request itself succeeds regardless of the exposure risk');

  // 3. GOOD ARCHITECTURE: the exact same configuration is flagged as a serious security risk.
  const analysis = analyzeArchitectureFindings(nodes, edges);
  const exposureFinding = analysis.find(f => f.subcategory === 'public_exposure' && f.resourceId === 'node-rds');
  assert.ok(exposureFinding, 'expected the architectural analysis to flag the database as publicly exposed');
  assert.strictEqual(exposureFinding!.severity, 'HIGH');
  assert.ok(exposureFinding!.problem.includes('0.0.0.0/0'));
});

test('10. Do not flag an architecture bad merely for differing from a reference template', () => {
  // A deliberately non-standard but internally consistent topology: no ALB, a single Lambda
  // fronted by API Gateway, DynamoDB (no Multi-AZ flag applies to it) - nothing here violates any
  // AWS constraint or stated rule, so nothing should be flagged just because it looks different
  // from the reference "three-tier + ALB + RDS" shape.
  const nodes = [
    service('node-user', 'user', { category: 'Client / Ingress', subnet: 'global', az: 'Edge / Global' }),
    service('node-apigw', 'api_gateway', { category: 'Networking & Content Delivery', subnet: 'global', az: 'Edge / Global' }),
    service('node-lambda', 'lambda', { category: 'Compute', subnet: 'global', az: 'Edge / Global', replicas: 1 }),
    service('node-ddb', 'dynamodb', { category: 'Databases', subnet: 'global', az: 'Edge / Global' })
  ];
  const edges = [
    edge('e1', 'node-user', 'node-apigw', 'HTTPS'),
    edge('e2', 'node-apigw', 'node-lambda', 'HTTPS'),
    edge('e3', 'node-lambda', 'node-ddb', 'SQL')
  ];

  const validation = validateArchitecture(nodes, edges);
  assert.deepStrictEqual(validation.filter(f => f.severity === 'CRITICAL'), []);

  const analysis = analyzeArchitectureFindings(nodes, edges);
  // Lambda's own "single instance" isn't a redundancy gap the way a stateful EC2/ECS box is
  // (Lambda scales per-invocation with no persistent instance to replicate) - it must not be
  // flagged just because `replicas` reads 1.
  assert.ok(!analysis.some(f => f.subcategory === 'redundancy' && f.resourceId === 'node-lambda'));
});
