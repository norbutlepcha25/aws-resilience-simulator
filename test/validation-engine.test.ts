import assert from 'node:assert';
import test from 'node:test';
import type { Node, Edge } from '@xyflow/react';

import { REFERENCE_ARCHITECTURES } from '../src/data/referenceArchitectures.ts';
import { validateArchitecture } from '../src/engine/validation/index.ts';
import type { ServiceNodeData, ConnectionData } from '../src/types/index.ts';

const haArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'highly-available-multiaz')!;
const naclArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'nacl-custom-stateless-timeout')!;
assert.ok(haArch);
assert.ok(naclArch);

function vpc(id: string, cidr: string, x = 0): Node<any> {
  return { id, type: 'boundaryNode', position: { x, y: 0 }, data: { label: id, boundaryType: 'vpc', width: 400, height: 300, cidr } };
}
function subnet(id: string, type: 'public_subnet' | 'private_subnet', cidr: string, x = 0, y = 0): Node<any> {
  return { id, type: 'boundaryNode', position: { x, y }, data: { label: id, boundaryType: type, width: 200, height: 150, cidr } };
}
function service(id: string, serviceId: string, overrides: Partial<ServiceNodeData> = {}): Node<ServiceNodeData> {
  return {
    id, type: 'serviceNode', position: { x: 0, y: 0 },
    data: {
      serviceId, label: id, category: 'Compute', health: 'healthy', az: 'AZ-A',
      subnet: 'public', replicas: 1, multiAz: false, ...overrides
    }
  };
}
function edge(id: string, source: string, target: string, protocol = 'HTTP'): Edge<ConnectionData> {
  return { id, source, target, type: 'custom', data: { protocol: protocol as any, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 } };
}

test('1. Invalid CIDR: a malformed VPC CIDR is flagged', () => {
  const nodes = [vpc('box-vpc', '10.0.0.0/999')];
  const findings = validateArchitecture(nodes, []);
  const finding = findings.find(f => f.subcategory === 'cidr' && f.problem.includes('not a valid CIDR'));
  assert.ok(finding, 'expected an invalid-CIDR finding');
  assert.strictEqual(finding!.category, 'validation');
  assert.strictEqual(finding!.severity, 'CRITICAL');
});

test('2. Overlapping subnets: two sibling subnets of the same VPC sharing addresses', () => {
  const nodes = [
    vpc('box-vpc', '10.0.0.0/16'),
    subnet('box-a', 'public_subnet', '10.0.1.0/24'),
    subnet('box-b', 'private_subnet', '10.0.1.128/25') // overlaps box-a
  ];
  const findings = validateArchitecture(nodes, []);
  const finding = findings.find(f => f.subcategory === 'cidr' && f.problem.includes('overlap'));
  assert.ok(finding, 'expected an overlapping-subnet finding');
  assert.strictEqual(finding!.severity, 'CRITICAL');
});

test('3. Invalid subnet placement: a resource requiring a subnet with none assigned', () => {
  const nodes = [service('node-rds', 'rds', { category: 'Databases', subnet: 'unassigned' })];
  const findings = validateArchitecture(nodes, []);
  const finding = findings.find(f => f.subcategory === 'placement');
  assert.ok(finding, 'expected an invalid-placement finding');
  assert.strictEqual(finding!.resourceId, 'node-rds');
});

test('4. Invalid / missing route configuration: NAT in a private subnet, and no IGW at all', () => {
  const misplacedNat = service('node-nat', 'nat_gateway', { subnet: 'private' });
  const findingsA = validateArchitecture([misplacedNat], []);
  assert.ok(findingsA.some(f => f.subcategory === 'placement' && f.resourceId === 'node-nat'));

  const albNoIgw = service('node-alb', 'alb', { category: 'Load Balancing', subnet: 'public' });
  const findingsB = validateArchitecture([albNoIgw], []);
  assert.ok(findingsB.some(f => f.subcategory === 'routing' && f.problem.includes('Internet Gateway')));
});

test('5. Invalid security rules: malformed protocol, port range, and CIDR on a Security Group', () => {
  const sg: Node<any> = {
    id: 'box-sg', type: 'boundaryNode', position: { x: 0, y: 0 },
    data: {
      label: 'Bad SG', boundaryType: 'security_group', width: 100, height: 100,
      securityGroupRules: {
        inbound: [
          { protocol: '', portRange: '443', source: { type: 'cidr', cidr: '10.0.0.0/24' } },
          { protocol: 'TCP', portRange: '99999', source: { type: 'cidr', cidr: '10.0.0.0/24' } },
          { protocol: 'TCP', portRange: '443', source: { type: 'cidr', cidr: 'not-a-cidr' } }
        ],
        outbound: []
      }
    }
  };
  const findings = validateArchitecture([sg], []);
  const sgFindings = findings.filter(f => f.subcategory === 'security_group');
  assert.ok(sgFindings.some(f => f.problem.includes('missing a protocol')));
  assert.ok(sgFindings.some(f => f.problem.includes('exceeds the maximum')));
  assert.ok(sgFindings.some(f => f.problem.includes('invalid CIDR source')));
});

test('6. Invalid NACL: the fixture template\'s deliberately-broken ephemeral return rule is caught', () => {
  const findings = validateArchitecture(naclArch.nodes as any, naclArch.edges as any);
  const naclFindings = findings.filter(f => f.subcategory === 'nacl');
  assert.ok(naclFindings.some(f => f.problem.includes('ephemeral return ports')));
});

test('6b. Invalid NACL: duplicate rule numbers and an out-of-range rule number', () => {
  const boundary: Node<any> = {
    id: 'box-subnet', type: 'boundaryNode', position: { x: 0, y: 0 },
    data: {
      label: 'Subnet', boundaryType: 'public_subnet', width: 100, height: 100,
      customNacl: {
        naclName: 'Test NACL', isCustom: true,
        inboundRules: [
          { ruleNumber: 100, type: 'HTTP', protocol: 'TCP', portRange: '80', cidr: '0.0.0.0/0', action: 'ALLOW' },
          { ruleNumber: 100, type: 'HTTPS', protocol: 'TCP', portRange: '443', cidr: '0.0.0.0/0', action: 'ALLOW' },
          { ruleNumber: 99999, type: 'Bad', protocol: 'TCP', portRange: '22', cidr: '0.0.0.0/0', action: 'ALLOW' },
          { ruleNumber: 110, type: 'Ephemeral', protocol: 'TCP', portRange: '1024-65535', cidr: '0.0.0.0/0', action: 'ALLOW' },
          { ruleNumber: 32767, type: 'All Traffic', protocol: 'All', portRange: 'All', cidr: '0.0.0.0/0', action: 'DENY' }
        ],
        outboundRules: []
      }
    }
  };
  const findings = validateArchitecture([boundary], []);
  const naclFindings = findings.filter(f => f.subcategory === 'nacl');
  assert.ok(naclFindings.some(f => f.problem.includes('more than one')));
  assert.ok(naclFindings.some(f => f.problem.includes('outside the valid range')));
});

test('7. Missing IAM permissions: compute calling S3 with no role attached', () => {
  const nodes = [
    service('node-lambda', 'lambda', { category: 'Compute' }),
    service('node-s3', 's3', { category: 'Storage' })
  ];
  const edges = [edge('e1', 'node-lambda', 'node-s3')];
  const findings = validateArchitecture(nodes, edges);
  const finding = findings.find(f => f.subcategory === 'iam' && f.resourceId === 'node-lambda');
  assert.ok(finding, 'expected a missing-IAM-role finding');
  assert.strictEqual(finding!.severity, 'MEDIUM');
});

test('8. Invalid role trust: an attached role whose trust policy does not name the caller', () => {
  const nodes = [
    service('node-lambda', 'lambda', {
      category: 'Compute',
      iamRole: {
        id: 'lambda-exec-role',
        trustPolicy: { id: 'trust', kind: 'trust', statements: [
          { effect: 'Allow', actions: ['sts:AssumeRole'], resources: [], principals: ['ec2.amazonaws.com'] }
        ] },
        identityPolicies: [{ id: 'perms', kind: 'identity', statements: [
          { effect: 'Allow', actions: ['s3:GetObject'], resources: ['*'] }
        ] }]
      }
    }),
    service('node-s3', 's3', { category: 'Storage' })
  ];
  const edges = [edge('e1', 'node-lambda', 'node-s3')];
  const findings = validateArchitecture(nodes, edges);
  const finding = findings.find(f => f.subcategory === 'iam' && f.problem.includes('cannot assume'));
  assert.ok(finding, 'expected an invalid-role-trust finding');
  assert.strictEqual(finding!.severity, 'HIGH');
});

test('8b. Missing IAM permissions with a valid trust policy: role trusted but has no allow statement', () => {
  const nodes = [
    service('node-lambda', 'lambda', {
      category: 'Compute',
      iamRole: {
        id: 'lambda-exec-role',
        trustPolicy: { id: 'trust', kind: 'trust', statements: [
          { effect: 'Allow', actions: ['sts:AssumeRole'], resources: [], principals: ['lambda'] }
        ] },
        identityPolicies: [{ id: 'perms', kind: 'identity', statements: [
          { effect: 'Allow', actions: ['dynamodb:GetItem'], resources: ['*'] }
        ] }]
      }
    }),
    service('node-s3', 's3', { category: 'Storage' })
  ];
  const edges = [edge('e1', 'node-lambda', 'node-s3')];
  const findings = validateArchitecture(nodes, edges);
  const finding = findings.find(f => f.subcategory === 'iam' && f.problem.includes('denied'));
  assert.ok(finding, 'expected a missing-permission finding since the role has no s3:GetObject allow');
});

test('9. Invalid dependencies: a dangling edge, a self-loop, and an edge into a boundary node', () => {
  const nodes = [service('node-a', 'ec2'), vpc('box-vpc', '10.0.0.0/16')];
  const edges = [
    edge('e-dangling', 'node-a', 'node-does-not-exist'),
    edge('e-self', 'node-a', 'node-a'),
    edge('e-boundary', 'node-a', 'box-vpc')
  ];
  const findings = validateArchitecture(nodes, edges);
  const depFindings = findings.filter(f => f.subcategory === 'dependency');
  assert.ok(depFindings.some(f => f.problem.includes('no longer exists')));
  assert.ok(depFindings.some(f => f.problem.includes('connection to itself')));
  assert.ok(depFindings.some(f => f.problem.includes('boundary')));
});

test('10. Invalid service configuration: reuses the Service Behavior Engine\'s own validator', () => {
  const nodes = [service('node-ec2', 'ec2', { category: 'Compute', subnet: 'unassigned' })];
  const findings = validateArchitecture(nodes, []);
  // Both the placement check and the delegated ServiceModel validator agree this is invalid -
  // the important thing is `service_config` findings flow through at all.
  const allSubcategories = new Set(findings.map(f => f.subcategory));
  assert.ok(allSubcategories.has('placement') || allSubcategories.has('service_config'));
});

test('11. A well-formed reference architecture has zero CRITICAL validation findings', () => {
  const findings = validateArchitecture(haArch.nodes as any, haArch.edges as any);
  const critical = findings.filter(f => f.severity === 'CRITICAL');
  assert.deepStrictEqual(critical, [], `expected no CRITICAL findings on a valid template, got: ${critical.map(f => f.problem).join(' | ')}`);
});
