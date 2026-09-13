import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData, SimulationScenario } from '../types/index.ts';
import type { Principal } from '../engine/iam/types.ts';
import { AWS_SERVICES } from './serviceCatalog.ts';

export interface LabReference {
  id: string;
  title: string;
  description: string;
  expected: string;
  simulationScope?: string;
  nodes: Node<ServiceNodeData>[];
  edges: Edge<ConnectionData>[];
  scenario: SimulationScenario;
  authorization?: { principal: Principal; action: string; resourceArn: string };
}
export interface CourseLab {
  id: string;
  number: number;
  title: string;
  sourceUrl: string;
  objectives: string[];
  limitations: string;
  references: LabReference[];
}

const root = 'https://norbutlepcha25.github.io/dso303/Lab/';
const node = (id: string, serviceId: string, label: string, x: number, y: number, extra: Partial<ServiceNodeData> = {}): Node<ServiceNodeData> => ({
  id, type: 'serviceNode', position: { x, y }, data: { serviceId, label, category: AWS_SERVICES.find(service => service.id === serviceId)?.category ?? 'Compute', health: 'healthy', az: 'AZ-A', subnet: 'global', replicas: 1, multiAz: false, ...extra }
});
const boundary = (id: string, label: string, kind: string, x: number, y: number, width: number, height: number, extra = {}): Node<ServiceNodeData> => ({
  id, type: 'boundaryNode', position: { x, y }, style: { width, height }, data: { label, boundaryType: kind, width, height, ...extra } as unknown as ServiceNodeData
});
const edge = (source: string, target: string, protocol: ConnectionData['protocol'] = 'HTTP', dependency = false): Edge<ConnectionData> => ({
  id: `${source}-${target}`, source, target, type: 'custom', data: { protocol, interactionType: 'synchronous', isCriticalDependency: true, timeoutMs: 1500, ...(dependency ? { traversal: 'dependency' as const } : {}) }
});
const scenario = (id: string, startNodeId: string): SimulationScenario => ({ id, name: id, method: 'GET', path: '/', startNodeId, trafficLevel: 'normal' });
const bucketArn = 'arn:aws:s3:::usms-student-data/transcript.txt';
const principal: Principal = { id: 'usms-dev-01', kind: 'user', accountId: '000000000000', identityPolicies: [{ id: 'USMSStudentDataReadWrite', kind: 'identity', statements: [{ effect: 'Allow', actions: ['s3:GetObject', 's3:PutObject'], resources: ['arn:aws:s3:::usms-student-data/*'] }] }] };

function iamReference(id: string, deny: boolean, introductory = false): LabReference {
  const identity = structuredClone(principal);
  if (introductory && !deny) identity.identityPolicies = [];
  if (deny) identity.identityPolicies.push({ id: 'ExplicitDeny', kind: 'identity', statements: [{ effect: 'Deny', actions: ['s3:*'], resources: ['*'] }] });
  const allowed = !deny && !introductory;
  return { id, title: deny ? 'Explicit deny overrides allow' : introductory ? 'New user: implicit deny' : 'Scoped student-data access',
    description: 'Evaluate a user policy against a specific S3 object. Group membership is illustrated; the attached effective policy is the authorization input.',
    expected: allowed ? 'ALLOW: GetObject on the student-data object.' : 'DENY: the object must not be returned.',
    nodes: [node('lab-user', 'user', identity.id, 40, 160), node('lab-iam', 'iam', 'USMS identities and policies', 300, 30, { notes: 'Groups: usms-admins, usms-developers, usms-auditors. Roles: usms-ec2-app-role, usms-lambda-exec-role, usms-developer-role. Identity management is illustrated; no credentials are created.' }), node('lab-bucket', 's3', 'usms-student-data (policy test resource)', 560, 160)],
    edges: [edge('lab-user', 'lab-bucket', 'Object access')], scenario: scenario(id, 'lab-user'), authorization: { principal: identity, action: 's3:GetObject', resourceArn: bucketArn }
  };
}

function networkReference(id: string, stage: number): LabReference {
  const nodes = [
    boundary('lab-vpc', 'usms-vpc', 'vpc', 180, 20, 1040, 780, { cidr: '10.0.0.0/16' }),
    boundary('lab-public-a', 'usms-public-subnet-a', 'public_subnet', 210, 100, 440, 250, { cidr: '10.0.1.0/24', az: 'AZ-A' }),
    boundary('lab-public-b', 'usms-public-subnet-b', 'public_subnet', 700, 100, 440, 250, { cidr: '10.0.2.0/24', az: 'AZ-B' }),
    boundary('lab-private-a', 'usms-private-subnet-a', 'private_subnet', 210, 440, 440, 250, { cidr: '10.0.3.0/24', az: 'AZ-A' }),
    boundary('lab-private-b', 'usms-private-subnet-b', 'private_subnet', 700, 440, 440, 250, { cidr: '10.0.4.0/24', az: 'AZ-B' }),
    node('lab-client', 'user', 'Student browser', 10, 200),
    node('lab-igw', 'internet_gateway', 'usms-igw', 450, -130),
    node('lab-nat', 'nat_gateway', 'usms-nat', 430, 190, { subnet: 'public' }),
    node('lab-public-rt', 'route_tables', 'usms-public-rt → IGW', 250, 730, { notes: 'Reference association: public subnets; default route to usms-igw. Live route-table selection is approximated.' }),
    node('lab-private-rt', 'route_tables', 'usms-private-rt → NAT', 700, 730, { notes: 'Reference association: private subnets; default route to usms-nat; S3 endpoint route.' }),
    boundary('lab-app-sg', 'usms-app-sg', 'security_group', 1270, 50, 220, 120, { allowedProtocols: ['HTTP', 'HTTPS'] }),
    boundary('lab-db-sg', 'usms-db-sg', 'security_group', 1270, 210, 220, 120, { securityGroupRules: { inbound: [{ protocol: 'SQL', portRange: 'ALL', source: { type: 'securityGroup', securityGroupId: 'lab-app-sg' } }], outbound: [] } })
  ];
  let edges: Edge<ConnectionData>[] = [];
  let start = 'lab-client';
  if (stage === 2) {
    nodes.push(node('lab-probe', 'ec2', 'Private network probe (teaching aid)', 250, 540, { subnet: 'private', iamRole: { id: 'probe-role', trustPolicy: { id: 'trust', kind: 'trust', statements: [{ effect: 'Allow', principals: ['ec2'], actions: ['sts:AssumeRole'], resources: ['*'] }] }, identityPolicies: principal.identityPolicies } }), node('lab-endpoint', 's3_gateway_endpoint', 'usms-s3-endpoint', 900, 740), node('lab-bucket', 's3', 'S3 probe resource (teaching aid)', 1550, 540, { customConfig: { resourceArn: bucketArn } }));
    edges = [edge('lab-probe', 'lab-endpoint', 'HTTPS'), edge('lab-endpoint', 'lab-bucket', 'Object access')]; start = 'lab-probe';
  } else {
    nodes.push(node('lab-web', 'ec2', 'usms-web-01', 250, 190, { subnet: 'public', securityGroupIds: ['lab-app-sg'], notes: 'Instance profile: usms-ec2-app-profile. Bootstrap, EIP and AMI lifecycle are covered in the original lab.' }));
    if (stage === 3) {
      nodes.push(node('lab-db', 'ec2', 'usms-db-01', 250, 540, { subnet: 'private', securityGroupIds: ['lab-db-sg'] }), node('lab-volume', 'ebs', 'usms-web-data-vol (8 GiB)', 1550, 250));
      edges = [edge('lab-client', 'lab-web'), edge('lab-web', 'lab-db', 'SQL'), edge('lab-web', 'lab-volume', 'TCP', true)];
    } else {
      nodes.push(boundary('lab-task-sg', 'usms-enrolment-sg', 'security_group', 1270, 380, 220, 120, { securityGroupRules: { inbound: [{ protocol: 'HTTP', portRange: 'ALL', source: { type: 'securityGroup', securityGroupId: stage >= 5 ? 'lab-alb-sg' : 'lab-app-sg' } }], outbound: [] } }),
        node('lab-task-a', 'ecs', 'usms-enrolment-svc · task A', 250, 540, { subnet: 'private', securityGroupIds: ['lab-task-sg'], customConfig: { ecs: { launchType: 'FARGATE', networkMode: 'awsvpc', desiredCount: 1, runningCount: 1 } } }),
        node('lab-task-b', 'ecs', 'usms-enrolment-svc · task B', 750, 540, { subnet: 'private', az: 'AZ-B', securityGroupIds: ['lab-task-sg'], customConfig: { ecs: { launchType: 'FARGATE', networkMode: 'awsvpc', desiredCount: 1, runningCount: 1 } } }),
        node('lab-logs', 'cloudwatch', '/usms/ecs/enrolment', 1550, 540), node('lab-role', 'iam', 'Task role / execution role', 1550, 50, { notes: 'usms-ecs-task-role: application APIs. usms-ecs-exec-role: agent startup/logging. Startup is not simulated.' }));
      if (stage >= 5) {
        nodes.push(node('lab-alb', 'alb', 'usms-enrolment-alb', 750, 190, { subnet: 'public', az: 'Multi-AZ', multiAz: true, securityGroupIds: ['lab-alb-sg'], notes: 'HTTP:80 → usms-enrolment-tg, IP targets. The /alb-health fixed response and registration timing are not simulated.' }), boundary('lab-alb-sg', 'usms-alb-sg', 'security_group', 1270, 550, 220, 120, { allowedProtocols: ['HTTP'] }));
        edges = [edge('lab-client', 'lab-alb'), edge('lab-alb', 'lab-task-a'), edge('lab-alb', 'lab-task-b')];
      } else edges = [edge('lab-web', 'lab-task-a')];
      edges.push(edge('lab-task-a', 'lab-logs', 'HTTPS', true));
      if (stage === 4) start = 'lab-web';
      if (stage === 6) { nodes.push(node('lab-scaling', 'auto_scaling_mgmt', 'Scalable target · min 2 / max 10', 1550, 740, { notes: 'service/usms-ecs-cluster/usms-enrolment-svc; ecs:service:DesiredCount. Policy decisions and CloudWatch alarm timing are not simulated.' })); edges.push(edge('lab-logs', 'lab-scaling', 'HTTPS', true), edge('lab-scaling', 'lab-task-a', 'HTTPS', true)); }
    }
  }
  return { id, title: 'Reference request', description: 'Load the course resource layout and explore a supported request path.', expected: 'SUCCESS on the reference request; inspect each recorded decision.', nodes, edges, scenario: scenario(id, start) };
}

const lab0 = iamReference('lab0-implicit-deny', false, true);
const lab1 = iamReference('lab1-allow', false);
const lab2 = networkReference('lab2-endpoint', 2);
const lab3 = networkReference('lab3-two-tier', 3);
const lab4 = networkReference('lab4-private-tasks', 4);
const lab5 = networkReference('lab5-alb', 5);
const lab6 = networkReference('lab6-capacity', 6);
const failover = structuredClone(lab5); failover.id = 'lab5-failover'; failover.title = 'Task A unavailable'; failover.nodes.find(n => n.id === 'lab-task-a')!.data.health = 'failed'; failover.expected = 'SUCCESS through healthy task B.';
const blocked = structuredClone(lab3); blocked.id = 'lab3-blocked'; blocked.title = 'Database SG denies SQL'; blocked.nodes.find(n => n.id === 'lab-db-sg')!.data.securityGroupRules = { inbound: [], outbound: [] }; blocked.expected = 'DENIED before reaching the database-tier instance.';
const capacity = structuredClone(lab6); capacity.id = 'lab6-capacity-four'; capacity.title = 'Four running tasks (supplied snapshot)'; capacity.nodes.filter(n => n.data.serviceId === 'ecs').forEach(n => { n.data.customConfig!.ecs = { ...n.data.customConfig!.ecs, desiredCount: 2, runningCount: 2 }; }); capacity.expected = 'SUCCESS with four supplied running tasks; this does not demonstrate an automatic scaling decision.';

function eksReference(id: string, destination: 'enrolment' | 'results', scaling = false, unavailable = false): LabReference {
  const base = networkReference(id, 2);
  const nodes = base.nodes.filter(n => !['lab-probe', 'lab-endpoint', 'lab-bucket', 'lab-client', 'lab-app-sg', 'lab-db-sg'].includes(n.id));
  const workload = (name: string, x: number, y: number, replicas: number) => node(`lab-${name}`, 'eks', `usms-${name} · workload abstraction`, x, y, {
    subnet: 'private', replicas, az: name === 'results' ? 'AZ-B' : 'AZ-A',
    notes: `Kubernetes Deployment + ClusterIP Service, namespace usms; ${replicas} supplied replicas. EKS icon represents an aggregated workload, not a separate EKS cluster. DNS name: usms-${name}.usms.svc.cluster.local. DNS and endpoint selection are not executed.`
  });
  nodes.push(workload('gateway', 240, 470, 1), workload('enrolment', 460, 550, scaling ? 5 : 2), workload('results', 750, 540, 2),
    node('lab-cluster', 'eks', 'usms-eks-cluster · control plane reference', 1550, 50, { notes: 'One cluster across the four Lab 2 subnets. usms-eks-nodes: private subnets, desired 2 workers. Control-plane creation, scheduling, DNS, ConfigMaps and Secrets are not executed.', customConfig: { referenceOnly: true, managedNodeGroup: { name: 'usms-eks-nodes', desiredSize: 2 } } }),
    node('lab-cluster-role', 'iam', 'usms-eks-cluster-role / node-role', 1550, 250, { notes: 'Cluster role trusts eks.amazonaws.com; node role trusts ec2.amazonaws.com. Reference metadata only; Kubernetes RBAC and role creation are not simulated.' }));
  if (unavailable) nodes.find(n => n.id === `lab-${destination}`)!.data.health = 'failed';
  if (scaling) {
    nodes.find(n => n.id === 'lab-cluster')!.data.notes += ' Lab 8 distinguishes pod replicas from worker desiredSize; this snapshot retains two workers.';
    nodes.find(n => n.id === 'lab-enrolment')!.data.notes += ' Lab 8 manual five-replica snapshot; HPA reference: min 2, max 8, CPU target 50% of a 50m request. No HPA decision occurred.';
    nodes.find(n => n.id === 'lab-gateway')!.data.notes += ' Exposure exercises: NodePort, LoadBalancer, usms-portal-ingress and controller choice are in the original instructions. No AWS ALB is assumed or provisioned. PDB minAvailable 1 is reference metadata.';
  }
  return { id, title: unavailable ? `${destination} workload unavailable` : scaling ? 'Five enrolment replicas (supplied snapshot)' : `Internal /${destination}/ request`,
    description: 'One selected internal application path through workload abstractions; other services remain visible for comparison.',
    expected: unavailable ? 'FAILURE at the selected workload; the other microservice remains healthy.' : 'SUCCESS on the selected internal path.',
    simulationScope: 'Approximate workload connectivity and health only. The selected branch is supplied by this reference, not resolved from the URL or Kubernetes DNS. Replica counts are snapshots; no scheduler, HPA, Ingress controller or pod load balancing was executed.',
    nodes, edges: [edge('lab-gateway', `lab-${destination}`), edge('lab-gateway', `lab-${destination === 'enrolment' ? 'results' : 'enrolment'}`, 'HTTP', true)],
    scenario: { ...scenario(id, 'lab-gateway'), path: `/${destination}/` } };
}

export const COURSE_LABS: CourseLab[] = [
  { id: 'dso303-0', number: 0, title: 'IAM warm-up', sourceUrl: root + 'lab1_iam.html', objectives: ['Compare implicit and explicit deny.', 'Trace a user’s S3 authorization.'], limitations: 'Policy evaluation only. User/group creation, credentials and Floci setup remain in the lab instructions.', references: [lab0, iamReference('lab0-explicit-deny', true)] },
  { id: 'dso303-1', number: 1, title: 'IAM foundation', sourceUrl: root + 'Lab-01-IAM.html', objectives: ['Explore USMS users, groups and roles.', 'Compare scoped access with an explicit deny.'], limitations: 'Effective policies are evaluated; group administration, policy versions, environment persistence and human role assumption are not reproduced. S3 is a policy-test resource for the later hand-off.', references: [lab1, iamReference('lab1-deny', true)] },
  { id: 'dso303-2', number: 2, title: 'VPC and networking', sourceUrl: root + 'Lab-02_VPC.html', objectives: ['Inspect the two-AZ subnet plan, NAT and route references.', 'Follow a private S3 endpoint request.'], limitations: 'Probe EC2/S3 resources are teaching aids beyond the network-only lab. Route tables are reference metadata; full packet routing and custom NACL exercises are not covered.', references: [lab2] },
  { id: 'dso303-3', number: 3, title: 'EC2 and VPC', sourceUrl: root + 'Lab-03_VPC2.html', objectives: ['Connect public web and private database-tier EC2 instances.', 'Change the database security group and observe denial.'], limitations: 'EBS mounting, bootstrapping, AMI creation, key pairs and IP lifecycle remain in the instructions. The SQL request is a connectivity exercise, not a real database query.', references: [lab3, blocked] },
  { id: 'dso303-4', number: 4, title: 'ECS and Fargate', sourceUrl: root + 'Lab-04-ECS.html', objectives: ['Reach private awsvpc tasks from the web tier.', 'Distinguish running tasks from desired capacity and task/execution roles.'], limitations: 'Running-task and SG behavior only. Image pulls, deployment revisions, logging and the scaling exercises on this page are not executed.', references: [lab4] },
  { id: 'dso303-5', number: 5, title: 'ALB front door (04B)', sourceUrl: root + 'Lab-05-ALB.html', objectives: ['Reach ECS through the ALB security group.', 'Observe selection of a surviving target.'], limitations: 'Listener rules, health-check timing and dynamic target registration are not simulated. Both-unhealthy AWS fail-open semantics remain outside this example.', references: [lab5, failover] },
  { id: 'dso303-6', number: 6, title: 'Service Auto Scaling (04C)', sourceUrl: root + 'Lab-06-autoscaling.html', objectives: ['Inspect the metric → scalable-target → ECS relationship.', 'Compare supplied two-task and four-task capacity snapshots.'], limitations: 'Architecture and capacity snapshots only. Target tracking, step/scheduled scaling, alarms and cooldown decisions are not simulated; complete those experiments in the original lab.', references: [lab6, capacity] }
  ,{ id: 'dso303-7', number: 7, title: 'EKS microservices (05A)', sourceUrl: root + 'Lab-07-EKS.html', objectives: ['Compare the single EKS control plane with the USMS workload deployments.', 'Explore internal gateway → enrolment/results paths and workload failure.'], limitations: 'EKS workload abstractions only. ClusterIP DNS, pod readiness/selection, manifests, rollout/rollback, RBAC, ConfigMaps and Secrets are not executed. The EKS icons for workloads do not represent separate clusters.', references: [eksReference('lab7-enrolment', 'enrolment'), eksReference('lab7-results', 'results'), eksReference('lab7-unavailable', 'enrolment', false, true)] },
  { id: 'dso303-8', number: 8, title: 'EKS scaling and exposure (05B)', sourceUrl: root + 'Lab-08-EKS-scaling.html', objectives: ['Compare two and five enrolment replicas while worker count stays separate.', 'Inspect the HPA and exposure notes; test an unavailable workload.'], limitations: 'Supplied workload/capacity snapshots only. HPA, metrics-server, scheduling/Pending pods, node-group scaling, PDBs, NodePort, LoadBalancer and Ingress are covered by the linked exercise, not executed here. Send Request surge behavior is a generic approximation, not Kubernetes scaling.', references: [eksReference('lab8-baseline', 'enrolment'), eksReference('lab8-five', 'enrolment', true), eksReference('lab8-unavailable', 'enrolment', true, true)] }
];
