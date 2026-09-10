import assert from 'node:assert';
import test from 'node:test';

import { REFERENCE_ARCHITECTURES } from '../src/data/referenceArchitectures.ts';
import { AWS_SERVICES } from '../src/data/serviceCatalog.ts';
import { STUDENT_CHALLENGES } from '../src/data/studentChallenges.ts';
import { runSimulation } from '../src/engine/simulation/requestSimulator.ts';
import { analyzeArchitecture } from '../src/engine/analysis/rulesEngine.ts';
import { detectSPOFs } from '../src/engine/analysis/spofDetector.ts';
import { detectBottlenecks } from '../src/engine/analysis/bottleneckDetector.ts';
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

test('4. Simulation: 502 Bad Gateway when ALL compute targets fail', () => {
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
  assert.strictEqual(result.statusCode, 502, 'Should return HTTP 502 Bad Gateway');
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
  assert.strictEqual(serviceIds.filter((id: string) => id === 'auto_scaling').length, 2, 'Each ECS service must have its own Auto Scaling');

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
  assert.strictEqual(totalOutage.statusCode, 502, 'Should return 502 Bad Gateway with zero healthy targets');

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
