import type { Node } from '@xyflow/react';
import type { ServiceNodeData, ServiceCategory } from '../../types/index.ts';

export interface LineItem {
  name: string;
  detail: string;
  cost: number;
}

export interface NodeCostEstimate {
  nodeId: string;
  nodeName: string;
  serviceId: string;
  category: ServiceCategory;
  monthlyCost: number;
  hourlyCost: number;
  lineItems: LineItem[];
  configurationSummary: string;
  freeTierEligible?: boolean;
}

export interface FinOpsTip {
  id: string;
  severity: 'high' | 'medium' | 'info';
  title: string;
  description: string;
  estimatedMonthlySavings?: number;
  affectedNodeIds: string[];
}

export interface ArchitectureCostReport {
  monthlyTotal: number;
  hourlyTotal: number;
  annualTotal: number;
  byCategory: Record<string, number>;
  nodeCosts: NodeCostEstimate[];
  trafficMultiplier: number;
  trafficLevelName: string;
  recommendations: FinOpsTip[];
}

// 730 hours in an average AWS billing month (365 * 24 / 12)
export const HOURS_PER_MONTH = 730;

// EC2 Instance Type Pricing (US-East-1 on-demand hourly rates)
export const EC2_INSTANCE_TYPES: Record<string, { vCpu: number; ramGb: number; hourly: number; label: string; family: string }> = {
  't3.nano': { vCpu: 2, ramGb: 0.5, hourly: 0.0052, label: 't3.nano (2 vCPU, 0.5 GiB)', family: 'General Purpose' },
  't3.micro': { vCpu: 2, ramGb: 1.0, hourly: 0.0104, label: 't3.micro (2 vCPU, 1.0 GiB) - Free Tier eligible', family: 'General Purpose' },
  't3.small': { vCpu: 2, ramGb: 2.0, hourly: 0.0208, label: 't3.small (2 vCPU, 2.0 GiB)', family: 'General Purpose' },
  't3.medium': { vCpu: 2, ramGb: 4.0, hourly: 0.0416, label: 't3.medium (2 vCPU, 4.0 GiB)', family: 'General Purpose' },
  't3.large': { vCpu: 2, ramGb: 8.0, hourly: 0.0832, label: 't3.large (2 vCPU, 8.0 GiB)', family: 'General Purpose' },
  't3.xlarge': { vCpu: 4, ramGb: 16.0, hourly: 0.1664, label: 't3.xlarge (4 vCPU, 16.0 GiB)', family: 'General Purpose' },
  'm6i.large': { vCpu: 2, ramGb: 8.0, hourly: 0.0960, label: 'm6i.large (2 vCPU, 8.0 GiB)', family: 'General Purpose' },
  'm6i.xlarge': { vCpu: 4, ramGb: 16.0, hourly: 0.1920, label: 'm6i.xlarge (4 vCPU, 16.0 GiB)', family: 'General Purpose' },
  'm6g.large': { vCpu: 2, ramGb: 8.0, hourly: 0.0770, label: 'm6g.large (AWS Graviton2, 2 vCPU, 8.0 GiB)', family: 'General Purpose' },
  'c6i.large': { vCpu: 2, ramGb: 4.0, hourly: 0.0850, label: 'c6i.large (2 vCPU, 4.0 GiB)', family: 'Compute Optimized' },
  'c6i.xlarge': { vCpu: 4, ramGb: 8.0, hourly: 0.1700, label: 'c6i.xlarge (4 vCPU, 8.0 GiB)', family: 'Compute Optimized' },
  'r6i.large': { vCpu: 2, ramGb: 16.0, hourly: 0.1260, label: 'r6i.large (2 vCPU, 16.0 GiB)', family: 'Memory Optimized' },
  'r6i.xlarge': { vCpu: 4, ramGb: 32.0, hourly: 0.2520, label: 'r6i.xlarge (4 vCPU, 32.0 GiB)', family: 'Memory Optimized' },
  'g5.xlarge': { vCpu: 4, ramGb: 16.0, hourly: 1.0060, label: 'g5.xlarge (4 vCPU, 16.0 GiB, 1x NVIDIA A10G)', family: 'Accelerated / GPU' }
};

export const EC2_OS_IMAGES = [
  { id: 'al2023', label: 'Amazon Linux 2023 (Free)' },
  { id: 'ubuntu-24', label: 'Ubuntu 24.04 LTS (Free)' },
  { id: 'rhel-9', label: 'Red Hat Enterprise Linux 9 (+$0.06/hr license)' },
  { id: 'windows-2022', label: 'Windows Server 2022 (+$0.046/hr license)' }
];

export const EBS_VOLUME_TYPES: Record<string, { costPerGb: number; label: string }> = {
  'gp3': { costPerGb: 0.08, label: 'General Purpose SSD (gp3) - $0.08/GB-mo' },
  'io2': { costPerGb: 0.125, label: 'Provisioned IOPS SSD (io2) - $0.125/GB-mo' },
  'st1': { costPerGb: 0.045, label: 'Throughput Optimized HDD (st1) - $0.045/GB-mo' },
  'sc1': { costPerGb: 0.015, label: 'Cold HDD (sc1) - $0.015/GB-mo' }
};

export const S3_STORAGE_CLASSES: Record<string, { costPerGb: number; label: string; desc: string }> = {
  'STANDARD': { costPerGb: 0.023, label: 'S3 Standard', desc: 'Active frequent access ($0.023/GB)' },
  'INTELLIGENT_TIERING': { costPerGb: 0.018, label: 'S3 Intelligent-Tiering', desc: 'Auto-moves between tiers (~$0.018/GB blended)' },
  'STANDARD_IA': { costPerGb: 0.0125, label: 'S3 Standard-IA', desc: 'Infrequent access ($0.0125/GB + retrieval fee)' },
  'ONEZONE_IA': { costPerGb: 0.010, label: 'S3 One Zone-IA', desc: 'Single-AZ backup ($0.010/GB)' },
  'GLACIER_IR': { costPerGb: 0.004, label: 'S3 Glacier Instant Retrieval', desc: 'Milliseconds retrieval archive ($0.004/GB)' },
  'GLACIER': { costPerGb: 0.0036, label: 'S3 Glacier Flexible Retrieval', desc: 'Minutes-to-hours retrieval ($0.0036/GB)' },
  'DEEP_ARCHIVE': { costPerGb: 0.00099, label: 'S3 Glacier Deep Archive', desc: 'Lowest cloud storage cost ($0.00099/GB = $1/TB)' }
};

export const RDS_INSTANCE_TYPES: Record<string, { hourly: number; label: string }> = {
  'db.t4g.micro': { hourly: 0.016, label: 'db.t4g.micro (2 vCPU, 1 GiB)' },
  'db.t4g.small': { hourly: 0.032, label: 'db.t4g.small (2 vCPU, 2 GiB)' },
  'db.t4g.medium': { hourly: 0.064, label: 'db.t4g.medium (2 vCPU, 4 GiB)' },
  'db.m6g.large': { hourly: 0.178, label: 'db.m6g.large (2 vCPU, 8 GiB)' },
  'db.r6g.large': { hourly: 0.240, label: 'db.r6g.large (2 vCPU, 16 GiB)' }
};

export function getTrafficScaleFactor(trafficLevel?: string): number {
  switch (trafficLevel) {
    case 'low': return 0.5;
    case 'normal': return 1.0;
    case 'high': return 2.5;
    case 'very_high': return 5.0;
    case '10x': return 10.0;
    case '100x': return 100.0;
    default: return 1.0;
  }
}

/**
 * Calculates the realistic monthly and hourly AWS cost for an individual service node.
 */
export function calculateNodeCost(node: Node<ServiceNodeData>, trafficMultiplier = 1.0): NodeCostEstimate {
  const serviceId = node.data.serviceId || 'ec2';
  const label = node.data.label || serviceId;
  const category = node.data.category || 'Compute';
  const replicas = Math.max(1, node.data.replicas || 1);
  const multiAz = Boolean(node.data.multiAz);
  const custom = node.data.customConfig || {};

  const lineItems: LineItem[] = [];
  let configSummary = '';
  let freeTierEligible = false;

  // 1. Amazon EC2
  if (serviceId === 'ec2') {
    const instTypeKey = custom.instanceType || 't3.micro';
    const inst = EC2_INSTANCE_TYPES[instTypeKey] || EC2_INSTANCE_TYPES['t3.micro'];
    const purchasing = custom.purchasingOption || 'on_demand';
    let purchaseDiscount = 1.0;
    let purchaseLabel = 'On-Demand';
    if (purchasing === 'savings_plan_1yr') { purchaseDiscount = 0.65; purchaseLabel = '1-Yr Savings Plan (35% off)'; }
    else if (purchasing === 'savings_plan_3yr') { purchaseDiscount = 0.45; purchaseLabel = '3-Yr Savings Plan (55% off)'; }
    else if (purchasing === 'spot') { purchaseDiscount = 0.30; purchaseLabel = 'Spot Instance (70% off)'; }

    const osImage = custom.osImage || 'al2023';
    let osLicenseHourly = 0;
    if (osImage === 'rhel-9') osLicenseHourly = 0.06;
    if (osImage === 'windows-2022') osLicenseHourly = 0.046;

    const baseInstanceHourly = (inst.hourly * purchaseDiscount) + osLicenseHourly;
    const instanceMonthly = baseInstanceHourly * HOURS_PER_MONTH * replicas;
    lineItems.push({
      name: `EC2 Compute: ${inst.label} × ${replicas} instance(s)`,
      detail: `${replicas} × $${baseInstanceHourly.toFixed(4)}/hr (${purchaseLabel})`,
      cost: instanceMonthly
    });

    const ebsType = custom.ebsVolumeType || 'gp3';
    const ebsSizeGb = custom.ebsVolumeSizeGb !== undefined ? Number(custom.ebsVolumeSizeGb) : 30;
    const ebsDef = EBS_VOLUME_TYPES[ebsType] || EBS_VOLUME_TYPES['gp3'];
    const ebsCost = ebsDef.costPerGb * ebsSizeGb * replicas;
    lineItems.push({
      name: `EBS Storage: ${ebsSizeGb} GB ${ebsType} × ${replicas} volume(s)`,
      detail: `${ebsSizeGb * replicas} GB total @ $${ebsDef.costPerGb.toFixed(3)}/GB-mo`,
      cost: ebsCost
    });

    if (instTypeKey === 't3.micro' && replicas === 1 && purchasing === 'on_demand') {
      freeTierEligible = true;
    }
    configSummary = `${instTypeKey}, ${ebsSizeGb}GB ${ebsType}, ${replicas} unit(s)`;
  }

  // 2. Amazon S3
  else if (serviceId === 's3' || serviceId === 's3_client' || serviceId === 's3_managed') {
    const storageClassKey = custom.storageClass || 'STANDARD';
    const sc = S3_STORAGE_CLASSES[storageClassKey] || S3_STORAGE_CLASSES['STANDARD'];
    const storageGb = custom.storageGb !== undefined ? Number(custom.storageGb) : 50;

    const storageCost = sc.costPerGb * storageGb;
    lineItems.push({
      name: `S3 Storage: ${storageGb} GB (${sc.label})`,
      detail: `${storageGb} GB @ $${sc.costPerGb.toFixed(5)}/GB-mo`,
      cost: storageCost
    });

    const requestsCost = Math.max(0.10, 0.50 * trafficMultiplier);
    lineItems.push({
      name: 'API Requests & Data Transfer',
      detail: `PUT/GET operations scaled with traffic (${trafficMultiplier}x)`,
      cost: requestsCost
    });

    configSummary = `${sc.label}, ${storageGb} GB`;
  }

  // 3. Amazon RDS / Aurora
  else if (serviceId === 'rds' || serviceId === 'aurora') {
    const instTypeKey = custom.dbInstanceClass || 'db.t4g.micro';
    const inst = RDS_INSTANCE_TYPES[instTypeKey] || RDS_INSTANCE_TYPES['db.t4g.micro'];
    const azMultiplier = multiAz ? 2.0 : 1.0;
    const computeMonthly = inst.hourly * HOURS_PER_MONTH * azMultiplier;

    lineItems.push({
      name: `RDS DB Instance: ${inst.label}${multiAz ? ' (Multi-AZ Standby)' : ''}`,
      detail: `${azMultiplier}x instance @ $${inst.hourly.toFixed(3)}/hr × 730 hrs`,
      cost: computeMonthly
    });

    const storageGb = custom.storageGb !== undefined ? Number(custom.storageGb) : 50;
    const storageCost = 0.115 * storageGb * azMultiplier;
    lineItems.push({
      name: `RDS Storage: ${storageGb} GB gp3${multiAz ? ' (Mirrored Multi-AZ)' : ''}`,
      detail: `${storageGb * azMultiplier} GB @ $0.115/GB-mo`,
      cost: storageCost
    });

    configSummary = `${instTypeKey}, ${storageGb}GB, ${multiAz ? 'Multi-AZ' : 'Single-AZ'}`;
  }

  // 4. AWS Lambda
  else if (serviceId === 'lambda' || serviceId === 'step_lambda') {
    const arch = custom.architecture || 'arm64';
    const memMb = custom.memoryMb !== undefined ? Number(custom.memoryMb) : 256;
    const invocations = (custom.monthlyInvocations !== undefined ? Number(custom.monthlyInvocations) : 1000000) * trafficMultiplier;
    const durationMs = custom.durationMs !== undefined ? Number(custom.durationMs) : 150;

    const gbSeconds = (memMb / 1024) * (durationMs / 1000) * invocations;
    const ratePerGbSec = arch === 'arm64' ? 0.0000133334 : 0.0000166667;
    // 400,000 GB-seconds and 1M requests are in AWS Lambda free tier each month
    const billableGbSec = Math.max(0, gbSeconds - 400000);
    const billableRequests = Math.max(0, invocations - 1000000);

    const computeCost = billableGbSec * ratePerGbSec;
    const reqCost = (billableRequests / 1000000) * 0.20;
    const totalLambda = Math.max(0.20, computeCost + reqCost);

    lineItems.push({
      name: `Lambda Invocations: ${(invocations / 1000000).toFixed(1)}M runs (${arch}, ${memMb}MB)`,
      detail: `${durationMs}ms avg duration, ${gbSeconds.toFixed(0)} GB-sec`,
      cost: totalLambda
    });

    configSummary = `${arch}, ${memMb}MB, ${(invocations / 1000000).toFixed(1)}M inv`;
  }

  // 5. Load Balancers (ALB, NLB)
  else if (serviceId === 'alb' || serviceId === 'nlb' || serviceId === 'elb') {
    const baseRate = 0.0225; // $0.0225/hr
    const lcuHourly = serviceId === 'nlb' ? 0.006 : 0.008;
    const lcuCount = Math.max(1, Math.round(1 * trafficMultiplier));
    const baseCost = baseRate * HOURS_PER_MONTH;
    const lcuCost = lcuCount * lcuHourly * HOURS_PER_MONTH;

    lineItems.push({
      name: `${serviceId.toUpperCase()} Hourly Base Fee`,
      detail: `$0.0225/hr × 730 hours`,
      cost: baseCost
    });
    lineItems.push({
      name: `Capacity Units (${lcuCount} ${serviceId === 'nlb' ? 'NLCU' : 'LCU'})`,
      detail: `$${lcuHourly.toFixed(3)}/hr scaled with traffic`,
      cost: lcuCost
    });

    configSummary = `${serviceId.toUpperCase()}, ${lcuCount} LCU`;
  }

  // 6. NAT Gateway
  else if (serviceId === 'nat_gateway') {
    const hourlyCost = 0.045 * HOURS_PER_MONTH;
    const gbProcessed = 100 * trafficMultiplier;
    const dataCost = gbProcessed * 0.045;

    lineItems.push({
      name: 'NAT Gateway Hourly Fee',
      detail: '$0.045/hr × 730 hours (running constantly)',
      cost: hourlyCost
    });
    lineItems.push({
      name: `NAT Data Processing: ${gbProcessed} GB`,
      detail: `$0.045/GB processed out to internet`,
      cost: dataCost
    });

    configSummary = `1 NAT GW, ${gbProcessed}GB processed`;
  }

  // 7. ECS / Fargate Containers
  else if (serviceId === 'ecs' || serviceId === 'fargate' || serviceId === 'app_runner') {
    const vCpu = custom.vCpu !== undefined ? Number(custom.vCpu) : 0.5;
    const ramGb = custom.ramGb !== undefined ? Number(custom.ramGb) : 1.0;
    const vCpuMonthly = vCpu * 0.04048 * HOURS_PER_MONTH * replicas;
    const ramMonthly = ramGb * 0.004445 * HOURS_PER_MONTH * replicas;

    lineItems.push({
      name: `Fargate Compute: ${vCpu} vCPU × ${replicas} task(s)`,
      detail: `$0.04048 per vCPU-hr × 730 hrs`,
      cost: vCpuMonthly
    });
    lineItems.push({
      name: `Fargate Memory: ${ramGb} GB RAM × ${replicas} task(s)`,
      detail: `$0.004445 per GB-hr × 730 hrs`,
      cost: ramMonthly
    });

    configSummary = `${vCpu} vCPU, ${ramGb}GB, ${replicas} tasks`;
  }

  // 8. Amazon CloudFront
  else if (serviceId === 'cloudfront') {
    const gbData = 150 * trafficMultiplier;
    const dataCost = gbData * 0.085;
    const requestCost = 0.75 * trafficMultiplier;

    lineItems.push({
      name: `Edge Data Transfer Out: ${gbData.toFixed(0)} GB`,
      detail: `$0.085/GB standard edge egress`,
      cost: dataCost
    });
    lineItems.push({
      name: 'HTTPS Request Routing',
      detail: '$0.01 per 10,000 requests',
      cost: requestCost
    });

    configSummary = `Global Edge, ${gbData.toFixed(0)}GB egress`;
  }

  // 9. Amazon DynamoDB
  else if (serviceId === 'dynamodb') {
    const storageGb = 10;
    const storageCost = storageGb * 0.25;
    const rcuWcuCost = 2.50 * trafficMultiplier;

    lineItems.push({
      name: `DynamoDB Table Storage: ${storageGb} GB`,
      detail: '$0.25/GB-mo (first 25GB free in real AWS)',
      cost: storageCost
    });
    lineItems.push({
      name: 'On-Demand Read/Write Requests',
      detail: `Scaled by traffic load (${trafficMultiplier}x)`,
      cost: rcuWcuCost
    });

    configSummary = 'On-Demand, 10GB table';
  }

  // 10. Route 53
  else if (serviceId === 'route53') {
    lineItems.push({
      name: 'Hosted Zone Fee',
      detail: '$0.50 per hosted zone / month',
      cost: 0.50
    });
    lineItems.push({
      name: 'DNS Queries',
      detail: `$0.40 per 1M queries (${trafficMultiplier}x traffic)`,
      cost: 0.40 * trafficMultiplier
    });
    configSummary = 'Public Hosted Zone';
  }

  // 11. Amazon EKS
  else if (serviceId === 'eks') {
    lineItems.push({
      name: 'EKS Cluster Management Fee',
      detail: '$0.10/hour × 730 hours (AWS control plane)',
      cost: 73.00
    });
    configSummary = 'Managed Control Plane';
  }

  // 12. Amazon ElastiCache
  else if (serviceId === 'elasticache') {
    const hourly = 0.016; // cache.t4g.micro
    const nodeCost = hourly * HOURS_PER_MONTH * replicas;
    lineItems.push({
      name: `ElastiCache Redis: cache.t4g.micro × ${replicas} node(s)`,
      detail: `$0.016/hr × 730 hrs`,
      cost: nodeCost
    });
    configSummary = `Redis cache.t4g.micro, ${replicas} node(s)`;
  }

  // 13. AWS WAF
  else if (serviceId === 'waf') {
    lineItems.push({
      name: 'AWS WAF Web ACL',
      detail: '$5.00/mo Web ACL + $3.00 for 3 managed rule groups',
      cost: 8.00
    });
    configSummary = 'Web ACL + 3 Managed Rules';
  }

  // 14. Clients and Gateways with zero/minimal fees
  else if (['user', 'client_ui', 'api_client'].includes(serviceId)) {
    lineItems.push({
      name: 'Client Actor',
      detail: 'External traffic actor (no AWS hosting charges)',
      cost: 0.00
    });
    configSummary = 'External Client Actor';
  } else if (serviceId === 'igw' || serviceId === 'internet_gateway') {
    lineItems.push({
      name: 'Internet Gateway',
      detail: 'Free VPC component (bandwidth billed to EC2/ALB)',
      cost: 0.00
    });
    configSummary = 'VPC Attached Gateway (Free)';
  } else if (serviceId === 's3_gateway' || serviceId === 'vpc_endpoint') {
    lineItems.push({
      name: 'Gateway VPC Endpoint',
      detail: 'Free AWS Gateway Endpoint for S3 / DynamoDB (saves NAT fees!)',
      cost: 0.00
    });
    configSummary = 'Free Gateway VPC Endpoint';
  }

  // Baseline fallback for any other AWS catalog service
  else {
    const baselineMonthly = 5.00 * replicas;
    lineItems.push({
      name: `${label} Managed Service Provisioning`,
      detail: `Standard baseline estimated usage × ${replicas} instance(s)`,
      cost: baselineMonthly
    });
    configSummary = `Standard managed resource (${replicas} unit)`;
  }

  const monthlyCost = lineItems.reduce((sum, item) => sum + item.cost, 0);
  const hourlyCost = monthlyCost / HOURS_PER_MONTH;

  return {
    nodeId: node.id,
    nodeName: label,
    serviceId,
    category,
    monthlyCost,
    hourlyCost,
    lineItems,
    configurationSummary: configSummary,
    freeTierEligible
  };
}

/**
 * Calculates the complete architecture-wide AWS bill report, category distribution,
 * and FinOps optimization tips.
 */
export function calculateArchitectureCost(
  nodes: Node<any>[],
  trafficLevel = 'normal'
): ArchitectureCostReport {
  const serviceNodes = nodes.filter(n => n.type === 'serviceNode' || (n.type !== 'boundaryNode' && (n.data as any)?.serviceId));
  const trafficMultiplier = getTrafficScaleFactor(trafficLevel);

  const nodeCosts: NodeCostEstimate[] = serviceNodes.map(node => calculateNodeCost(node, trafficMultiplier));

  let monthlyTotal = 0;
  const byCategory: Record<string, number> = {};

  for (const nc of nodeCosts) {
    monthlyTotal += nc.monthlyCost;
    byCategory[nc.category] = (byCategory[nc.category] || 0) + nc.monthlyCost;
  }

  const hourlyTotal = monthlyTotal / HOURS_PER_MONTH;
  const annualTotal = monthlyTotal * 12;

  // Generate actionable FinOps cost optimization tips
  const recommendations: FinOpsTip[] = [];

  // Tip 1: NAT Gateway cost check
  const natNodes = serviceNodes.filter(n => n.data.serviceId === 'nat_gateway');
  const s3Nodes = serviceNodes.filter(n => n.data.serviceId === 's3' || n.data.serviceId === 's3_client');
  const s3Endpoints = serviceNodes.filter(n => n.data.serviceId === 's3_gateway');

  if (natNodes.length > 0 && s3Nodes.length > 0 && s3Endpoints.length === 0) {
    recommendations.push({
      id: 'tip-s3-gateway-endpoint',
      severity: 'high',
      title: 'Add Free S3 Gateway VPC Endpoint',
      description: 'Your architecture has a NAT Gateway ($32.40/mo + $0.045/GB) and S3 storage. Adding an S3 Gateway Endpoint routes S3 traffic directly over the AWS private network for FREE, completely eliminating NAT data processing fees.',
      estimatedMonthlySavings: 15.00 * trafficMultiplier,
      affectedNodeIds: natNodes.map(n => n.id)
    });
  }

  // Tip 2: EC2 Compute Savings Plans
  const onDemandEc2 = serviceNodes.filter(n => n.data.serviceId === 'ec2' && (!n.data.customConfig?.purchasingOption || n.data.customConfig.purchasingOption === 'on_demand'));
  if (onDemandEc2.length >= 2) {
    const ec2Cost = onDemandEc2.reduce((sum, n) => {
      const nc = nodeCosts.find(c => c.nodeId === n.id);
      return sum + (nc?.monthlyCost || 0);
    }, 0);
    const potentialSavings = ec2Cost * 0.35;
    recommendations.push({
      id: 'tip-savings-plans',
      severity: 'medium',
      title: 'Commit to 1-Year Compute Savings Plans',
      description: `You have ${onDemandEc2.length} EC2 instances running on standard On-Demand pricing. Committing to a 1-year Compute Savings Plan reduces hourly compute costs by up to 35%.`,
      estimatedMonthlySavings: potentialSavings,
      affectedNodeIds: onDemandEc2.map(n => n.id)
    });
  }

  // Tip 3: Graviton Adoption
  const x86Ec2 = serviceNodes.filter(n => {
    if (n.data.serviceId !== 'ec2') return false;
    const inst = n.data.customConfig?.instanceType || 't3.micro';
    return !inst.includes('g.'); // m6g is graviton, t3/m6i/c6i are x86
  });
  if (x86Ec2.length > 0) {
    recommendations.push({
      id: 'tip-graviton',
      severity: 'info',
      title: 'Upgrade to AWS Graviton Processors (m6g / c7g)',
      description: 'AWS Graviton-based ARM instances deliver up to 40% better price performance and are ~20% cheaper than comparable x86 instances.',
      estimatedMonthlySavings: 12.00 * x86Ec2.length,
      affectedNodeIds: x86Ec2.map(n => n.id)
    });
  }

  // Tip 4: S3 Intelligent-Tiering
  const standardS3 = serviceNodes.filter(n => (n.data.serviceId === 's3' || n.data.serviceId === 's3_managed') && (!n.data.customConfig?.storageClass || n.data.customConfig.storageClass === 'STANDARD'));
  if (standardS3.length > 0) {
    recommendations.push({
      id: 'tip-s3-tiering',
      severity: 'info',
      title: 'Enable S3 Intelligent-Tiering',
      description: 'Objects in S3 Standard that are not accessed for 30+ days can automatically shift to infrequent and archive access tiers, saving up to 68% on storage fees with zero retrieval penalties.',
      estimatedMonthlySavings: 8.00,
      affectedNodeIds: standardS3.map(n => n.id)
    });
  }

  return {
    monthlyTotal: Math.round(monthlyTotal * 100) / 100,
    hourlyTotal: Math.round(hourlyTotal * 1000) / 1000,
    annualTotal: Math.round(annualTotal * 100) / 100,
    byCategory,
    nodeCosts,
    trafficMultiplier,
    trafficLevelName: trafficLevel.toUpperCase(),
    recommendations
  };
}
