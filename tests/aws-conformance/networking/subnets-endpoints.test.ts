import { runConformanceCases, type ConformanceCase } from '../harness.ts';
import { runSimulation } from '../../../src/engine/simulation/requestSimulator.ts';
import { REFERENCE_ARCHITECTURES } from '../../../src/data/referenceArchitectures.ts';
import type { SimulationScenario } from '../../../src/types/index.ts';

interface Result { success: boolean; statusCode: number }

const haArch = REFERENCE_ARCHITECTURES.find(a => a.id === 'highly-available-multiaz')!;
const scenario = (startNodeId: string): SimulationScenario => ({
  id: 's', name: 'GET', method: 'GET', path: '/', startNodeId, trafficLevel: 'normal'
});

const CASES: ConformanceCase<Result>[] = [
  {
    id: 'NET-SUBNET-001',
    awsBehavior: 'A "public" subnet is public only because its route table sends 0.0.0.0/0 to an attached Internet Gateway - it is not a magic property of the subnet itself.',
    reference: 'Amazon VPC User Guide - "VPCs and subnets": public and private subnets are a routing concept',
    scenario: 'A resource sits in a subnet marked "public", but the VPC has no Internet Gateway attached at all.',
    configuration: { subnetType: 'public', internetGateway: 'absent' },
    request: { source: 'client', destination: 'ALB in public subnet' },
    expected: { success: false, statusCode: 504 },
    run: () => {
      // A public-origin client connecting DIRECTLY to a VPC-hosted public-subnet ALB, with no
      // Internet Gateway node anywhere on the canvas - the exact condition the "public subnet is
      // a routing consequence, not a label" rule is about.
      const user = { id: 'n-user', type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId: 'user', label: 'Client', category: 'Client / Ingress', health: 'healthy', az: 'Edge / Global', subnet: 'global', replicas: 1, multiAz: false } };
      const alb = { id: 'n-alb', type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId: 'alb', label: 'ALB', category: 'Load Balancing', health: 'healthy', az: 'Multi-AZ', subnet: 'public', replicas: 1, multiAz: true } };
      const edge = { id: 'e1', source: 'n-user', target: 'n-alb', type: 'custom', data: { protocol: 'HTTPS', interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 } };
      const result = runSimulation([user, alb] as any, [edge] as any, scenario('n-user'));
      return { success: result.success, statusCode: result.statusCode };
    },
    explain: (actual) => actual.statusCode === 504
      ? 'The simulator correctly treats "public subnet" as dependent on a real Internet Gateway attachment, not just a label - removing the IGW breaks reachability even though the subnet is still marked public.'
      : `Got status ${actual.statusCode} - a "public" subnet with no Internet Gateway should have no path to/from the internet at all.`
  },
  {
    id: 'NET-SUBNET-002',
    awsBehavior: 'Private-subnet instances cannot accept unsolicited inbound connections directly from the public internet - inbound must be mediated by a public-subnet load balancer or API Gateway.',
    reference: 'Amazon VPC User Guide - "VPCs and subnets": private subnets have no route from the Internet Gateway',
    scenario: 'A client attempts to connect directly to a compute instance sitting in a private subnet, bypassing any load balancer.',
    configuration: { targetSubnet: 'private', path: 'client -> private EC2 directly' },
    request: { source: 'client', destination: 'private EC2' },
    expected: { success: false, statusCode: 403 },
    run: () => {
      const user = haArch.nodes.find((n: any) => n.data?.serviceId === 'user')!;
      const privateEcs = haArch.nodes.find((n: any) => n.id === 'node-ecs-az-a')!;
      const directEdge = { id: 'e-direct', source: user.id, target: privateEcs.id, type: 'custom', data: { protocol: 'HTTP', interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 } };
      const result = runSimulation(haArch.nodes as any, [directEdge as any], scenario(user.id));
      return { success: result.success, statusCode: result.statusCode };
    },
    explain: (actual) => actual.statusCode === 403
      ? 'The simulator correctly blocks unsolicited direct public ingress into a private subnet.'
      : `Got status ${actual.statusCode} - AWS has no route from the public internet directly into a private subnet.`
  },
  {
    id: 'NET-ENDPOINT-001',
    awsBehavior: 'A VPC Gateway Endpoint (for S3/DynamoDB) lets a private-subnet resource reach that specific AWS service over the AWS backbone, with no NAT Gateway or internet path required.',
    reference: 'Amazon VPC User Guide - "Gateway endpoints"',
    scenario: 'A private EC2 instance reaches an S3 bucket via a VPC Gateway Endpoint, with no NAT Gateway present in the architecture.',
    configuration: { natGateway: 'absent', vpcEndpoint: 's3_gateway_endpoint' },
    request: { source: 'private EC2', destination: 'S3 bucket' },
    expected: { success: true, statusCode: 200 },
    run: () => {
      const ec2 = { id: 'n-ec2', type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId: 'ec2', label: 'Private EC2', category: 'Compute', health: 'healthy', az: 'AZ-A', subnet: 'private', replicas: 1, multiAz: false } };
      const endpoint = { id: 'n-endpoint', type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId: 's3_gateway_endpoint', label: 'S3 Gateway Endpoint', category: 'Networking & Content Delivery', health: 'healthy', az: 'Edge / Global', subnet: 'private', replicas: 1, multiAz: false } };
      const s3 = { id: 'n-s3', type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId: 's3', label: 'S3 Bucket', category: 'Storage', health: 'healthy', az: 'Edge / Global', subnet: 'global', replicas: 1, multiAz: false } };
      const edge = { id: 'e1', source: 'n-ec2', target: 'n-s3', type: 'custom', data: { protocol: 'HTTPS', interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 } };
      const result = runSimulation([ec2, endpoint, s3] as any, [edge] as any, scenario('n-ec2'));
      return { success: result.success, statusCode: result.statusCode };
    },
    explain: (actual) => actual.success
      ? 'The simulator correctly routes private-subnet-to-S3 traffic through the VPC Gateway Endpoint without requiring a NAT Gateway.'
      : `Request failed (status ${actual.statusCode}) - a Gateway Endpoint should provide a complete path to S3/DynamoDB with no NAT Gateway needed.`
  },
  {
    id: 'NET-ENDPOINT-002',
    awsBehavior: 'Without a NAT Gateway OR a VPC Endpoint, a private-subnet resource has no path to a service reached over the public internet - the connection times out.',
    reference: 'Amazon VPC User Guide - "NAT gateways" / "Gateway endpoints"',
    scenario: 'A private EC2 instance attempts to reach an external HTTPS API with no NAT Gateway and no VPC Endpoint present.',
    configuration: { natGateway: 'absent', vpcEndpoint: 'absent' },
    request: { source: 'private EC2', destination: 'external HTTPS API' },
    expected: { success: false, statusCode: 504 },
    run: () => {
      const ec2 = { id: 'n-ec2', type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId: 'ec2', label: 'Private EC2', category: 'Compute', health: 'healthy', az: 'AZ-A', subnet: 'private', replicas: 1, multiAz: false } };
      const external = { id: 'n-ext', type: 'serviceNode', position: { x: 0, y: 0 }, data: { serviceId: 'api_client', label: 'External API', category: 'Client / Ingress', health: 'healthy', az: 'Edge / Global', subnet: 'global', replicas: 1, multiAz: false } };
      const edge = { id: 'e1', source: 'n-ec2', target: 'n-ext', type: 'custom', data: { protocol: 'HTTPS', interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1000 } };
      const result = runSimulation([ec2, external] as any, [edge] as any, scenario('n-ec2'));
      return { success: result.success, statusCode: result.statusCode };
    },
    explain: (actual) => !actual.success
      ? 'The simulator correctly reports no path for private-subnet egress with neither a NAT Gateway nor a VPC Endpoint present.'
      : 'The simulator allowed private-subnet egress to an external destination with no NAT Gateway or VPC Endpoint - AWS provides no such implicit path.'
  }
];

runConformanceCases(CASES);
