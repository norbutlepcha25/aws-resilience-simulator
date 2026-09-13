import assert from 'node:assert';
import test from 'node:test';
import type { Node } from '@xyflow/react';

import { explainHop, finalizeTrace, renderTrace, toSimpleSummary, toDetailedSummary } from '../src/engine/trace/index.ts';
import { explainRequestAlongEdges } from '../src/engine/trace/explainRequest.ts';
import type { ServiceNodeData } from '../src/types/index.ts';

function boundary(id: string, boundaryType: string, data: Record<string, unknown> = {}): Node<any> {
  return { id, type: 'boundaryNode', position: { x: 0, y: 0 }, data: { label: id, boundaryType, width: 300, height: 300, ...data } };
}
function service(id: string, serviceId: string, overrides: Partial<ServiceNodeData> = {}): Node<ServiceNodeData> {
  return {
    id, type: 'serviceNode', position: { x: 0, y: 0 },
    data: { serviceId, label: id, category: 'Compute', health: 'healthy', az: 'AZ-A', subnet: 'private', replicas: 1, multiAz: false, ...overrides }
  };
}

// Builds exactly the spec's own worked example: VPC 10.0.0.0/16, EC2-A in a public subnet
// (10.0.1.0/24) with an EC2-SG, RDS in a private subnet (10.0.2.0/24) with an RDS-SG whose only
// inbound rule allows TCP 5432 from EC2-SG, and a custom NACL on the RDS subnet whose Rule 100
// allows TCP 5432 from 10.0.1.0/24.
function buildWorkedExample(opts?: { sgAllows?: boolean }) {
  const sgAllows = opts?.sgAllows ?? true;

  const vpc = boundary('vpc', 'vpc', { cidr: '10.0.0.0/16' });
  const publicSubnet = boundary('public-subnet', 'public_subnet', { cidr: '10.0.1.0/24' });
  const privateSubnet = boundary('private-subnet', 'private_subnet', {
    cidr: '10.0.2.0/24',
    customNacl: {
      naclName: 'RDS Subnet NACL', isCustom: true,
      inboundRules: [
        { ruleNumber: 100, type: 'MySQL/Aurora', protocol: 'SQL', portRange: '5432', cidr: '10.0.1.0/24', action: 'ALLOW' },
        { ruleNumber: 32767, type: 'All Traffic', protocol: 'All', portRange: 'All', cidr: '0.0.0.0/0', action: 'DENY' }
      ],
      outboundRules: []
    }
  });
  const ec2Sg = boundary('ec2-sg', 'security_group');
  const rdsSg = boundary('rds-sg', 'security_group', {
    label: 'RDS-SG',
    securityGroupRules: {
      inbound: sgAllows
        ? [{ protocol: 'SQL', portRange: '5432', source: { type: 'securityGroup', securityGroupId: 'ec2-sg' } }]
        : [],
      outbound: []
    }
  });

  // Geometric placement: EC2-A center inside publicSubnet's rect, RDS center inside privateSubnet's.
  publicSubnet.position = { x: 0, y: 0 };
  (publicSubnet.data as any).width = 200; (publicSubnet.data as any).height = 200;
  privateSubnet.position = { x: 300, y: 0 };
  (privateSubnet.data as any).width = 200; (privateSubnet.data as any).height = 200;
  vpc.position = { x: -50, y: -50 }; (vpc.data as any).width = 600; (vpc.data as any).height = 300;

  const ec2 = service('ec2-a', 'ec2', { label: 'EC2-A', subnet: 'public', securityGroupIds: ['ec2-sg'] } as any);
  ec2.position = { x: 50, y: 50 };
  const rds = service('rds', 'rds', { category: 'Databases', label: 'RDS', subnet: 'private', securityGroupIds: ['rds-sg'] } as any);
  rds.position = { x: 350, y: 50 };
  (ec2.data as any).label = 'EC2-A';
  (rds.data as any).label = 'RDS';

  const nodes = [vpc, publicSubnet, privateSubnet, ec2Sg, rdsSg, ec2, rds];
  return { nodes, ec2, rds };
}

test('1. WHAT/WHERE/WHY/AWS-rule: every entry carries all four required answers, plus dual explanation modes', () => {
  const { nodes, ec2, rds } = buildWorkedExample();
  const entries = explainHop(nodes, [], ec2, rds, 'SQL', { port: 5432 });

  for (const e of entries) {
    assert.ok(e.component, 'WHAT: component must be set');
    assert.ok(e.resource, 'WHERE: resource must be set');
    assert.ok(e.reason.length > 0, 'WHY (detailed): reason must be set');
    assert.ok(e.simpleExplanation.length > 0, 'WHY (simple): simpleExplanation must be set');
    assert.ok(e.awsRule.length > 0, 'WHICH AWS RULE: awsRule must be set');
    assert.strictEqual(typeof e.order, 'number');
  }
});

test('2. The worked example (EC2-A -> RDS:5432, SG allows it): Route/NACL/SG all ALLOW, IAM not required, FINAL SUCCESS', () => {
  const { nodes, ec2, rds } = buildWorkedExample({ sgAllows: true });
  const entries = explainHop(nodes, [], ec2, rds, 'SQL', { port: 5432 });
  const verdict = finalizeTrace(entries);

  const route = entries.find(e => e.component === 'Route')!;
  assert.strictEqual(route.decision, 'ALLOW');
  assert.ok(route.reason.includes('local'));

  const nacl = entries.find(e => e.component === 'NACL')!;
  assert.strictEqual(nacl.decision, 'ALLOW');
  assert.strictEqual(nacl.resource, 'RDS Subnet NACL');
  assert.strictEqual((nacl.metadata.decidingRule as any).ruleNumber, 100);

  const sg = entries.find(e => e.component === 'Security Group')!;
  assert.strictEqual(sg.decision, 'ALLOW');
  assert.strictEqual(sg.resource, 'RDS-SG');

  const iam = entries.find(e => e.component === 'IAM')!;
  assert.strictEqual(iam.decision, 'NOT_REQUIRED');
  assert.ok(iam.reason.includes('network connection'));

  const svc = entries.find(e => e.component === 'Service')!;
  assert.strictEqual(svc.decision, 'SUCCESS');

  assert.strictEqual(verdict.final, 'SUCCESS');
});

test('3. Failure trace: RDS Security Group with no matching inbound rule produces FINAL: DENIED with the exact WHY', () => {
  const { nodes, ec2, rds } = buildWorkedExample({ sgAllows: false });
  const entries = explainHop(nodes, [], ec2, rds, 'SQL', { port: 5432 });
  const verdict = finalizeTrace(entries);

  const sg = entries.find(e => e.component === 'Security Group')!;
  assert.strictEqual(sg.decision, 'DENY');
  assert.ok(sg.reason.includes('no inbound rule allowing'));

  assert.strictEqual(verdict.final, 'DENIED');
  assert.ok(verdict.why.includes('RDS-SG'));
  assert.ok(verdict.why.toLowerCase().includes('no inbound rule'));

  // Route and NACL must still show ALLOW - the SG is what blocked it, not an earlier layer.
  assert.strictEqual(entries.find(e => e.component === 'Route')!.decision, 'ALLOW');
  assert.strictEqual(entries.find(e => e.component === 'NACL')!.decision, 'ALLOW');
});

test('4. NACL denial: an explicit DENY rule blocks before Security Group is even meaningful', () => {
  const { nodes, ec2, rds } = buildWorkedExample();
  const privateSubnet = nodes.find(n => n.id === 'private-subnet')!;
  (privateSubnet.data as any).customNacl.inboundRules = [
    { ruleNumber: 50, type: 'MySQL/Aurora', protocol: 'SQL', portRange: '5432', cidr: '10.0.1.0/24', action: 'DENY' },
    { ruleNumber: 32767, type: 'All Traffic', protocol: 'All', portRange: 'All', cidr: '0.0.0.0/0', action: 'DENY' }
  ];

  const entries = explainHop(nodes, [], ec2, rds, 'SQL', { port: 5432 });
  const nacl = entries.find(e => e.component === 'NACL')!;
  assert.strictEqual(nacl.decision, 'DENY');
  assert.strictEqual((nacl.metadata.decidingRule as any).ruleNumber, 50);

  const verdict = finalizeTrace(entries);
  assert.strictEqual(verdict.final, 'DENIED');
  assert.ok(verdict.why.includes('RDS Subnet NACL'));
});

test('5. IAM required: a Lambda calling S3 with no role attached is denied at IAM, not at the network layer', () => {
  const lambda = service('lambda', 'lambda', { category: 'Compute', subnet: 'global', az: 'Edge / Global' } as any);
  (lambda.data as any).label = 'MyFunction';
  const s3 = service('s3', 's3', { category: 'Storage', subnet: 'global', az: 'Edge / Global' } as any);
  (s3.data as any).label = 'MyBucket';

  const entries = explainHop([lambda, s3], [], lambda, s3, 'HTTPS');
  const iam = entries.find(e => e.component === 'IAM')!;
  assert.strictEqual(iam.decision, 'DENY');
  assert.ok(iam.reason.includes('no IAM role'));

  const verdict = finalizeTrace(entries);
  assert.strictEqual(verdict.final, 'DENIED');
  assert.ok(verdict.why.includes('IAM'));
});

test('6. IAM required and granted: a role with an explicit Allow succeeds all the way through', () => {
  const lambda = service('lambda', 'lambda', {
    category: 'Compute', subnet: 'global', az: 'Edge / Global',
    iamRole: {
      id: 'lambda-exec-role',
      trustPolicy: { id: 'trust', kind: 'trust', statements: [{ effect: 'Allow', actions: ['sts:AssumeRole'], resources: [], principals: ['lambda'] }] },
      identityPolicies: [{ id: 'perms', kind: 'identity', statements: [{ effect: 'Allow', actions: ['s3:GetObject'], resources: ['*'] }] }]
    }
  } as any);
  const s3 = service('s3', 's3', { category: 'Storage', subnet: 'global', az: 'Edge / Global' } as any);

  const entries = explainHop([lambda, s3], [], lambda, s3, 'HTTPS');
  const iam = entries.find(e => e.component === 'IAM')!;
  assert.strictEqual(iam.decision, 'ALLOW');
  assert.ok(Array.isArray(iam.metadata.steps), 'the real IamTraceStep[] must survive into metadata, not be collapsed to prose');
  assert.ok((iam.metadata.steps as any[]).length > 0);

  assert.strictEqual(finalizeTrace(entries).final, 'SUCCESS');
});

test('7. Multi-hop composition: explainRequestAlongEdges concatenates hops and renumbers order', () => {
  const user = service('user', 'user', { category: 'Client / Ingress', subnet: 'global', az: 'Edge / Global' } as any);
  const alb = service('alb', 'alb', { category: 'Load Balancing', subnet: 'public' } as any);
  const ec2 = service('ec2', 'ec2', { subnet: 'private' } as any);
  const edges = [
    { id: 'e1', source: 'user', target: 'alb', type: 'custom', data: { protocol: 'HTTPS', interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 } },
    { id: 'e2', source: 'alb', target: 'ec2', type: 'custom', data: { protocol: 'HTTP', interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 } }
  ] as any;

  const trace = explainRequestAlongEdges([user, alb, ec2], edges, [user, alb, ec2]);
  assert.strictEqual(trace.final, 'SUCCESS');
  // order must be strictly increasing across the whole concatenated trace, not reset per hop.
  const orders = trace.entries.map(e => e.order);
  assert.deepStrictEqual(orders, orders.slice().sort((a, b) => a - b));
  assert.strictEqual(new Set(orders).size, orders.length, 'no duplicate order values across hops');
});

test('8. Educational Mode: renderTrace supports both simple and detailed output from the same data', () => {
  const { nodes, ec2, rds } = buildWorkedExample({ sgAllows: false });
  const entries = explainHop(nodes, [], ec2, rds, 'SQL', { port: 5432 });
  const trace = { entries, ...finalizeTrace(entries) };

  const detailed = renderTrace(trace, 'detailed');
  assert.ok(detailed.includes('AWS RULE:'));
  assert.ok(detailed.includes('FINAL:'));
  assert.ok(detailed.includes('DENIED'));
  assert.ok(detailed.includes('WHY:'));

  const simple = renderTrace(trace, 'simple');
  assert.ok(!simple.includes('AWS RULE:'), 'simple mode must not include the detailed AWS rule citation');
  assert.ok(simple.includes('FINAL:'));

  const simpleSummary = toSimpleSummary(trace);
  const detailedSummary = toDetailedSummary(trace);
  assert.strictEqual(simpleSummary.length, entries.length);
  assert.strictEqual(detailedSummary.length, entries.length);
  assert.ok(detailedSummary.every(d => d.awsRule.length > 0));
});
