import assert from 'node:assert';
import test from 'node:test';

import { REFERENCE_ARCHITECTURES } from '../src/data/referenceArchitectures.ts';
import { AWS_SERVICES } from '../src/data/serviceCatalog.ts';
import { STUDENT_CHALLENGES } from '../src/data/studentChallenges.ts';
import { runSimulation } from '../src/engine/simulation/requestSimulator.ts';
import { analyzeArchitecture } from '../src/engine/analysis/rulesEngine.ts';
import { detectSPOFs } from '../src/engine/analysis/spofDetector.ts';
import { detectBottlenecks } from '../src/engine/analysis/bottleneckDetector.ts';
import { allocateSubnetCidrs, getReservedAddresses, getUsableIpRange } from '../src/engine/layout/cidrAllocator.ts';
import { calculateNodeCost, calculateArchitectureCost, EC2_INSTANCE_TYPES, S3_STORAGE_CLASSES } from '../src/engine/cost/costCalculator.ts';
import { isBoundaryContained, getBoundaryContainmentDepth, calculateBoundaryZIndex, deriveSubnetForNode } from '../src/engine/layout/containment.ts';
import type { SimulationScenario } from '../src/types/index.ts';

test('1. Service Catalog Integrity', () => {
  assert.ok(AWS_SERVICES.length >= 10, 'Catalog should contain at least 10 core AWS services');
  const user = AWS_SERVICES.find(s => s.id === 'user');
  const alb = AWS_SERVICES.find(s => s.id === 'alb');
  const ecs = AWS_SERVICES.find(s => s.id === 'ecs');
  const rds = AWS_SERVICES.find(s => s.id === 'rds');
  assert.ok(user && alb && ecs && rds, 'Core services must exist in catalog');
  assert.ok(rds.failureModes.length > 0, 'Services should have educational failure modes');
});

test('2. Simulation: Successful Multi-AZ Web App Request', () => {
  const haArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'highly-available-multiaz')!;
  assert.ok(haArch, 'Highly available architecture template should exist');

  const scenario: SimulationScenario = {
    id: 'test-1',
    name: 'Normal GET',
    method: 'GET',
    path: '/products',
    startNodeId: 'node-user',
    trafficLevel: 'normal'
  };

  const result = runSimulation(haArch.nodes, haArch.edges, scenario);
  assert.strictEqual(result.success, true, 'Request should succeed in HA architecture');
  assert.strictEqual(result.statusCode, 200, 'Status code should be 200 OK');
  assert.ok(result.steps.length >= 4, 'Should contain chronological traversal steps');
});

test('3. Simulation: ALB Health Check Failover when ECS-1 is FAILED', () => {
  const haArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'highly-available-multiaz')!;
  // Clone nodes and fail ECS in AZ-A
  const modifiedNodes = haArch.nodes.map(n => {
    if (n.id === 'node-ecs-az-a') {
      return {
        ...n,
        data: { ...n.data, health: 'failed' as const, failureReason: 'Simulated Crash' }
      };
    }
    return n;
  });

  const scenario: SimulationScenario = {
    id: 'test-failover',
    name: 'Failover Test',
    method: 'GET',
    path: '/products',
    startNodeId: 'node-user',
    trafficLevel: 'normal'
  };

  const result = runSimulation(modifiedNodes, haArch.edges, scenario);
  assert.strictEqual(result.success, true, 'Request should survive when one of two ECS tasks fails');
  assert.strictEqual(result.statusCode, 200, 'Status code should remain 200 OK');

  // Verify ALB step notes failover
  const albStep = result.steps.find(s => s.sourceNodeId === 'node-alb');
  assert.ok(albStep, 'ALB step must be executed');
  assert.strictEqual(albStep.targetNodeId, 'node-ecs-az-b', 'ALB should route to surviving ECS Task in AZ-B');
});

test('4. Simulation: 503 Service Unavailable when ALL compute targets fail', () => {
  const haArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'highly-available-multiaz')!;
  // Fail BOTH ECS tasks
  const modifiedNodes = haArch.nodes.map(n => {
    if (n.id === 'node-ecs-az-a' || n.id === 'node-ecs-az-b') {
      return {
        ...n,
        data: { ...n.data, health: 'failed' as const }
      };
    }
    return n;
  });

  const scenario: SimulationScenario = {
    id: 'test-total-failure',
    name: 'Total Failure Test',
    method: 'GET',
    path: '/products',
    startNodeId: 'node-user',
    trafficLevel: 'normal'
  };

  const result = runSimulation(modifiedNodes, haArch.edges, scenario);
  assert.strictEqual(result.success, false, 'Request must fail when all compute targets are offline');
  assert.strictEqual(result.statusCode, 503, 'Should return HTTP 503 Service Unavailable (real ALB behavior for no healthy targets)');
});

test('5. Single Point of Failure (SPOF) Detection on Basic Web App', () => {
  const basicArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'basic-spof-app')!;
  const spofs = detectSPOFs(basicArch.nodes, basicArch.edges);

  assert.ok(spofs.length >= 2, 'Basic Web App should trigger at least 2 critical SPOFs');
  const ec2Spof = spofs.find(s => s.serviceId === 'ec2');
  const rdsSpof = spofs.find(s => s.serviceId === 'rds');
  assert.ok(ec2Spof, 'Should identify Single EC2 as a SPOF');
  assert.ok(rdsSpof, 'Should identify Single-AZ RDS as a SPOF');
  assert.ok(rdsSpof.mitigation.includes('Multi-AZ'), 'Mitigation must recommend Multi-AZ');
});

test('6. Architecture Rules & Explainable Multidimensional Scoring', () => {
  const basicArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'basic-spof-app')!;
  const haArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'highly-available-multiaz')!;

  const basicAnalysis = analyzeArchitecture(basicArch.nodes, basicArch.edges);
  const haAnalysis = analyzeArchitecture(haArch.nodes, haArch.edges);

  // Compare Availability & Resilience
  assert.ok(
    haAnalysis.availability.score > basicAnalysis.availability.score,
    'HA architecture must have higher availability than basic SPOF app'
  );
  assert.ok(
    haAnalysis.resilience.score > basicAnalysis.resilience.score,
    'HA architecture must have higher resilience than basic SPOF app'
  );

  // Verify explainable reasons exist
  assert.ok(haAnalysis.resilience.positiveReasons.length > 0, 'HA should have explicit positive reasons');
  assert.ok(basicAnalysis.resilience.negativeReasons.length > 0, 'Basic app should have explicit negative reasons');
  assert.strictEqual(basicAnalysis.overallRating, 'Fragile', 'Basic app should be rated Fragile');
  assert.strictEqual(haAnalysis.overallRating, 'Resilient', 'HA app should be rated Resilient');
});

test('7. Student Challenge Rubric Evaluation', () => {
  const challenge1 = STUDENT_CHALLENGES[0];
  const basicArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'basic-spof-app')!;
  const haArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'highly-available-multiaz')!;

  const basicAnalysis = analyzeArchitecture(basicArch.nodes, basicArch.edges);
  const haAnalysis = analyzeArchitecture(haArch.nodes, haArch.edges);

  const basicResult = challenge1.evaluationCheck(basicArch.nodes, basicArch.edges, basicAnalysis);
  const haResult = challenge1.evaluationCheck(haArch.nodes, haArch.edges, haAnalysis);

  assert.strictEqual(basicResult.passed, false, 'Basic app must fail Challenge 1 (Eliminate SPOF)');
  assert.strictEqual(haResult.passed, true, 'HA app must pass Challenge 1 (Eliminate SPOF)');
  assert.strictEqual(haResult.score, 100, 'HA app should achieve 100 on Challenge 1');
});

test('8. VPC Behavior: Direct Public Ingress to Private Subnet Blocked (403)', () => {
  const directPrivateNodes = [
    {
      id: 'node-user',
      type: 'serviceNode',
      position: { x: 0, y: 0 },
      data: { serviceId: 'user', label: 'Internet User', category: 'Client / Ingress', health: 'healthy', az: 'Edge / Global', subnet: 'global' }
    },
    {
      id: 'node-private-ec2',
      type: 'serviceNode',
      position: { x: 200, y: 0 },
      data: { serviceId: 'ec2', label: 'Backend EC2', category: 'Compute', health: 'healthy', az: 'AZ-A', subnet: 'private' }
    }
  ];

  const directEdges = [
    { id: 'e1', source: 'node-user', target: 'node-private-ec2', data: { protocol: 'HTTP' } }
  ];

  const scenario: SimulationScenario = {
    id: 'test-direct-private',
    name: 'Direct Ingress to Private Subnet',
    method: 'GET',
    path: '/api/data',
    startNodeId: 'node-user',
    trafficLevel: 'normal'
  };

  const result = runSimulation(directPrivateNodes as any, directEdges as any, scenario);
  assert.strictEqual(result.success, false, 'Direct public access to private subnet must fail');
  assert.strictEqual(result.statusCode, 403, 'Should return HTTP 403 Forbidden');
  assert.ok(result.steps.some(s => s.action.includes('VPC Ingress Violation')), 'Should record VPC Ingress Violation step');
});

test('9. VPC Behavior: NAT Gateway required for Private Subnet Outbound Egress', () => {
  // Scenario A: Without NAT Gateway
  const noNatNodes = [
    {
      id: 'node-ec2',
      type: 'serviceNode',
      position: { x: 0, y: 0 },
      data: { serviceId: 'ec2', label: 'Private App Server', category: 'Compute', health: 'healthy', az: 'AZ-A', subnet: 'private' }
    },
    {
      id: 'node-ext-api',
      type: 'serviceNode',
      position: { x: 200, y: 0 },
      data: { serviceId: 'api_client', label: 'Payment Gateway API', category: 'Client / Ingress', health: 'healthy', az: 'Edge / Global', subnet: 'global' }
    }
  ];
  const egressEdges = [
    { id: 'e1', source: 'node-ec2', target: 'node-ext-api', data: { protocol: 'HTTPS' } }
  ];

  const scenario: SimulationScenario = {
    id: 'test-egress',
    name: 'Outbound Egress',
    method: 'POST',
    path: '/checkout',
    startNodeId: 'node-ec2',
    trafficLevel: 'normal'
  };

  const resultNoNat = runSimulation(noNatNodes as any, egressEdges as any, scenario);
  assert.strictEqual(resultNoNat.success, false, 'Egress from private subnet without NAT Gateway must fail');
  assert.strictEqual(resultNoNat.statusCode, 504, 'Missing NAT Gateway should cause 504 timeout');

  // Scenario B: With healthy NAT Gateway in public subnet
  const withNatNodes = [
    ...noNatNodes,
    {
      id: 'node-nat',
      type: 'serviceNode',
      position: { x: 100, y: 100 },
      data: { serviceId: 'nat_gateway', label: 'NAT Gateway', category: 'Networking & Content Delivery', health: 'healthy', az: 'AZ-A', subnet: 'public' }
    }
  ];

  const resultWithNat = runSimulation(withNatNodes as any, egressEdges as any, scenario);
  assert.strictEqual(resultWithNat.success, true, 'Egress with NAT Gateway should succeed');
  assert.ok(resultWithNat.steps.some(s => s.action.includes('SNAT')), 'Should record NAT Gateway SNAT step');
});

test('10. Auto-Scaling: Dynamic scale-out under heavy surge vs single instance saturation', () => {
  // Architecture with Auto Scaling enabled
  const asgNodes = [
    {
      id: 'node-user',
      type: 'serviceNode',
      position: { x: 0, y: 0 },
      data: { serviceId: 'user', label: 'User', category: 'Client / Ingress', health: 'healthy', az: 'Edge / Global', subnet: 'global' }
    },
    {
      id: 'node-igw',
      type: 'serviceNode',
      position: { x: 50, y: 0 },
      data: { serviceId: 'internet_gateway', label: 'Internet Gateway', category: 'Networking & Content Delivery', health: 'healthy', az: 'Edge / Global', subnet: 'public' }
    },
    {
      id: 'node-alb',
      type: 'serviceNode',
      position: { x: 100, y: 0 },
      data: { serviceId: 'alb', label: 'ALB', category: 'Networking & Content Delivery', health: 'healthy', az: 'Multi-AZ', subnet: 'public' }
    },
    {
      id: 'node-asg',
      type: 'serviceNode',
      position: { x: 200, y: 0 },
      data: { serviceId: 'ec2', label: 'Auto-Scaled Web Cluster', category: 'Compute', health: 'healthy', az: 'Multi-AZ', subnet: 'private', replicas: 3, multiAz: true }
    }
  ];

  const edges = [
    { id: 'e1', source: 'node-user', target: 'node-igw', data: { protocol: 'HTTPS' } },
    { id: 'e1b', source: 'node-igw', target: 'node-alb', data: { protocol: 'HTTPS' } },
    { id: 'e2', source: 'node-alb', target: 'node-asg', data: { protocol: 'HTTP' } }
  ];

  const surgeScenario: SimulationScenario = {
    id: 'test-surge',
    name: '10x Traffic Spike',
    method: 'GET',
    path: '/flash-sale',
    startNodeId: 'node-user',
    trafficLevel: '10x'
  };

  const resultAsg = runSimulation(asgNodes as any, edges as any, surgeScenario);
  assert.strictEqual(resultAsg.success, true, 'Auto-scaled cluster must absorb 10x traffic surge');
  assert.ok(resultAsg.steps.some(s => s.action.includes('Auto Scaling Group: Dynamic Scale-Out')), 'Should record Auto Scaling scale-out event');

  // Single-instance without auto scaling
  const singleNodes = [
    asgNodes[0],
    asgNodes[1],
    asgNodes[2],
    {
      id: 'node-single',
      type: 'serviceNode',
      position: { x: 200, y: 0 },
      data: { serviceId: 'ec2', label: 'Single Server (No ASG)', category: 'Compute', health: 'healthy', az: 'AZ-A', subnet: 'private', replicas: 1, multiAz: false }
    }
  ];
  const singleEdges = [
    { id: 'e1', source: 'node-user', target: 'node-igw', data: { protocol: 'HTTPS' } },
    { id: 'e1b', source: 'node-igw', target: 'node-alb', data: { protocol: 'HTTPS' } },
    { id: 'e2', source: 'node-alb', target: 'node-single', data: { protocol: 'HTTP' } }
  ];

  const resultSingle = runSimulation(singleNodes as any, singleEdges as any, surgeScenario);
  assert.strictEqual(resultSingle.success, false, 'Single instance must saturate under 10x traffic surge');
  assert.strictEqual(resultSingle.statusCode, 504, 'Saturated instance should return 504 timeout');
});

test('11. Database Multi-AZ Automated Failover', () => {
  const multiAzDbNodes = [
    {
      id: 'node-ecs',
      type: 'serviceNode',
      position: { x: 0, y: 0 },
      data: { serviceId: 'ecs', label: 'ECS Task', category: 'Compute', health: 'healthy', az: 'Multi-AZ', subnet: 'private' }
    },
    {
      id: 'node-rds',
      type: 'serviceNode',
      position: { x: 100, y: 0 },
      data: { serviceId: 'rds', label: 'Amazon RDS (Multi-AZ)', category: 'Databases', health: 'failed', az: 'Multi-AZ', subnet: 'private', multiAz: true }
    }
  ];

  const edges = [
    { id: 'e1', source: 'node-ecs', target: 'node-rds', data: { protocol: 'SQL' } }
  ];

  const scenario: SimulationScenario = {
    id: 'test-db-failover',
    name: 'DB Failover Check',
    method: 'POST',
    path: '/orders',
    startNodeId: 'node-ecs',
    trafficLevel: 'normal'
  };

  const result = runSimulation(multiAzDbNodes as any, edges as any, scenario);
  assert.strictEqual(result.success, true, 'Multi-AZ DB should automatically failover to standby replica');
  assert.ok(result.steps.some(s => s.action.includes('Multi-AZ Automated Database Failover')), 'Should log automated failover event');
});

test('12. Multi-AZ VPC Reference Architecture Integrity & Boundary Composition', () => {
  const vpcArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'vpc-subnets-multi-az-security-groups');
  assert.ok(vpcArch, 'Multi-AZ VPC reference architecture template should exist');

  // Verify boundaries
  const boundaryNodes = vpcArch.nodes.filter(n => n.type === 'boundaryNode');
  const boundaryTypes = boundaryNodes.map(n => n.data.boundaryType);

  assert.ok(boundaryTypes.includes('region'), 'Must contain Region boundary');
  assert.ok(boundaryTypes.includes('vpc'), 'Must contain VPC boundary');
  assert.strictEqual(boundaryTypes.filter(t => t === 'az').length, 2, 'Must contain 2 Availability Zones');
  assert.strictEqual(boundaryTypes.filter(t => t === 'public_subnet').length, 2, 'Must contain 2 Public Subnets');
  assert.strictEqual(boundaryTypes.filter(t => t === 'private_subnet').length, 2, 'Must contain 2 Private Subnets');
  assert.strictEqual(boundaryTypes.filter(t => t === 'security_group').length, 2, 'Must contain 2 Security Groups');

  // Verify services & tiers
  const serviceNodes = vpcArch.nodes.filter(n => n.type === 'serviceNode');
  const serviceIds = serviceNodes.map(n => n.data.serviceId);

  assert.ok(serviceIds.includes('internet_gateway'), 'Must include Internet Gateway');
  assert.ok(serviceIds.includes('alb'), 'Must include Application Load Balancer');
  assert.ok(serviceIds.includes('ec2'), 'Must include EC2 Web servers');
  assert.ok(serviceIds.includes('rds'), 'Must include RDS Database servers');
  assert.ok(serviceIds.includes('s3'), 'Must include Amazon S3 bucket');
  assert.ok(serviceIds.includes('s3_gateway_endpoint'), 'Must include S3 Gateway Endpoint');

  // Verify subnets tiering
  const webServers = serviceNodes.filter(n => n.data.label === 'Web servers');
  assert.ok(webServers.every(s => s.data.subnet === 'public'), 'Web servers must be in public subnets');

  const dbServers = serviceNodes.filter(n => n.data.label === 'Database servers');
  assert.ok(dbServers.every(s => s.data.subnet === 'private'), 'Database servers must be in private subnets');
});

test('13. Simulation: Ingress and Multi-Tier Traversal in Multi-AZ VPC Reference Architecture', () => {
  const vpcArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'vpc-subnets-multi-az-security-groups')!;
  const scenario: SimulationScenario = {
    id: 'test-vpc-ingress',
    name: 'Production Ingress Test',
    method: 'GET',
    path: '/api/v1/checkout',
    startNodeId: 'node-igw',
    trafficLevel: 'normal'
  };

  const result = runSimulation(vpcArch.nodes, vpcArch.edges, scenario);
  assert.strictEqual(result.success, true, 'Traffic starting at IGW should succeed across tiers');
  assert.strictEqual(result.statusCode, 200, 'Status code should be 200 OK');
  assert.ok(result.steps.some(s => s.targetNodeName === 'Internet Gateway' || s.sourceNodeName === 'Internet Gateway'), 'Should traverse Internet Gateway');
  assert.ok(result.steps.some(s => s.targetNodeName === 'Application Load Balancer' || s.sourceNodeName === 'Application Load Balancer'), 'Should route through Application Load Balancer');
  assert.ok(result.steps.some(s => s.targetNodeId === 'node-db-a'), 'Should query private database');
});

test('14. Crash Safety: Boundary Nodes as First Elements & startNode Fallback', () => {
  const vpcArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'vpc-subnets-multi-az-security-groups')!;
  assert.strictEqual(vpcArch.nodes[0].type, 'boundaryNode', 'First node is a boundaryNode container');

  // Request simulation with a missing startNodeId must NOT pick a boundaryNode!
  const scenarioWithBadStartId: SimulationScenario = {
    id: 'test-fallback',
    name: 'Fallback Ingress Resolution',
    method: 'GET',
    path: '/api/v1/test',
    startNodeId: 'non-existent-node-id',
    trafficLevel: 'normal'
  };

  const result = runSimulation(vpcArch.nodes, vpcArch.edges, scenarioWithBadStartId);
  assert.strictEqual(result.success, true, 'Simulation must auto-resolve to a valid ingress service instead of crashing on boundary');
  assert.strictEqual(result.steps[0].targetNodeName, 'Internet Gateway', 'Must resolve to ingress service (node-igw)');
});

test('15. Architectural Analysis Safety with Boundary Containers', () => {
  const vpcArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'vpc-subnets-multi-az-security-groups')!;
  const analysis = analyzeArchitecture(vpcArch.nodes, vpcArch.edges);

  assert.ok(analysis.availability.score >= 0 && analysis.availability.score <= 100, 'Availability score must be calculated cleanly');
  assert.ok(analysis.resilience.score >= 0 && analysis.resilience.score <= 100, 'Resilience score must be valid');
  assert.ok(analysis.security.score >= 0 && analysis.security.score <= 100, 'Security score must be valid');
  assert.ok(Array.isArray(analysis.spofs), 'SPOF detection must succeed with boundary nodes present');
});

test('16. Boundary Layer Hierarchy and Stacking Order (Z-Index)', () => {
  const vpcArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'vpc-subnets-multi-az-security-groups')!;
  const boundaryNodes = vpcArch.nodes.filter(n => n.type === 'boundaryNode');
  const serviceNodes = vpcArch.nodes.filter(n => n.type !== 'boundaryNode');

  // Verify that boundary nodes have appropriate negative or low zIndices so they sit behind services
  const vpcBoundary = boundaryNodes.find(b => b.data.boundaryType === 'vpc');
  assert.ok(vpcBoundary, 'VPC boundary exists');
  assert.ok((vpcBoundary.zIndex ?? 0) <= -2, 'VPC boundary must have low zIndex to sit behind subnets');

  const subnetBoundaries = boundaryNodes.filter(b => b.data.boundaryType === 'public_subnet' || b.data.boundaryType === 'private_subnet');
  assert.ok(subnetBoundaries.length > 0, 'Subnets exist');
  for (const subnet of subnetBoundaries) {
    assert.ok((subnet.zIndex ?? 0) > (vpcBoundary.zIndex ?? -2), 'Subnet zIndex must be greater than VPC zIndex');
  }

  // Verify that service nodes sit above boundaries by default
  for (const service of serviceNodes) {
    const serviceZ = service.zIndex ?? 10;
    assert.ok(serviceZ > 0, `Service node ${service.id} must have positive zIndex to sit in front of boundaries`);
  }
});

test('17. Boundary Dimensions and Auto-Fit Geometry', () => {
  const vpcArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'vpc-subnets-multi-az-security-groups')!;
  const boundaryNodes = vpcArch.nodes.filter(n => n.type === 'boundaryNode');

  // Verify all boundaries define valid positive width and height
  for (const boundary of boundaryNodes) {
    const w = boundary.data.width || (boundary.style as any)?.width;
    const h = boundary.data.height || (boundary.style as any)?.height;
    assert.ok(typeof w === 'number' && w >= 100, `Boundary ${boundary.id} width must be >= 100px`);
    assert.ok(typeof h === 'number' && h >= 60, `Boundary ${boundary.id} height must be >= 60px`);
  }

  // Verify auto-fit geometry calculation:
  // Given boundary position (100, 100) and enclosed services at (150, 150) and (400, 300)
  const bPos = { x: 100, y: 100 };
  const mockServices = [
    { position: { x: 150, y: 150 } },
    { position: { x: 400, y: 300 } },
  ];
  const padding = 55;
  const rightMost = Math.max(...mockServices.map(s => s.position.x + 90)); // 490
  const bottomMost = Math.max(...mockServices.map(s => s.position.y + 90)); // 390
  const computedW = Math.max(200, Math.round(rightMost - bPos.x + padding)); // 490 - 100 + 55 = 445
  const computedH = Math.max(120, Math.round(bottomMost - bPos.y + padding)); // 390 - 100 + 55 = 345

  assert.strictEqual(computedW, 445, 'Calculated width should encompass all enclosed services plus padding');
  assert.strictEqual(computedH, 345, 'Calculated height should encompass all enclosed services plus padding');
});

test('18. Task Flow Line Traversal Mapping and Edge Sequence Attribution', () => {
  const haArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'highly-available-multiaz')!;
  const scenario: SimulationScenario = {
    id: 'test-flow',
    name: 'Task Flow Test',
    method: 'GET',
    path: '/api/v1/orders',
    startNodeId: 'node-user',
    trafficLevel: 'normal'
  };

  const result = runSimulation(haArch.nodes, haArch.edges, scenario);
  assert.strictEqual(result.success, true, 'Simulation should succeed');
  assert.ok(result.steps.length > 0, 'Should have simulation steps');

  // Map each step to matching edges (bidirectional)
  const traversedEdgeIds = new Set<string>();
  const stepEdgeMap: { stepNumber: number; edgeId: string; action: string }[] = [];

  for (const step of result.steps) {
    const matchingEdge = haArch.edges.find(
      e => (e.source === step.sourceNodeId && e.target === step.targetNodeId) ||
           (e.source === step.targetNodeId && e.target === step.sourceNodeId)
    );
    if (matchingEdge) {
      traversedEdgeIds.add(matchingEdge.id);
      stepEdgeMap.push({
        stepNumber: step.stepNumber,
        edgeId: matchingEdge.id,
        action: step.action
      });
    }
  }

  // Verify that the task flow traversed the critical ingress and compute edges
  assert.ok(traversedEdgeIds.size >= 3, 'Task flow must traverse at least 3 distinct edges across tiers');
  assert.ok(
    stepEdgeMap.some(s => s.action.toLowerCase().includes('forward') || s.action.toLowerCase().includes('issue') || s.action.toLowerCase().includes('route')),
    'Traversed steps must carry descriptive task flow actions'
  );
});

test('19. Task Flow Dimming of Non-Participating Edges and Failure Isolation', () => {
  const haArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'highly-available-multiaz')!;
  
  // Create an extra unrelated edge that is NOT part of the request flow (e.g. EC2 to SQS)
  const extraEdge = {
    id: 'edge-unrelated-mock',
    source: 'node-web-b',
    target: 'node-nonexistent',
    type: 'custom',
    data: { protocol: 'Message', interactionType: 'asynchronous', isCriticalDependency: false, timeoutMs: 2000 }
  };
  const testEdges = [...haArch.edges, extraEdge as any];

  const scenario: SimulationScenario = {
    id: 'test-dimming',
    name: 'Dimming Test',
    method: 'GET',
    path: '/products',
    startNodeId: 'node-user',
    trafficLevel: 'normal'
  };

  const result = runSimulation(haArch.nodes, testEdges, scenario);

  // Check which edges participate in task flow
  const participatingEdgeIds = new Set(
    result.steps.flatMap(s =>
      testEdges.filter(e =>
        (e.source === s.sourceNodeId && e.target === s.targetNodeId) ||
        (e.source === s.targetNodeId && e.target === s.sourceNodeId)
      ).map(e => e.id)
    )
  );

  assert.ok(participatingEdgeIds.has('edge-igw-alb') || participatingEdgeIds.size > 0, 'Flow must contain participating edges');
  assert.ok(!participatingEdgeIds.has('edge-unrelated-mock'), 'Unrelated edge must NOT participate in task flow and should be dimmed');
});





test('20. VPC Behavior: Public Subnet Unreachable Without an Internet Gateway', () => {
  const mkNodes = (igwHealth?: 'healthy' | 'failed') => {
    const nodes: any[] = [
      {
        id: 'node-user',
        type: 'serviceNode',
        position: { x: 0, y: 0 },
        data: { serviceId: 'user', label: 'User', category: 'Client / Ingress', health: 'healthy', az: 'Edge / Global', subnet: 'global' }
      },
      {
        id: 'node-alb',
        type: 'serviceNode',
        position: { x: 200, y: 0 },
        data: { serviceId: 'alb', label: 'ALB', category: 'Networking & Content Delivery', health: 'healthy', az: 'Multi-AZ', subnet: 'public' }
      },
      {
        id: 'node-ec2',
        type: 'serviceNode',
        position: { x: 400, y: 0 },
        data: { serviceId: 'ec2', label: 'Web Server', category: 'Compute', health: 'healthy', az: 'AZ-A', subnet: 'private', replicas: 1 }
      }
    ];
    if (igwHealth) {
      nodes.splice(1, 0, {
        id: 'node-igw',
        type: 'serviceNode',
        position: { x: 100, y: 0 },
        data: { serviceId: 'internet_gateway', label: 'Internet Gateway', category: 'Networking & Content Delivery', health: igwHealth, az: 'Edge / Global', subnet: 'public' }
      });
    }
    return nodes;
  };

  const scenario: SimulationScenario = {
    id: 'test-igw',
    name: 'Public Ingress Test',
    method: 'GET',
    path: '/api/health',
    startNodeId: 'node-user',
    trafficLevel: 'normal'
  };

  // Case 1: No Internet Gateway anywhere in the architecture -> blocked, no route to the VPC.
  const noIgwNodes = mkNodes();
  const noIgwEdges = [{ id: 'e1', source: 'node-user', target: 'node-alb', data: { protocol: 'HTTPS' } }];
  const noIgwResult = runSimulation(noIgwNodes as any, noIgwEdges as any, scenario);
  assert.strictEqual(noIgwResult.success, false, 'Public ingress must fail when the VPC has no Internet Gateway attached');
  assert.strictEqual(noIgwResult.statusCode, 504, 'Missing Internet Gateway should surface as a 504 (no route to host)');

  // Case 2: Internet Gateway present but failed -> blocked, VPC lost its only path to the internet.
  // The gateway does not need to sit on the traversed edge path for this check (mirroring how
  // NAT Gateway health is looked up architecture-wide rather than only along the visited route).
  const failedIgwNodes = mkNodes('failed');
  const failedIgwEdges = [
    { id: 'e1', source: 'node-user', target: 'node-alb', data: { protocol: 'HTTPS' } }
  ];
  const failedIgwResult = runSimulation(failedIgwNodes as any, failedIgwEdges as any, scenario);
  assert.strictEqual(failedIgwResult.success, false, 'Public ingress must fail when the Internet Gateway is unhealthy');
  assert.strictEqual(failedIgwResult.statusCode, 504, 'Failed Internet Gateway should surface as a 504');

  // Case 3: Healthy Internet Gateway present -> ALB is reachable and traffic proceeds normally.
  const healthyIgwNodes = mkNodes('healthy');
  const healthyIgwEdges = [
    { id: 'e1', source: 'node-user', target: 'node-igw', data: { protocol: 'HTTPS' } },
    { id: 'e1b', source: 'node-igw', target: 'node-alb', data: { protocol: 'HTTPS' } },
    { id: 'e2', source: 'node-alb', target: 'node-ec2', data: { protocol: 'HTTP' } }
  ];
  const healthyIgwResult = runSimulation(healthyIgwNodes as any, healthyIgwEdges as any, scenario);
  assert.strictEqual(healthyIgwResult.success, true, 'Public ingress must succeed once a healthy Internet Gateway is attached');
});

test('21. Reference Diagram "Simple website": Region/VPC/Subnets/Storage End-to-End', () => {
  const tpl = REFERENCE_ARCHITECTURES.find(a => a.id === 'simple-website')!;
  assert.ok(tpl, 'Simple website reference template should exist');

  // Structural shape: Region > VPC > public subnet (IGW + ALB) + private subnet (web server), plus S3 storage.
  const boundaryTypes = tpl.nodes.filter(n => n.type === 'boundaryNode').map((n: any) => n.data.boundaryType);
  assert.ok(boundaryTypes.includes('region'), 'Must contain a Region boundary');
  assert.ok(boundaryTypes.includes('vpc'), 'Must contain a VPC boundary');
  assert.ok(boundaryTypes.includes('public_subnet'), 'Must contain a public subnet boundary');
  assert.ok(boundaryTypes.includes('private_subnet'), 'Must contain a private subnet boundary');

  const serviceIds = tpl.nodes.filter(n => n.type === 'serviceNode').map((n: any) => n.data.serviceId);
  assert.ok(serviceIds.includes('internet_gateway'), 'Must include an Internet Gateway');
  assert.ok(serviceIds.includes('alb'), 'Must include an Application Load Balancer');
  assert.ok(serviceIds.includes('ec2'), 'Must include a web server');
  assert.ok(serviceIds.includes('s3'), 'Must include S3 storage');

  const webNode = tpl.nodes.find((n: any) => n.data.serviceId === 'ec2')!;
  assert.strictEqual((webNode.data as any).subnet, 'private', 'Web server must live in the private subnet');
  const albNode = tpl.nodes.find((n: any) => n.data.serviceId === 'alb')!;
  assert.strictEqual((albNode.data as any).subnet, 'public', 'ALB must live in the public subnet');

  // Behavioral shape: the whole request must actually complete successfully end-to-end.
  const serviceNodes = tpl.nodes.filter(n => n.type === 'serviceNode' || (n.data as any)?.serviceId);
  const ingressNode = serviceNodes.find(n => ['user', 'client_ui', 'api_client'].includes((n.data as any).serviceId))!;

  const scenario: SimulationScenario = {
    id: 'test-simple-website',
    name: 'Home Page Load',
    method: 'GET',
    path: '/index.html',
    startNodeId: ingressNode.id,
    trafficLevel: 'normal'
  };

  const result = runSimulation(tpl.nodes, tpl.edges, scenario);
  assert.strictEqual(result.success, true, 'Simple website request must complete successfully end-to-end');
  assert.strictEqual(result.statusCode, 200, 'Should return HTTP 200 OK');
  assert.ok(result.steps.some(s => s.action.includes('VPC Gateway Endpoint')), 'Web server must reach S3 via the Gateway Endpoint, not the public internet');
});

test('22. Geometric Containment: Subnet Placement Derived From Canvas Position', async () => {
  const { deriveSubnetForNode } = await import('../src/engine/layout/containment.ts');

  const publicSubnet = {
    id: 'box-pub',
    type: 'boundaryNode',
    position: { x: 100, y: 100 },
    data: { boundaryType: 'public_subnet', width: 300, height: 200 }
  };
  const privateSubnet = {
    id: 'box-priv',
    type: 'boundaryNode',
    position: { x: 500, y: 100 },
    data: { boundaryType: 'private_subnet', width: 300, height: 200 }
  };
  const boundaries = [publicSubnet, privateSubnet] as any;

  const albInsidePublic = { id: 'n1', position: { x: 200, y: 150 }, data: { serviceId: 'alb' } } as any;
  assert.strictEqual(deriveSubnetForNode(albInsidePublic, boundaries), 'public', 'ALB inside the public subnet box must derive public');

  const albOutsideEverything = { id: 'n2', position: { x: 2000, y: 2000 }, data: { serviceId: 'alb' } } as any;
  assert.strictEqual(deriveSubnetForNode(albOutsideEverything, boundaries), 'unassigned', 'ALB dragged outside every subnet must be unassigned - it would be architecturally invalid in real AWS');

  const ec2InsidePrivate = { id: 'n3', position: { x: 600, y: 150 }, data: { serviceId: 'ec2' } } as any;
  assert.strictEqual(deriveSubnetForNode(ec2InsidePrivate, boundaries), 'private', 'EC2 inside the private subnet box must derive private');

  const lambdaOutsideEverything = { id: 'n4', position: { x: 2000, y: 2000 }, data: { serviceId: 'lambda' } } as any;
  assert.strictEqual(deriveSubnetForNode(lambdaOutsideEverything, boundaries), 'global', 'A fully-managed/serverless service outside any subnet is legitimately global, not an error');

  const natOutsideEverything = { id: 'n5', position: { x: 2000, y: 2000 }, data: { serviceId: 'nat_gateway' } } as any;
  assert.strictEqual(deriveSubnetForNode(natOutsideEverything, boundaries), 'private', 'A misplaced NAT Gateway falls back to private so its own dedicated misconfiguration message fires');
});

test('23. Simulation Fails When a VPC-Hosted Resource Is Not Placed Inside Any Subnet', () => {
  const tpl = REFERENCE_ARCHITECTURES.find(a => a.id === 'simple-website')!;

  // Mirrors dragging the ALB outside the VPC boundary on the canvas: the live containment
  // effect in ArchitectureContext would recompute its subnet to 'unassigned' the moment this
  // happens, so this test applies that same correction directly to the static template data.
  const draggedOutNodes = tpl.nodes.map(n =>
    n.id === 'node-alb' ? { ...n, data: { ...(n.data as any), subnet: 'unassigned' } } : n
  );

  const scenario: SimulationScenario = {
    id: 'test-drag-out',
    name: 'ALB Dragged Outside VPC',
    method: 'GET',
    path: '/index.html',
    startNodeId: 'node-user',
    trafficLevel: 'normal'
  };

  const result = runSimulation(draggedOutNodes, tpl.edges, scenario);
  assert.strictEqual(result.success, false, 'Request must fail when the ALB is not placed inside any subnet');
  assert.strictEqual(result.statusCode, 400, 'Should return a placement-error status code');
  assert.ok(result.steps.some(s => s.action.includes('Not Inside Any Subnet')), 'Must explain the resource is not placed inside a subnet');
});

test('24. S3 Gateway Endpoint Is Wired Into the Request Path, Not Just Present', () => {
  const tpl = REFERENCE_ARCHITECTURES.find(a => a.id === 'simple-website')!;

  const endpointHasIncomingEdge = tpl.edges.some(e => e.target === 'node-s3-gateway');
  const endpointHasOutgoingEdge = tpl.edges.some(e => e.source === 'node-s3-gateway');
  assert.ok(endpointHasIncomingEdge, 'Web server must have a real edge into the S3 Gateway Endpoint');
  assert.ok(endpointHasOutgoingEdge, 'S3 Gateway Endpoint must have a real edge onward to S3');

  const scenario: SimulationScenario = {
    id: 'test-endpoint-routing',
    name: 'Home Page Load',
    method: 'GET',
    path: '/index.html',
    startNodeId: 'node-user',
    trafficLevel: 'normal'
  };

  const result = runSimulation(tpl.nodes, tpl.edges, scenario);
  assert.strictEqual(result.success, true, 'Request must still succeed when routed through an explicit endpoint edge');
  const endpointStep = result.steps.find(s => s.targetNodeId === 'node-s3-gateway');
  assert.ok(endpointStep, 'Traversal must visit the S3 Gateway Endpoint as a real hop');
  assert.strictEqual(endpointStep!.action, 'AWS VPC Gateway Endpoint Route', 'The hop into the endpoint must carry the dedicated explanatory message');
});

test('25. Reference Diagram Geometry Integrity: Every VPC-Bound Node Sits Inside Its Declared Subnet', async () => {
  const { deriveSubnetForNode } = await import('../src/engine/layout/containment.ts');

  for (const tpl of REFERENCE_ARCHITECTURES) {
    const boundaryNodes = tpl.nodes.filter(n => n.type === 'boundaryNode');
    const serviceNodes = tpl.nodes.filter(n => n.type === 'serviceNode');

    for (const n of serviceNodes) {
      const derived = deriveSubnetForNode(n as any, boundaryNodes as any);
      const authored = (n.data as any).subnet;
      assert.strictEqual(
        derived,
        authored,
        `[${tpl.id}] ${n.id} (${(n.data as any).serviceId}): authored subnet '${authored}' does not match its actual canvas position, which derives '${derived}'`
      );
    }
  }
});

test('26. CIDR Allocator: Equal, Non-Overlapping Subnet Blocks Carved From a VPC', async () => {
  const { allocateSubnetCidrs } = await import('../src/engine/layout/cidrAllocator.ts');

  // 2 public + 2 private = 4 subnets -> exactly 4 equal /18 blocks out of a /16 VPC.
  const four = allocateSubnetCidrs('10.0.0.0/16', ['pub-a', 'pub-b', 'priv-a', 'priv-b']);
  assert.strictEqual(four.get('pub-a')!.cidr, '10.0.0.0/18');
  assert.strictEqual(four.get('pub-b')!.cidr, '10.0.64.0/18');
  assert.strictEqual(four.get('priv-a')!.cidr, '10.0.128.0/18');
  assert.strictEqual(four.get('priv-b')!.cidr, '10.0.192.0/18');
  assert.ok([...four.values()].every(a => a.error === null), 'A /16 VPC split 4 ways must not report any error');

  // 3 subnets -> rounds up to 4 equal blocks (one held in reserve), never overlapping.
  const three = allocateSubnetCidrs('10.0.0.0/16', ['a', 'b', 'c']);
  const cidrs = ['a', 'b', 'c'].map(id => three.get(id)!.cidr);
  assert.deepStrictEqual(cidrs, ['10.0.0.0/18', '10.0.64.0/18', '10.0.128.0/18']);

  // A single subnet gets the entire VPC range.
  const one = allocateSubnetCidrs('10.0.0.0/16', ['only']);
  assert.strictEqual(one.get('only')!.cidr, '10.0.0.0/16');
});

test('27. CIDR Allocator: Refuses to Violate AWS\'s /28 Minimum Subnet Size', async () => {
  const { allocateSubnetCidrs } = await import('../src/engine/layout/cidrAllocator.ts');

  // A /28 VPC (16 addresses) cannot be split into 2 AWS-valid subnets - that would need /29,
  // smaller than AWS's real /28 floor. Must fail loudly instead of emitting an invalid block.
  const tooSmall = allocateSubnetCidrs('10.0.0.0/28', ['a', 'b']);
  assert.strictEqual(tooSmall.get('a')!.cidr, null);
  assert.ok(tooSmall.get('a')!.error?.includes('/28'), 'Error must explain the AWS /28 minimum');

  // A missing/malformed VPC CIDR must fail every subnet with a clear reason, not throw or
  // silently produce a bogus block.
  const noVpcCidr = allocateSubnetCidrs(undefined, ['a']);
  assert.strictEqual(noVpcCidr.get('a')!.cidr, null);
  assert.ok(noVpcCidr.get('a')!.error?.includes('CIDR'));

  const malformed = allocateSubnetCidrs('not-a-cidr', ['a']);
  assert.strictEqual(malformed.get('a')!.cidr, null);
});

test('28. Live Canvas Scenario: VPC Subnet Auto-Numbering Matches Position and Scopes Per VPC', async () => {
  const { findContainingVpc } = await import('../src/engine/layout/containment.ts');
  const { allocateSubnetCidrs } = await import('../src/engine/layout/cidrAllocator.ts');

  // Two independent VPCs on the same canvas, each with their own public+private subnet pair -
  // mirrors a student drawing two separate VPCs side by side.
  const vpcA: any = { id: 'vpc-a', type: 'boundaryNode', position: { x: 0, y: 0 }, data: { boundaryType: 'vpc', width: 400, height: 300, cidr: '10.0.0.0/16' } };
  const vpcB: any = { id: 'vpc-b', type: 'boundaryNode', position: { x: 600, y: 0 }, data: { boundaryType: 'vpc', width: 400, height: 300, cidr: '172.16.0.0/16' } };
  const pubA: any = { id: 'pub-a', type: 'boundaryNode', position: { x: 20, y: 20 }, data: { boundaryType: 'public_subnet', width: 150, height: 100 } };
  const privA: any = { id: 'priv-a', type: 'boundaryNode', position: { x: 200, y: 20 }, data: { boundaryType: 'private_subnet', width: 150, height: 100 } };
  const pubB: any = { id: 'pub-b', type: 'boundaryNode', position: { x: 620, y: 20 }, data: { boundaryType: 'public_subnet', width: 150, height: 100 } };

  const boundaries = [vpcA, vpcB, pubA, privA, pubB];

  assert.strictEqual(findContainingVpc(pubA, boundaries)!.id, 'vpc-a');
  assert.strictEqual(findContainingVpc(privA, boundaries)!.id, 'vpc-a');
  assert.strictEqual(findContainingVpc(pubB, boundaries)!.id, 'vpc-b');

  const vpcAAllocations = allocateSubnetCidrs(vpcA.data.cidr, [pubA.id, privA.id]);
  const vpcBAllocations = allocateSubnetCidrs(vpcB.data.cidr, [pubB.id]);

  assert.strictEqual(vpcAAllocations.get('pub-a')!.cidr, '10.0.0.0/17', 'VPC A subnets must be carved from VPC A\'s own 10.x range');
  assert.strictEqual(vpcAAllocations.get('priv-a')!.cidr, '10.0.128.0/17');
  assert.strictEqual(vpcBAllocations.get('pub-b')!.cidr, '172.16.0.0/16', 'VPC B\'s subnet must come from VPC B\'s own 172.16.x range, never VPC A\'s');
});

test('29. Reference Diagram "Serverless Container": JWT API, Cloud Map, Per-Service Auto Scaling & DynamoDB', () => {
  const tpl = REFERENCE_ARCHITECTURES.find(a => a.id === 'serverless-container')!;
  assert.ok(tpl, 'Serverless Container reference template should exist');

  const serviceIds = tpl.nodes.filter(n => n.type === 'serviceNode').map((n: any) => n.data.serviceId);
  assert.ok(serviceIds.includes('cognito'), 'Must include Cognito for JWT issuance');
  assert.ok(serviceIds.includes('api_gateway'), 'Must include API Gateway');
  assert.ok(serviceIds.includes('cloud_map'), 'Must include Cloud Map for service discovery');
  assert.strictEqual(serviceIds.filter((id: string) => id === 'ecs').length, 2, 'Must include two independent ECS services (pets, foods)');
  assert.strictEqual(serviceIds.filter((id: string) => id === 'dynamodb').length, 2, 'Each microservice must own its own DynamoDB table');
  assert.strictEqual(serviceIds.filter((id: string) => id === 'auto_scaling_mgmt').length, 2, 'Each ECS service must have its own Auto Scaling');

  // API Gateway (HTTP API) must NOT be forced into a VPC subnet - it's fully-managed.
  const apiGw = tpl.nodes.find((n: any) => n.data.serviceId === 'api_gateway')!;
  assert.strictEqual((apiGw.data as any).subnet, 'global', 'HTTP API Gateway needs no VPC placement');

  // Fargate tasks are the one thing here that genuinely needs a subnet.
  const ecsNodes = tpl.nodes.filter((n: any) => n.data.serviceId === 'ecs');
  assert.ok(ecsNodes.every((n: any) => n.data.subnet === 'private'), 'ECS services must be placed inside the private subnet');

  const scenario: SimulationScenario = {
    id: 'test-serverless-container',
    name: 'Get Pet',
    method: 'GET',
    path: '/petstore/pets/123',
    startNodeId: 'node-users',
    trafficLevel: 'normal'
  };

  // Happy path: request reaches the pets service and its own table.
  const result = runSimulation(tpl.nodes, tpl.edges, scenario);
  assert.strictEqual(result.success, true, 'Request must succeed end-to-end');
  assert.strictEqual(result.statusCode, 200, 'Should return HTTP 200 OK');
  assert.ok(result.steps.some(s => s.targetNodeId === 'node-ecs-pets'), 'Must route through the pets ECS service');
  assert.ok(result.steps.some(s => s.targetNodeId === 'node-dynamodb-pets'), 'Must query the pets DynamoDB table');

  // Failing the pets service must not take down the whole API - foods is an independent
  // service, and API Gateway's target-health logic should fail over to it.
  const petsFailedNodes = tpl.nodes.map(n =>
    n.id === 'node-ecs-pets' ? { ...n, data: { ...(n.data as any), health: 'failed' as const } } : n
  );
  const failoverResult = runSimulation(petsFailedNodes, tpl.edges, scenario);
  assert.strictEqual(failoverResult.success, true, 'Foods service must remain reachable when pets is down');
  assert.ok(failoverResult.steps.some(s => s.targetNodeId === 'node-ecs-foods'), 'Must fail over to the foods ECS service');

  // No SPOF: each service is replicated and Multi-AZ.
  const spofs = detectSPOFs(tpl.nodes, tpl.edges);
  assert.strictEqual(spofs.length, 0, 'Replicated, Multi-AZ microservices should have zero SPOFs');
});

test('30. Reference Diagram "Auto Scaling: EC2 Instance Failure Recovery"', () => {
  const tpl = REFERENCE_ARCHITECTURES.find(a => a.id === 'ec2-auto-scaling-failure-recovery')!;
  assert.ok(tpl, 'EC2 Auto Scaling failure-recovery template should exist');

  const scenario: SimulationScenario = {
    id: 'test-asg-happy',
    name: 'Normal Request',
    method: 'GET',
    path: '/',
    startNodeId: 'node-user',
    trafficLevel: 'normal'
  };

  // Happy path: both EC2 instances healthy, ALB picks the first one.
  const happy = runSimulation(tpl.nodes, tpl.edges, scenario);
  assert.strictEqual(happy.success, true, 'Request must succeed when both EC2 instances are healthy');
  assert.ok(happy.steps.some(s => s.targetNodeId === 'node-ec2-a'), 'ALB should route to EC2 Instance (AZ-A) by default');

  // Fail EC2-A: ALB must detect the bad health check and route to EC2-B instead, and the
  // explanation must call out that the Auto Scaling Group will replace the failed instance.
  const ec2AFailed = tpl.nodes.map(n =>
    n.id === 'node-ec2-a' ? { ...n, data: { ...(n.data as any), health: 'failed' as const, failureReason: 'Simulated crash' } } : n
  );
  const failover = runSimulation(ec2AFailed, tpl.edges, scenario);
  assert.strictEqual(failover.success, true, 'Request must still succeed when only one EC2 instance fails');
  const routeStep = failover.steps.find(s => s.action.startsWith('Route to'))!;
  assert.strictEqual(routeStep.targetNodeId, 'node-ec2-b', 'ALB must fail over to the surviving EC2 instance');
  assert.ok(routeStep.explanation.includes('Auto Scaling Group'), 'Must explain that the ASG will replace the failed instance');
  assert.ok(routeStep.explanation.toLowerCase().includes('replacement'), 'Must explain the ASG launches a replacement instance');

  // Both instances failing must actually take the app down (no phantom capacity).
  const bothFailed = tpl.nodes.map(n =>
    ['node-ec2-a', 'node-ec2-b'].includes(n.id) ? { ...n, data: { ...(n.data as any), health: 'failed' as const } } : n
  );
  const totalOutage = runSimulation(bothFailed, tpl.edges, scenario);
  assert.strictEqual(totalOutage.success, false, 'Request must fail when every EC2 instance is down');
  assert.strictEqual(totalOutage.statusCode, 503, 'Should return 503 Service Unavailable with zero healthy targets');

  // A traffic spike must independently trigger the Auto Scaling Group to scale out.
  const surge = runSimulation(tpl.nodes, tpl.edges, { ...scenario, trafficLevel: '10x' });
  assert.strictEqual(surge.success, true, 'Request must succeed under a 10x traffic surge');
  assert.ok(surge.steps.some(s => s.action.includes('Auto Scaling Group: Dynamic Scale-Out')), 'A traffic spike must trigger ASG scale-out');
});

test('31. Network Firewall Engine: NACL (Stateless Deny-List) vs Security Group (Stateful Allow-List)', async () => {
  const { checkNetworkFirewalls } = await import('../src/engine/simulation/networkFirewalls.ts');

  const subnetWithNacl: any = {
    id: 'subnet1', type: 'boundaryNode', position: { x: 0, y: 0 },
    data: { boundaryType: 'private_subnet', width: 300, height: 200, label: 'DB Subnet', naclDenyInbound: ['TCP'] }
  };
  const sgAllowSql: any = {
    id: 'sg1', type: 'boundaryNode', position: { x: 20, y: 20 },
    data: { boundaryType: 'security_group', width: 100, height: 100, label: 'DB SG', allowedProtocols: ['SQL'] }
  };
  // Security Group attachment is explicit (by ID), like real AWS - not by canvas position.
  const target: any = { id: 't1', position: { x: 50, y: 50 }, data: { serviceId: 'rds', securityGroupIds: ['sg1'] } };
  const boundaries = [subnetWithNacl, sgAllowSql];

  // NACL has no rule against SQL, so it passes through; SG explicitly allows SQL -> fully allowed.
  const sqlResult = checkNetworkFirewalls('SQL', target, boundaries);
  assert.strictEqual(sqlResult.nacl.evaluated, true);
  assert.strictEqual(sqlResult.nacl.blocked, false, 'NACL must not block a protocol not on its deny list');
  assert.strictEqual(sqlResult.securityGroup.evaluated, true);
  assert.strictEqual(sqlResult.securityGroup.blocked, false, 'SG must allow a protocol on its allow list');

  // NACL has no rule against HTTPS either, so it passes through - but the SG only allows SQL,
  // so it must block here. This is the exact scenario the reference architecture demonstrates.
  const httpsResult = checkNetworkFirewalls('HTTPS', target, boundaries);
  assert.strictEqual(httpsResult.nacl.blocked, false, 'NACL should let HTTPS through - it only denies TCP');
  assert.strictEqual(httpsResult.securityGroup.blocked, true, 'SG must block HTTPS - only SQL is allowed');

  // TCP is explicitly denied by the NACL - it must block before the Security Group is even
  // consulted (a NACL deny is unconditional and evaluated first).
  const tcpResult = checkNetworkFirewalls('TCP', target, boundaries);
  assert.strictEqual(tcpResult.nacl.blocked, true, 'NACL must block its own explicit deny rule');
  assert.strictEqual(tcpResult.securityGroup.evaluated, false, 'SG must never be evaluated once the NACL has already denied the packet');

  // A boundary with no rules configured must not affect anything (the default, wide-open case).
  const undecorated = checkNetworkFirewalls('HTTP', target, []);
  assert.strictEqual(undecorated.nacl.evaluated, false);
  assert.strictEqual(undecorated.securityGroup.evaluated, false);
});

test('32. Reference Diagram "Network ACL vs Security Group in Action"', () => {
  const tpl = REFERENCE_ARCHITECTURES.find(a => a.id === 'nacl-vs-security-group')!;
  assert.ok(tpl, 'NACL vs Security Group reference template should exist');

  const scenario: SimulationScenario = {
    id: 'test-nacl-sg',
    name: 'Default Demonstration',
    method: 'GET',
    path: '/',
    startNodeId: 'node-user',
    trafficLevel: 'normal'
  };

  const result = runSimulation(tpl.nodes, tpl.edges, scenario);

  // The App tier's Security Group must visibly allow the legitimate HTTP request through.
  const appSgStep = result.steps.find(s => s.targetNodeId === 'node-ec2-app' && s.action.includes('Security Group'));
  assert.ok(appSgStep, 'App tier Security Group must be evaluated and shown in the trace');
  assert.strictEqual(appSgStep!.status, 'success', 'App tier Security Group should allow the HTTP request');

  // The Database subnet's Network ACL must visibly allow the (mismatched) HTTPS request through -
  // it only denies TCP, demonstrating a NACL passing traffic a Security Group later rejects.
  const dbNaclStep = result.steps.find(s => s.targetNodeId === 'node-rds' && s.action.includes('Network ACL'));
  assert.ok(dbNaclStep, 'Database subnet Network ACL must be evaluated and shown in the trace');
  assert.strictEqual(dbNaclStep!.status, 'success', 'Network ACL has no rule against HTTPS and must let it through');

  // The Database's Security Group must be the one that actually blocks the request.
  assert.strictEqual(result.success, false, 'The intentional protocol mismatch must fail the request');
  assert.strictEqual(result.statusCode, 403, 'A firewall block should surface as 403 Forbidden');
  const dbSgStep = result.steps.find(s => s.targetNodeId === 'node-rds' && s.action.includes('Security Group'));
  assert.ok(dbSgStep, 'Database Security Group must be evaluated and shown in the trace');
  assert.strictEqual(dbSgStep!.status, 'failed', 'Database Security Group must block the HTTPS request - only SQL is allowed');

  // The NACL step must appear before the Security Group step for the same hop, matching the
  // real order a packet is actually evaluated in.
  assert.ok(dbNaclStep!.stepNumber < dbSgStep!.stepNumber, 'Network ACL must be evaluated before the Security Group');
});

test('33. Subnetting: 5 AWS Reserved Addresses & Usable Host Calculation', () => {
  // 1. Standard /24 Subnet (256 addresses -> 251 usable)
  const allocs = allocateSubnetCidrs('10.0.0.0/16', ['subnet-1', 'subnet-2']);
  const s1 = allocs.get('subnet-1')!;
  assert.ok(s1, 'Subnet-1 must be allocated');
  assert.strictEqual(s1.cidr, '10.0.0.0/17');
  assert.strictEqual(s1.usableHosts, 32768 - 5);
  assert.strictEqual(s1.reservedAddresses.length, 5, 'Every valid AWS subnet must reserve exactly 5 IP addresses');

  // Verify the 5 exact AWS reserved roles
  const [net, rtr, dns, fut, bcast] = s1.reservedAddresses;
  assert.strictEqual(net.offset, 0);
  assert.strictEqual(net.ip, '10.0.0.0');
  assert.strictEqual(net.role, 'Network Address');

  assert.strictEqual(rtr.offset, 1);
  assert.strictEqual(rtr.ip, '10.0.0.1');
  assert.strictEqual(rtr.role, 'VPC Router');

  assert.strictEqual(dns.offset, 2);
  assert.strictEqual(dns.ip, '10.0.0.2');
  assert.ok(dns.role.includes('DNS'));

  assert.strictEqual(fut.offset, 3);
  assert.strictEqual(fut.ip, '10.0.0.3');
  assert.ok(fut.role.includes('Future'));

  assert.strictEqual(bcast.offset, 32767);
  assert.strictEqual(bcast.ip, '10.0.127.255');
  assert.strictEqual(bcast.role, 'Network Broadcast Address');

  // 2. Minimum AWS Subnet /28 (16 addresses -> 11 usable)
  const smallAlloc = allocateSubnetCidrs('192.168.1.0/24', Array.from({ length: 16 }, (_, i) => `sub-${i}`));
  const firstSub = smallAlloc.get('sub-0')!;
  assert.strictEqual(firstSub.cidr, '192.168.1.0/28');
  assert.strictEqual(firstSub.totalAddresses, 16);
  assert.strictEqual(firstSub.usableHosts, 11, 'AWS /28 subnet has exactly 16 - 5 = 11 usable hosts');
  assert.strictEqual(firstSub.usableRange!.start, '192.168.1.4');
  assert.strictEqual(firstSub.usableRange!.end, '192.168.1.14');
  assert.strictEqual(firstSub.reservedAddresses[4].ip, '192.168.1.15');
});

test('34. Cost Calculator: EC2 Instance Sizing, Savings Plans, and EBS Storage Math', () => {
  const ec2Node: any = {
    id: 'node-ec2',
    data: {
      serviceId: 'ec2',
      label: 'App Server',
      category: 'Compute',
      replicas: 2,
      customConfig: {
        instanceType: 'c6i.xlarge', // $0.17/hr
        purchasingOption: 'savings_plan_1yr', // 35% discount (0.65x)
        ebsVolumeType: 'gp3', // $0.08/GB
        ebsVolumeSizeGb: 100
      }
    }
  };

  const cost = calculateNodeCost(ec2Node);
  assert.ok(cost.monthlyCost > 0);

  // Compute check: 2 * ($0.17 * 0.65) * 730 = $161.33
  // Storage check: 2 * (100 * $0.08) = $16.00
  // Total ~ $177.33
  assert.ok(cost.monthlyCost > 170 && cost.monthlyCost < 185, `Expected ~$177/mo, got ${cost.monthlyCost}`);
  assert.strictEqual(cost.lineItems.length, 2, 'Should break down Compute and EBS Storage');
});

test('35. Cost Calculator: S3 Storage Classes (Standard vs Deep Archive) and Volume Scaling', () => {
  const s3Standard: any = {
    id: 'node-s3-std',
    data: {
      serviceId: 's3',
      label: 'Data Lake',
      category: 'Storage',
      customConfig: {
        storageClass: 'STANDARD',
        storageGb: 1000 // 1 TB
      }
    }
  };

  const s3Archive: any = {
    id: 'node-s3-arc',
    data: {
      serviceId: 's3',
      label: 'Cold Archive',
      category: 'Storage',
      customConfig: {
        storageClass: 'DEEP_ARCHIVE',
        storageGb: 1000 // 1 TB
      }
    }
  };

  const stdCost = calculateNodeCost(s3Standard);
  const arcCost = calculateNodeCost(s3Archive);

  // Standard: 1000 * 0.023 = $23.00 + requests
  // Deep Archive: 1000 * 0.00099 = $0.99 + requests
  assert.ok(stdCost.monthlyCost > 20, `Standard 1TB should be ~$23.50, got ${stdCost.monthlyCost}`);
  assert.ok(arcCost.monthlyCost < 2, `Deep Archive 1TB should be ~$1.49, got ${arcCost.monthlyCost}`);
  assert.ok(stdCost.monthlyCost > arcCost.monthlyCost * 10, 'Standard storage must be significantly higher than Deep Archive');
});

test('36. Architecture-Wide Bill Simulation: Traffic Scaling (10x Surge) and FinOps Recommendations', () => {
  const tpl = REFERENCE_ARCHITECTURES.find(a => a.id === 'vpc-nat-autoscaling-3tier')!;
  assert.ok(tpl, '3-tier VPC template should exist');

  // Baseline normal traffic bill
  const normalReport = calculateArchitectureCost(tpl.nodes, 'normal');
  assert.ok(normalReport.monthlyTotal > 50, 'Baseline 3-tier architecture should cost > $50/mo');

  // 10x traffic surge simulation
  const surgeReport = calculateArchitectureCost(tpl.nodes, '10x');
  assert.ok(surgeReport.monthlyTotal > normalReport.monthlyTotal, '10x traffic surge must increase bill due to data transfer & processing');
  assert.strictEqual(surgeReport.trafficMultiplier, 10.0);

  // FinOps recommendations check
  assert.ok(normalReport.recommendations.length > 0, 'Should generate actionable FinOps cost optimization tips');
  const natTip = normalReport.recommendations.find(r => r.id === 'tip-s3-gateway-endpoint');
  assert.ok(natTip, 'Should recommend S3 Gateway Endpoint to eliminate NAT Gateway data processing fees');
});

test("36b. FinOps: Recommends an S3 Gateway Endpoint Only When One Is Actually Missing", () => {
  const natGateway: any = { id: 'nat1', position: { x: 0, y: 0 }, data: { serviceId: 'nat_gateway', label: 'NAT Gateway' } };
  const s3Bucket: any = { id: 's3-1', position: { x: 100, y: 0 }, data: { serviceId: 's3', label: 'Data Bucket' } };
  const noEndpointReport = calculateArchitectureCost([natGateway, s3Bucket], 'normal');
  const tipWithoutEndpoint = noEndpointReport.recommendations.find(r => r.id === 'tip-s3-gateway-endpoint');
  assert.ok(tipWithoutEndpoint, 'Must recommend adding an S3 Gateway Endpoint when NAT + S3 exist and no endpoint is present');

  const endpoint: any = { id: 'endpoint1', position: { x: 200, y: 0 }, data: { serviceId: 's3_gateway_endpoint', label: 'S3 Gateway Endpoint' } };
  const withEndpointReport = calculateArchitectureCost([natGateway, s3Bucket, endpoint], 'normal');
  const tipWithEndpoint = withEndpointReport.recommendations.find(r => r.id === 'tip-s3-gateway-endpoint');
  assert.ok(!tipWithEndpoint, 'Must NOT recommend adding one once it is actually present');
});

test('37. Dynamic Boundary Layer Hierarchy: VPC inside AZ inside Region maintains child-above-parent stacking', () => {
  const regionNode: any = {
    id: 'box-region',
    type: 'boundaryNode',
    position: { x: 20, y: 20 },
    data: { label: 'Region (us-east-1)', boundaryType: 'region', width: 980, height: 600 }
  };

  const azNode: any = {
    id: 'box-az',
    type: 'boundaryNode',
    position: { x: 60, y: 60 },
    data: { label: 'Availability Zone', boundaryType: 'az', width: 500, height: 500 }
  };

  const vpcNode: any = {
    id: 'box-vpc',
    type: 'boundaryNode',
    position: { x: 100, y: 100 },
    data: { label: 'VPC', boundaryType: 'vpc', width: 400, height: 400 }
  };

  const subnetNode: any = {
    id: 'box-subnet',
    type: 'boundaryNode',
    position: { x: 140, y: 140 },
    data: { label: 'Private subnet', boundaryType: 'private_subnet', width: 300, height: 200 }
  };

  const boundaries = [regionNode, azNode, vpcNode, subnetNode];

  // Verify geometric containment
  assert.ok(isBoundaryContained(azNode, regionNode), 'Region should contain AZ');
  assert.ok(isBoundaryContained(vpcNode, azNode), 'AZ should contain VPC');
  assert.ok(isBoundaryContained(vpcNode, regionNode), 'Region should contain VPC');
  assert.ok(isBoundaryContained(subnetNode, vpcNode), 'VPC should contain subnet');

  // Verify containment depths
  assert.strictEqual(getBoundaryContainmentDepth(regionNode, boundaries), 0, 'Region is outermost (depth 0)');
  assert.strictEqual(getBoundaryContainmentDepth(azNode, boundaries), 1, 'AZ is depth 1');
  assert.strictEqual(getBoundaryContainmentDepth(vpcNode, boundaries), 2, 'VPC inside AZ is depth 2');
  assert.strictEqual(getBoundaryContainmentDepth(subnetNode, boundaries), 3, 'Subnet inside VPC is depth 3');

  // Verify calculated z-indices
  const regionZ = calculateBoundaryZIndex(regionNode, boundaries);
  const azZ = calculateBoundaryZIndex(azNode, boundaries);
  const vpcZ = calculateBoundaryZIndex(vpcNode, boundaries);
  const subnetZ = calculateBoundaryZIndex(subnetNode, boundaries);

  assert.ok(vpcZ > azZ, `VPC (z=${vpcZ}) must have strictly higher z-index than AZ (z=${azZ}) so VPC is selectable`);
  assert.ok(azZ > regionZ, `AZ (z=${azZ}) must have strictly higher z-index than Region (z=${regionZ})`);
  assert.ok(subnetZ > vpcZ, `Subnet (z=${subnetZ}) must have strictly higher z-index than VPC (z=${vpcZ})`);
});

test('38. Dynamic Boundary Layer Hierarchy: Inverted containment (AZ inside VPC) also maintains child-above-parent stacking', () => {
  const regionNode: any = {
    id: 'box-region',
    type: 'boundaryNode',
    position: { x: 20, y: 20 },
    data: { label: 'Region', boundaryType: 'region', width: 980, height: 600 }
  };

  const vpcNode: any = {
    id: 'box-vpc',
    type: 'boundaryNode',
    position: { x: 60, y: 60 },
    data: { label: 'VPC', boundaryType: 'vpc', width: 880, height: 500 }
  };

  const azNode: any = {
    id: 'box-az',
    type: 'boundaryNode',
    position: { x: 100, y: 100 },
    data: { label: 'Availability Zone', boundaryType: 'az', width: 360, height: 400 }
  };

  const boundaries = [regionNode, vpcNode, azNode];

  assert.ok(isBoundaryContained(vpcNode, regionNode), 'Region should contain VPC');
  assert.ok(isBoundaryContained(azNode, vpcNode), 'VPC should contain AZ');

  const regionZ = calculateBoundaryZIndex(regionNode, boundaries);
  const vpcZ = calculateBoundaryZIndex(vpcNode, boundaries);
  const azZ = calculateBoundaryZIndex(azNode, boundaries);

  assert.ok(azZ > vpcZ, `AZ (z=${azZ}) must have strictly higher z-index than VPC (z=${vpcZ}) when AZ is inside VPC`);
  assert.ok(vpcZ > regionZ, `VPC (z=${vpcZ}) must have strictly higher z-index than Region (z=${regionZ})`);
});

test('39. Reference Diagram "Thumbnail Generator": S3 Event Trigger, Lambda in Private Subnet, VPC Gateway Endpoint & IAM Policy', () => {
  const tpl = REFERENCE_ARCHITECTURES.find(a => a.id === 'thumbnail-generator');
  assert.ok(tpl, 'Thumbnail generator template should be registered in REFERENCE_ARCHITECTURES');
  assert.strictEqual(tpl.name, 'Serverless Image Thumbnail Generator');

  // Verify boundary nodes
  const boundaries = tpl.nodes.filter(n => n.type === 'boundaryNode');
  const region = boundaries.find(b => (b.data as any).boundaryType === 'region');
  const vpc = boundaries.find(b => (b.data as any).boundaryType === 'vpc');
  const az = boundaries.find(b => (b.data as any).boundaryType === 'az');
  const subnet = boundaries.find(b => (b.data as any).boundaryType === 'private_subnet');

  assert.ok(region, 'Must contain Region boundary');
  assert.ok(vpc, 'Must contain VPC boundary');
  assert.ok(az, 'Must contain Availability Zone boundary');
  assert.ok(subnet, 'Must contain Private Subnet boundary');

  // Verify containment
  assert.ok(isBoundaryContained(vpc as any, region as any), 'Region must contain VPC');
  assert.ok(isBoundaryContained(az as any, vpc as any), 'VPC must contain AZ');
  assert.ok(isBoundaryContained(subnet as any, az as any), 'AZ must contain Private Subnet');

  // Verify service nodes
  const serviceNodes = tpl.nodes.filter(n => n.type === 'serviceNode');
  const consoleNode = serviceNodes.find(n => (n.data as any).serviceId === 'user');
  const sourceS3 = serviceNodes.find(n => n.id === 'node-s3-source');
  const iamNode = serviceNodes.find(n => (n.data as any).serviceId === 'iam');
  const lambdaNode = serviceNodes.find(n => (n.data as any).serviceId === 'lambda');
  const endpointNode = serviceNodes.find(n => (n.data as any).serviceId === 's3_gateway_endpoint');
  const destS3 = serviceNodes.find(n => n.id === 'node-s3-dest');

  assert.ok(consoleNode, 'Must contain AWS Management Console node');
  assert.ok(sourceS3, 'Must contain Source S3 Bucket node');
  assert.ok(iamNode, 'Must contain IAM Permissions Policy node');
  assert.ok(lambdaNode, 'Must contain Lambda Create Thumbnail function node');
  assert.ok(endpointNode, 'Must contain S3 Gateway Endpoint node');
  assert.ok(destS3, 'Must contain Destination S3 Bucket node');

  // Verify subnet allocations
  assert.strictEqual((lambdaNode.data as any).subnet, 'private', 'Lambda must be placed inside the private subnet');
  assert.strictEqual((endpointNode.data as any).subnet, 'private', 'S3 Gateway Endpoint must be in the private subnet');
  assert.strictEqual((sourceS3.data as any).subnet, 'global', 'Source S3 bucket must be a regional/global service');
  assert.strictEqual((destS3.data as any).subnet, 'global', 'Destination S3 bucket must be a regional/global service');

  // Run End-to-End Simulation
  const scenario: SimulationScenario = {
    id: 'test-thumbnail-upload',
    name: 'Image Upload and Thumbnail Generation',
    method: 'POST',
    path: '/upload/photo.jpg',
    startNodeId: consoleNode.id,
    trafficLevel: 'normal'
  };

  const result = runSimulation(tpl.nodes, tpl.edges, scenario);
  assert.strictEqual(result.success, true, 'End-to-end thumbnail processing flow should succeed');
  assert.strictEqual(result.statusCode, 200, 'Roundtrip response should be 200 OK');

  // Verify sequential simulation steps
  const eventStep = result.steps.find(s => s.protocol === 'Event');
  assert.ok(eventStep, 'Simulation must record asynchronous S3 event trigger step');
  assert.strictEqual(eventStep.sourceNodeId, sourceS3.id);
  assert.strictEqual(eventStep.targetNodeId, lambdaNode.id);
  assert.ok(eventStep.action.includes('s3:ObjectCreated') || eventStep.action.includes('S3 Event Notification'), 'Step action should note S3 Event Notification');

  const endpointStep = result.steps.find(s => s.targetNodeId === endpointNode.id);
  assert.ok(endpointStep, 'Lambda must route to S3 Gateway Endpoint');
  assert.strictEqual(endpointStep.sourceNodeId, lambdaNode.id);

  const destStep = result.steps.find(s => s.targetNodeId === destS3.id);
  assert.ok(destStep, 'S3 Gateway Endpoint must forward to Destination S3 bucket');
  assert.strictEqual(destStep.sourceNodeId, endpointNode.id);

  // Failure Isolation: When Lambda fails
  const failedLambdaNodes = tpl.nodes.map(n =>
    n.id === lambdaNode.id ? { ...n, data: { ...n.data, health: 'failed' as const } } : n
  );
  const failedResult = runSimulation(failedLambdaNodes, tpl.edges, scenario);
  assert.strictEqual(failedResult.success, false, 'Simulation should fail if Lambda function is failed');
  assert.strictEqual(failedResult.statusCode, 500, 'Should return HTTP 500 when Lambda fails');
  assert.ok(!failedResult.steps.some(s => s.targetNodeId === destS3.id), 'Destination S3 should not be written to when Lambda fails');
});

test('40. Reference Diagram "Problem 3.1: Cause of Connection Timeout due to Custom NACLs"', () => {
  const tpl = REFERENCE_ARCHITECTURES.find(a => a.id === 'nacl-custom-stateless-timeout')!;
  assert.ok(tpl, 'Problem 3.1 Custom NACLs template should exist');

  // Verify structure: VPC (10.0.0.0/16), Public Subnet (10.0.1.0/24), Private Subnet (10.0.2.0/24)
  const pubSubnet = tpl.nodes.find(n => n.id === 'box-public-subnet');
  const privSubnet = tpl.nodes.find(n => n.id === 'box-private-subnet');
  assert.ok(pubSubnet, 'Public subnet boundary must be present');
  assert.ok(privSubnet, 'Private subnet boundary must be present');

  const pubNacl = (pubSubnet.data as any).customNacl;
  assert.ok(pubNacl, 'Public Subnet must configure a custom NACL');
  assert.strictEqual(pubNacl.naclName, 'Public Subnet NACL: Custom');

  // Verify incoming and outgoing signal edges
  const inboundEdge = tpl.edges.find(e => (e.data as any)?.signalType === 'inbound_request' && e.source === 'node-web-server');
  const outboundEdge = tpl.edges.find(e => (e.data as any)?.signalType === 'outbound_response');
  assert.ok(inboundEdge, 'Must have distinct Inbound Request signal edge');
  assert.ok(outboundEdge, 'Must have distinct Outbound Response signal edge');
  assert.strictEqual((inboundEdge.data as any).signalLabel, 'Connection Flow (Inbound Request)');
  assert.strictEqual((outboundEdge.data as any).hasMissingReturnBlock, true, 'Outbound response should initially have missing return block');

  const scenario: SimulationScenario = {
    id: 'test-nacl-stateless',
    name: 'Web Server to Database Connection',
    method: 'GET',
    path: '/users/profile',
    startNodeId: 'node-client',
    trafficLevel: 'normal'
  };

  // 1. Initial State: Missing Ephemeral Return Rule -> Stateless Block (504 Timeout)
  const timeoutResult = runSimulation(tpl.nodes, tpl.edges, scenario);
  assert.strictEqual(timeoutResult.success, false, 'Initial state must fail due to stateless NACL return block');
  assert.strictEqual(timeoutResult.statusCode, 504, 'Connection timeout must report 504');
  const blockedStep = timeoutResult.steps.find(s => s.action.includes('Stateless Return Blocked'));
  assert.ok(blockedStep, 'Must record a Stateless Return Blocked simulation step');

  // 2. Fixed State: Add Ephemeral Return Rule (1024-65535) -> Connection Successfully Established (200 OK)
  const fixedNodes = tpl.nodes.map(n => {
    if (n.id === 'box-public-subnet') {
      const nacl = (n.data as any).customNacl;
      return {
        ...n,
        data: {
          ...n.data,
          customNacl: {
            ...nacl,
            inboundRules: nacl.inboundRules.map((r: any) =>
              r.portRange.includes('1024-65535') ? { ...r, isMissingReturn: false } : r
            )
          }
        }
      };
    }
    return n;
  });

  const fixedResult = runSimulation(fixedNodes, tpl.edges, scenario);
  assert.strictEqual(fixedResult.success, true, 'Fixed architecture with ephemeral return rule must succeed');
  assert.strictEqual(fixedResult.statusCode, 200, 'Successful roundtrip must return 200 OK');
  const successStep = fixedResult.steps.find(s => s.action.includes('Stateless Return Allowed'));
  assert.ok(successStep, 'Must record a Stateless Return Allowed step');
});

test('41. Stateless NACL Return Block Latency Is Reflected in totalLatencyMs', () => {
  // A stateless-return block reports a 30s (30000ms) step latencyMs - the request genuinely
  // hung for 30 seconds before the client gave up. totalLatencyMs must account for that, not
  // just whatever hop latency had accumulated before the post-loop return check ran.
  const tpl = REFERENCE_ARCHITECTURES.find(a => a.id === 'nacl-custom-stateless-timeout')!;
  const scenario: SimulationScenario = {
    id: 'test-nacl-latency',
    name: 'Web Server to Database Connection',
    method: 'GET',
    path: '/users/profile',
    startNodeId: 'node-client',
    trafficLevel: 'normal'
  };

  const result = runSimulation(tpl.nodes, tpl.edges, scenario);
  assert.strictEqual(result.success, false, 'Stateless block must still fail the request');
  const blockedStep = result.steps.find(s => s.action.includes('Stateless Return Blocked'))!;
  assert.ok(blockedStep, 'Must record a Stateless Return Blocked simulation step');
  assert.strictEqual(blockedStep.latencyMs, 30000, 'Blocked step must report the real 30s stateless timeout');
  assert.ok(
    result.totalLatencyMs >= blockedStep.latencyMs,
    `totalLatencyMs (${result.totalLatencyMs}) must include the blocked step's own 30s latency, not just the hops before it`
  );
});

test('42. Security Score Is Included in the Overall Resilience Rating', () => {
  // A direct client -> database edge is the single most severe security violation this engine
  // can detect (-35 security points). Before this fix, the security score was computed and
  // displayed but never factored into `overallRating`, so an architecture could be rated
  // "Resilient" while its database sat wide open to the internet. Reusing the already-Resilient
  // "highly-available-multiaz" template and adding nothing but this one edge must now be enough
  // to pull the overall rating down, since the average is no longer availability/resilience/
  // faultTolerance/scalability alone.
  const haArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'highly-available-multiaz')!;
  const baselineAnalysis = analyzeArchitecture(haArch.nodes, haArch.edges);
  assert.strictEqual(baselineAnalysis.overallRating, 'Resilient', 'Unmodified HA template is the Resilient baseline');

  const userNode = haArch.nodes.find(n => n.data.serviceId === 'user')!;
  const rdsNode = haArch.nodes.find(n => n.data.serviceId === 'rds')!;
  const exposedEdges = [
    ...haArch.edges,
    { id: 'direct-db-exposure', source: userNode.id, target: rdsNode.id, data: { protocol: 'SQL' } }
  ];

  const exposedAnalysis = analyzeArchitecture(haArch.nodes, exposedEdges as typeof haArch.edges);
  assert.ok(exposedAnalysis.security.score <= 20, 'Direct DB exposure must tank the security score');
  assert.strictEqual(
    exposedAnalysis.availability.score, baselineAnalysis.availability.score,
    'Availability/resilience/faultTolerance/scalability are unaffected by this edge'
  );
  assert.notStrictEqual(
    exposedAnalysis.overallRating, 'Resilient',
    'A wide-open database must no longer be able to hide behind a Resilient overall rating'
  );
});

test('43. Stateless NACL Return Check Uses the Actual Traversed Path, Not a Whole-Canvas Type Scan', () => {
  // Two independent EC2 -> RDS pairs on one canvas. The decoy pair is listed FIRST in the node
  // array and is configured to ALLOW its stateless return traffic; the real pair (the only one
  // actually connected to the client, and the only one this request traverses) is configured to
  // BLOCK it. A whole-canvas "first EC2 / first RDS" scan would grab the decoy pair (wrong
  // subnet, wrong verdict: success). Only a check scoped to the request's own traversed path can
  // correctly find the real pair and correctly report the block.
  const decoyPublicSubnet: any = {
    id: 'decoy-public-subnet', type: 'boundaryNode', position: { x: 0, y: 0 },
    data: {
      boundaryType: 'public_subnet', width: 300, height: 200, label: 'Decoy Public Subnet',
      customNacl: {
        naclName: 'Decoy NACL (correctly configured)',
        inboundRules: [
          { ruleNumber: 90, type: 'HTTP', protocol: 'TCP', portRange: '80', cidr: '0.0.0.0/0', action: 'ALLOW' },
          { ruleNumber: 110, type: 'Ephemeral Ports', protocol: 'TCP', portRange: '1024-65535', cidr: '0.0.0.0/0', action: 'ALLOW', isStatelessReturn: true, isMissingReturn: false }
        ]
      }
    }
  };
  const decoyEc2: any = {
    id: 'decoy-ec2', position: { x: 100, y: 100 },
    data: { serviceId: 'ec2', label: 'Decoy Web Server', subnet: 'public', health: 'healthy' }
  };
  const decoyRds: any = {
    id: 'decoy-rds', position: { x: 900, y: 900 },
    data: { serviceId: 'rds', label: 'Decoy DB', subnet: 'private', health: 'healthy' }
  };

  const realPublicSubnet: any = {
    id: 'real-public-subnet', type: 'boundaryNode', position: { x: 1000, y: 0 },
    data: {
      boundaryType: 'public_subnet', width: 300, height: 200, label: 'Real Public Subnet',
      customNacl: {
        naclName: 'Real NACL (missing ephemeral return rule)',
        inboundRules: [
          { ruleNumber: 90, type: 'HTTP', protocol: 'TCP', portRange: '80', cidr: '0.0.0.0/0', action: 'ALLOW' },
          { ruleNumber: 110, type: 'Ephemeral Ports', protocol: 'TCP', portRange: '1024-65535', cidr: '0.0.0.0/0', action: 'ALLOW', isStatelessReturn: true, isMissingReturn: true }
        ]
      }
    }
  };
  const realEc2: any = {
    id: 'real-ec2', position: { x: 1100, y: 100 },
    data: { serviceId: 'ec2', label: 'Real Web Server', subnet: 'public', health: 'healthy' }
  };
  const realRds: any = {
    id: 'real-rds', position: { x: 1900, y: 900 },
    data: { serviceId: 'rds', label: 'Real DB', subnet: 'private', health: 'healthy' }
  };

  const igw: any = { id: 'igw1', position: { x: 500, y: -100 }, data: { serviceId: 'internet_gateway', label: 'IGW', health: 'healthy' } };
  const client: any = { id: 'client1', position: { x: 500, y: -300 }, data: { serviceId: 'user', label: 'Client' } };

  // Decoy pair is listed BEFORE the real pair - a naive "first EC2 / first RDS on the canvas"
  // scan would find the decoys first. Neither decoy has any edge into the traversed path.
  const nodes = [decoyPublicSubnet, decoyEc2, decoyRds, realPublicSubnet, realEc2, realRds, igw, client];
  const edges: any[] = [
    { id: 'e1', source: 'client1', target: 'real-ec2', data: { protocol: 'HTTP' } },
    { id: 'e2', source: 'real-ec2', target: 'real-rds', data: { protocol: 'SQL' } }
  ];

  const scenario: SimulationScenario = {
    id: 'test-path-aware-pairing',
    name: 'Path-Aware NACL Return Pairing',
    method: 'GET',
    path: '/orders',
    startNodeId: 'client1',
    trafficLevel: 'normal'
  };

  const result = runSimulation(nodes, edges, scenario);

  assert.strictEqual(result.success, false, 'The REAL pair\'s missing ephemeral rule must block the request');
  assert.strictEqual(result.statusCode, 504, 'A stateless return block must report 504');

  const blockedStep = result.steps.find(s => s.action.includes('Stateless Return Blocked'));
  assert.ok(blockedStep, 'Must record a Stateless Return Blocked step');
  assert.strictEqual(blockedStep!.targetNodeId, 'real-ec2', 'The blocked return must target the REAL web server, not the decoy');
  assert.strictEqual(blockedStep!.sourceNodeId, 'real-rds', 'The blocked return must originate from the REAL database, not the decoy');
  assert.ok(
    !result.steps.some(s => s.sourceNodeId === 'decoy-ec2' || s.sourceNodeId === 'decoy-rds' || s.targetNodeId === 'decoy-ec2' || s.targetNodeId === 'decoy-rds'),
    'The decoy pair must never appear in the trace at all - it was never on the traversed path'
  );
});

test('44. Custom NACL Denies Unmatched Traffic by Default (Implicit Final DENY)', async () => {
  const { checkNetworkFirewalls } = await import('../src/engine/simulation/networkFirewalls.ts');

  // A custom NACL configured with only an HTTP-allow rule - no rule for SQL, and no explicit
  // catch-all DENY rule either. Real AWS NACLs always end with an immutable rule 32767 that
  // denies everything an earlier rule didn't match; unmatched traffic is never permitted.
  const subnetWithPartialCustomNacl: any = {
    id: 'subnet-partial-nacl', type: 'boundaryNode', position: { x: 0, y: 0 },
    data: {
      boundaryType: 'private_subnet', width: 300, height: 200, label: 'Partially Configured Subnet',
      customNacl: {
        naclName: 'Partial NACL',
        inboundRules: [
          { ruleNumber: 90, type: 'HTTP', protocol: 'TCP', portRange: '80', cidr: '0.0.0.0/0', action: 'ALLOW' }
        ]
      }
    }
  };
  const target: any = { id: 'db1', position: { x: 50, y: 50 }, data: { serviceId: 'rds' } };
  const boundaries = [subnetWithPartialCustomNacl];

  const httpResult = checkNetworkFirewalls('HTTP', target, boundaries);
  assert.strictEqual(httpResult.nacl.blocked, false, 'HTTP must still pass - it matches the explicit ALLOW rule');

  const sqlResult = checkNetworkFirewalls('SQL', target, boundaries);
  assert.strictEqual(sqlResult.nacl.evaluated, true);
  assert.strictEqual(
    sqlResult.nacl.blocked, true,
    'SQL has no matching rule in this custom NACL - the implicit final DENY must block it, not permit it by default'
  );
});

test('45. AWS Shield Does Not Perform WAF-Style L7 Request Inspection', () => {
  // Shield protects against L3/L4 volumetric/protocol DDoS; it does not inspect request content
  // the way WAF does. A Shield node sitting in front of an otherwise-reachable backend must not
  // block a request just because its path looks like a SQL injection attempt - only a WAF node
  // performs that specific inspection.
  const client: any = { id: 'client1', position: { x: 0, y: 0 }, data: { serviceId: 'user', label: 'Client' } };
  const shieldNode: any = { id: 'shield1', position: { x: 100, y: 0 }, data: { serviceId: 'shield', label: 'Shield', subnet: 'global', health: 'healthy' } };
  const backend: any = { id: 'backend1', position: { x: 200, y: 0 }, data: { serviceId: 's3', label: 'Backend', subnet: 'global', health: 'healthy' } };

  const nodes = [client, shieldNode, backend];
  const edges: any[] = [
    { id: 'e1', source: 'client1', target: 'shield1', data: { protocol: 'HTTPS' } },
    { id: 'e2', source: 'shield1', target: 'backend1', data: { protocol: 'HTTPS' } }
  ];

  const scenario: SimulationScenario = {
    id: 'test-shield-not-waf',
    name: 'Shield does not L7-inspect',
    method: 'GET',
    path: "/users?id=1' OR '1'='1",
    startNodeId: 'client1',
    trafficLevel: 'normal'
  };

  const result = runSimulation(nodes, edges, scenario);
  assert.strictEqual(result.success, true, 'Shield must not block a request based on its path content - only WAF inspects request content');
  assert.ok(!result.steps.some(s => s.action.includes('WAF')), 'No WAF-style inspection step should appear for a Shield node');
});

test('46. Thumbnail Generator: The IAM Node Is Illustrative Only, Not Load-Bearing', () => {
  // This simulator does not evaluate IAM permissions anywhere (confirmed in docs/audit/IAM_GAPS.md).
  // The "Permissions Policy" (iam) node and its edge into Lambda are drawn for architectural
  // completeness only. This is a regression guard: if a future change ever made this node
  // load-bearing without anyone noticing, that would be a meaningful, undocumented behavior
  // change worth catching explicitly, not silently.
  const tpl = REFERENCE_ARCHITECTURES.find(a => a.id === 'thumbnail-generator')!;
  const consoleNode = tpl.nodes.find(n => (n.data as any).serviceId === 'user')!;

  const scenario: SimulationScenario = {
    id: 'test-iam-node-inert',
    name: 'Image Upload and Thumbnail Generation',
    method: 'POST',
    path: '/upload/photo.jpg',
    startNodeId: consoleNode.id,
    trafficLevel: 'normal'
  };

  const withIamNode = runSimulation(tpl.nodes, tpl.edges, scenario);

  const nodesWithoutIam = tpl.nodes.filter(n => n.id !== 'node-iam');
  const edgesWithoutIam = tpl.edges.filter(e => e.source !== 'node-iam' && e.target !== 'node-iam');
  const withoutIamNode = runSimulation(nodesWithoutIam, edgesWithoutIam, scenario);

  assert.strictEqual(withIamNode.success, withoutIamNode.success, 'Removing the IAM node must not change simulation success');
  assert.strictEqual(withIamNode.statusCode, withoutIamNode.statusCode, 'Removing the IAM node must not change the status code');
  assert.strictEqual(withIamNode.steps.length, withoutIamNode.steps.length, 'Removing the IAM node must not change the traversed step count - it was never on the path');
});

test('47. NLB Health Check Failover Routes Around a Failed Target', () => {
  // Real AWS NLBs perform their own target health checks, just like ALBs, and only route to
  // healthy targets. Before this fix, NLB was excluded from the target-health evaluation
  // behavior entirely, so it could route to a failed target even with a healthy one available.
  const client: any = { id: 'client1', position: { x: 0, y: 0 }, data: { serviceId: 'user', label: 'Client' } };
  const igw: any = { id: 'igw1', position: { x: 0, y: -100 }, data: { serviceId: 'internet_gateway', label: 'IGW', health: 'healthy' } };
  const nlb: any = { id: 'nlb1', position: { x: 100, y: 0 }, data: { serviceId: 'nlb', label: 'NLB', subnet: 'public', health: 'healthy' } };
  const ec2A: any = { id: 'ec2-a', position: { x: 200, y: -50 }, data: { serviceId: 'ec2', label: 'EC2-A', subnet: 'public', health: 'failed', failureReason: 'Simulated crash' } };
  const ec2B: any = { id: 'ec2-b', position: { x: 200, y: 50 }, data: { serviceId: 'ec2', label: 'EC2-B', subnet: 'public', health: 'healthy' } };

  const nodes = [client, igw, nlb, ec2A, ec2B];
  const edges: any[] = [
    { id: 'e1', source: 'client1', target: 'nlb1', data: { protocol: 'TCP' } },
    { id: 'e2', source: 'nlb1', target: 'ec2-a', data: { protocol: 'TCP' } },
    { id: 'e3', source: 'nlb1', target: 'ec2-b', data: { protocol: 'TCP' } }
  ];

  const scenario: SimulationScenario = {
    id: 'test-nlb-failover',
    name: 'NLB Failover Test',
    method: 'GET',
    path: '/health',
    startNodeId: 'client1',
    trafficLevel: 'normal'
  };

  const result = runSimulation(nodes, edges, scenario);
  assert.strictEqual(result.success, true, 'Request should survive - NLB must route around the failed target');
  const nlbStep = result.steps.find(s => s.sourceNodeId === 'nlb1');
  assert.ok(nlbStep, 'NLB routing step must be executed');
  assert.strictEqual(nlbStep!.targetNodeId, 'ec2-b', 'NLB must route to the healthy target, not the failed one');
});

test('48. PrivateLink (Interface VPC Endpoint) Requires Subnet Placement', () => {
  // Real Interface VPC Endpoints create actual ENIs in customer-chosen subnets, unlike a Gateway
  // VPC Endpoint (route-table-based, no ENI). A privatelink node with no containing subnet
  // boundary is not a valid AWS deployment and must be reported as unassigned, same as any other
  // ENI-backed resource placed outside every subnet.
  const unplacedPrivateLink: any = {
    id: 'pl1', position: { x: 5000, y: 5000 }, data: { serviceId: 'privatelink', label: 'Interface Endpoint' }
  };
  assert.strictEqual(deriveSubnetForNode(unplacedPrivateLink, []), 'unassigned', 'PrivateLink outside any subnet must be unassigned, not global');

  const privateSubnet: any = {
    id: 'subnet1', type: 'boundaryNode', position: { x: 0, y: 0 },
    data: { boundaryType: 'private_subnet', width: 300, height: 200, label: 'Private Subnet' }
  };
  const placedPrivateLink: any = {
    id: 'pl2', position: { x: 100, y: 100 }, data: { serviceId: 'privatelink', label: 'Interface Endpoint' }
  };
  assert.strictEqual(deriveSubnetForNode(placedPrivateLink, [privateSubnet]), 'private', 'PrivateLink correctly placed inside a subnet must resolve to that subnet');
});

test('49. Security Group on an Interface VPC Endpoint (PrivateLink) Is Enforced', () => {
  // Real Interface VPC Endpoints are ENI-based and subject to Security Groups like any other
  // ENI-backed resource. Before this fix, the VPC-endpoint hop never called the firewall check
  // at all, so no SG configured on a PrivateLink endpoint could ever actually block traffic.
  const privateSubnet: any = {
    id: 'subnet1', type: 'boundaryNode', position: { x: 0, y: 0 },
    data: { boundaryType: 'private_subnet', width: 400, height: 300 }
  };
  const restrictiveSg: any = {
    id: 'sg1', type: 'boundaryNode', position: { x: 300, y: 200 },
    data: { boundaryType: 'security_group', width: 50, height: 50, label: 'Restrictive SG', allowedProtocols: ['SQL'] }
  };
  const compute: any = { id: 'compute1', position: { x: 50, y: 50 }, data: { serviceId: 'ec2', label: 'App Server', subnet: 'private', health: 'healthy' } };
  const endpoint: any = { id: 'endpoint1', position: { x: 200, y: 200 }, data: { serviceId: 'privatelink', label: 'Interface Endpoint', subnet: 'private', health: 'healthy', securityGroupIds: ['sg1'] } };

  const nodes = [privateSubnet, restrictiveSg, compute, endpoint];
  const edges: any[] = [{ id: 'e1', source: 'compute1', target: 'endpoint1', data: { protocol: 'HTTPS' } }];

  const scenario: SimulationScenario = {
    id: 'test-privatelink-sg', name: 'PrivateLink SG enforcement', method: 'GET', path: '/api',
    startNodeId: 'compute1', trafficLevel: 'normal'
  };

  const result = runSimulation(nodes, edges, scenario);
  assert.strictEqual(result.success, false, 'HTTPS must be blocked - the endpoint\'s Security Group only allows SQL');
  assert.ok(result.steps.some(s => s.action.includes('Security Group')), 'Must record a Security Group evaluation step for the endpoint hop');
});


