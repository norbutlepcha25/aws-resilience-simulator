import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData, ArchitectureAnalysis, SecurityAuditItem } from '../../types/index.ts';
import { detectSPOFs } from './spofDetector.ts';
import { detectBottlenecks } from './bottleneckDetector.ts';

export function analyzeArchitecture(
  nodes: Node<ServiceNodeData>[],
  edges: Edge<ConnectionData>[]
): ArchitectureAnalysis {
  const spofs = detectSPOFs(nodes, edges);
  const bottlenecks = detectBottlenecks(nodes, edges);
  const securityIssues: SecurityAuditItem[] = [];

  // Helper counters
  const computeNodes = nodes.filter(n => ['ecs', 'ec2', 'lambda'].includes(n.data.serviceId));
  const albNodes = nodes.filter(n => ['alb', 'api_gateway'].includes(n.data.serviceId));
  const rdsNodes = nodes.filter(n => n.data.serviceId === 'rds');
  const dynamoNodes = nodes.filter(n => n.data.serviceId === 'dynamodb');
  const cdnNodes = nodes.filter(n => n.data.serviceId === 'cloudfront');
  const sqsNodes = nodes.filter(n => n.data.serviceId === 'sqs');
  const cacheNodes = nodes.filter(n => n.data.serviceId === 'elasticache');
  const wafNodes = nodes.filter(n => n.data.serviceId === 'waf');
  const dnsNodes = nodes.filter(n => n.data.serviceId === 'route53');

  const totalComputeReplicas = computeNodes.reduce((sum, n) => sum + (n.data.replicas || 1), 0);
  const azsCovered = new Set(nodes.map(n => n.data.az).filter(az => az === 'AZ-A' || az === 'AZ-B' || az === 'AZ-C'));
  const hasMultiAzCompute = azsCovered.size >= 2 || computeNodes.some(n => n.data.az === 'Multi-AZ');
  const hasMultiAzDb = rdsNodes.some(n => n.data.multiAz) || dynamoNodes.length > 0;

  // ----------------------------------------------------
  // 1. AVAILABILITY (Targeting 99.9% - 99.99%)
  // ----------------------------------------------------
  let availScore = 50;
  const availPos: string[] = [];
  const availNeg: string[] = [];

  if (nodes.length === 0) {
    availScore = 0;
    availNeg.push('No services configured on canvas.');
  } else {
    if (albNodes.length > 0) {
      availScore += 15;
      availPos.push('Load Balancer / API Gateway provides managed high-availability ingress.');
    } else {
      availScore -= 15;
      availNeg.push('No managed load balancing layer detected.');
    }

    if (totalComputeReplicas >= 2) {
      availScore += 15;
      availPos.push(`Multiple compute instances running (${totalComputeReplicas} tasks/instances).`);
    } else if (computeNodes.length > 0) {
      availScore -= 15;
      availNeg.push('Single compute instance: prone to downtime during host maintenance or crash.');
    }

    if (hasMultiAzDb) {
      availScore += 20;
      availPos.push('Multi-AZ database or distributed NoSQL persistence ensures uninterrupted uptime.');
    } else if (rdsNodes.length > 0) {
      availScore -= 20;
      availNeg.push('Single-AZ database: subject to downtime during database failover or maintenance.');
    }

    if (cdnNodes.length > 0) {
      availScore += 10;
      availPos.push('CloudFront edge distribution ensures global availability even if origin encounters blips.');
    }
  }

  // ----------------------------------------------------
  // 2. RESILIENCE (Surviving and recovering from failures)
  // ----------------------------------------------------
  let resScore = 45;
  const resPos: string[] = [];
  const resNeg: string[] = [];

  if (spofs.length === 0 && nodes.length >= 3) {
    resScore += 25;
    resPos.push('Zero critical Single Points of Failure detected.');
  } else if (spofs.length > 0) {
    resScore -= spofs.length * 15;
    resNeg.push(`${spofs.length} Single Point(s) of Failure prevent resilient recovery.`);
  }

  if (sqsNodes.length > 0) {
    resScore += 15;
    resPos.push('Asynchronous SQS message queue buffers spikes and decouples failure domains.');
  }

  if (cacheNodes.length > 0) {
    resScore += 10;
    resPos.push('In-memory caching tier (ElastiCache) enables graceful degradation if database slows down.');
  }

  if (computeNodes.some(n => n.data.serviceId === 'ecs' || n.data.serviceId === 'lambda')) {
    resScore += 10;
    resPos.push('Managed container/serverless scheduler replaces failed execution units automatically.');
  }

  // ----------------------------------------------------
  // 3. FAULT TOLERANCE (Physical zone & hardware isolation)
  // ----------------------------------------------------
  let ftScore = 40;
  const ftPos: string[] = [];
  const ftNeg: string[] = [];

  if (hasMultiAzCompute && azsCovered.size >= 2) {
    ftScore += 25;
    ftPos.push(`Compute workloads distributed across independent physical Availability Zones (${Array.from(azsCovered).join(', ')}).`);
  } else if (computeNodes.length > 0) {
    ftScore -= 15;
    ftNeg.push('All compute resources reside in a single Availability Zone. Physical data center loss will cause total outage.');
  }

  if (hasMultiAzDb) {
    ftScore += 25;
    ftPos.push('Database has synchronous cross-AZ replication with automated failover.');
  } else if (rdsNodes.length > 0) {
    ftScore -= 20;
    ftNeg.push('Database lacks Multi-AZ hot standby replica.');
  }

  if (dnsNodes.length > 0) {
    ftScore += 10;
    ftPos.push('Route 53 Anycast DNS routes traffic reliably around regional impairments.');
  }

  // ----------------------------------------------------
  // 4. SCALABILITY (Handling increasing traffic loads)
  // ----------------------------------------------------
  let scaleScore = 50;
  const scalePos: string[] = [];
  const scaleNeg: string[] = [];

  if (cdnNodes.length > 0) {
    scaleScore += 20;
    scalePos.push('CloudFront offloads static and cacheable dynamic traffic from origin backend.');
  } else {
    scaleScore -= 10;
    scaleNeg.push('Origin backend bears 100% of static and dynamic asset load.');
  }

  if (albNodes.length > 0) {
    scaleScore += 15;
    scalePos.push('ALB horizontally scales across targets and terminates TLS efficiently.');
  }

  if (totalComputeReplicas >= 3 || computeNodes.some(n => n.data.serviceId === 'lambda')) {
    scaleScore += 15;
    scalePos.push('Compute layer can scale horizontally to handle concurrent traffic spikes.');
  }

  if (bottlenecks.length > 0) {
    scaleScore -= bottlenecks.length * 10;
    scaleNeg.push(`${bottlenecks.length} scalability bottleneck(s) identified.`);
  }

  // ----------------------------------------------------
  // 5. SECURITY AUDIT
  // ----------------------------------------------------
  let secScore = 60;
  const secPos: string[] = [];
  const secNeg: string[] = [];

  // Check for VPC-hosted resources not actually placed inside any subnet boundary. `subnet` is
  // derived live from canvas geometry (see engine/layout/containment.ts), so 'unassigned' means
  // the node is visually outside every Public/Private subnet box - an invalid AWS placement.
  const unassignedNodes = nodes.filter(n => n.data.subnet === 'unassigned');
  if (unassignedNodes.length > 0) {
    secScore -= 25;
    secNeg.push(`${unassignedNodes.length} resource(s) not placed inside any subnet boundary: ${unassignedNodes.map(n => n.data.label).join(', ')}.`);
    securityIssues.push({
      severity: 'CRITICAL',
      title: 'Resource Not Placed Inside a VPC Subnet',
      explanation: `${unassignedNodes.map(n => n.data.label).join(', ')} ${unassignedNodes.length === 1 ? 'is' : 'are'} not geometrically inside any Public or Private subnet boundary on the canvas. AWS requires every VPC-hosted resource to have its network interface in exactly one subnet - it will not actually be reachable.`,
      recommendation: 'Drag the resource into a Public or Private subnet boundary box.',
      affectedNodes: unassignedNodes.map(n => n.id)
    });
  }

  // Check direct database exposure
  const clientNode = nodes.find(n => n.data.serviceId === 'user');
  if (clientNode) {
    const directDbEdges = edges.filter(e => {
      const tgt = nodes.find(n => n.id === e.target);
      return e.source === clientNode.id && tgt && ['rds', 'dynamodb'].includes(tgt.data.serviceId);
    });

    if (directDbEdges.length > 0) {
      secScore -= 35;
      secNeg.push('CRITICAL: Database has direct network connection from the public Internet.');
      securityIssues.push({
        severity: 'CRITICAL',
        title: 'Database Publicly Accessible to Internet',
        explanation: 'The database is connected directly to the client/Internet tier without an intermediary API or application layer.',
        recommendation: 'Place the database in a private isolated subnet. Access must only be permitted through application compute instances.',
        affectedNodes: directDbEdges.map(e => e.target)
      });
    }
  }

  // Check database in public subnet
  for (const rds of rdsNodes) {
    if (rds.data.subnet === 'public') {
      secScore -= 20;
      secNeg.push(`${rds.data.label} is placed in a Public Subnet.`);
      securityIssues.push({
        severity: 'CRITICAL',
        title: 'Database in Public Subnet',
        explanation: 'Relational databases should never reside in public subnets with Internet Gateway routing tables.',
        recommendation: 'Move the RDS instance into private database subnets with no direct public route.',
        affectedNodes: [rds.id]
      });
    } else {
      secScore += 10;
      secPos.push(`${rds.data.label} correctly isolated in private subnet.`);
    }
  }

  // Check WAF presence
  if (wafNodes.length > 0) {
    secScore += 15;
    secPos.push('AWS WAF protects entry points against SQL injection, XSS, and layer 7 floods.');
  } else if (albNodes.length > 0 || cdnNodes.length > 0) {
    secScore -= 10;
    secNeg.push('No Web Application Firewall (WAF) attached to public entry points.');
    securityIssues.push({
      severity: 'WARNING',
      title: 'Missing Web Application Firewall (WAF)',
      explanation: 'Public ingress endpoints are vulnerable to common Layer 7 exploits like SQL injection and cross-site scripting.',
      recommendation: 'Attach AWS WAF to your CloudFront distribution or Application Load Balancer.',
      affectedNodes: albNodes.map(n => n.id).concat(cdnNodes.map(n => n.id))
    });
  }

  // Check HTTPS usage
  const unencryptedEdges = edges.filter(e => e.data?.protocol === 'HTTP');
  if (unencryptedEdges.length > 0) {
    secScore -= 10;
    secNeg.push('Unencrypted HTTP connections detected on public paths.');
  } else if (edges.length > 0) {
    secScore += 10;
    secPos.push('TLS encryption (HTTPS) enforced on ingress routes.');
  }

  // Clamp scores between 10 and 100
  const clamp = (val: number) => Math.max(10, Math.min(100, Math.round(val)));

  const finalAvail = clamp(availScore);
  const finalRes = clamp(resScore);
  const finalFt = clamp(ftScore);
  const finalScale = clamp(scaleScore);
  const finalSec = clamp(secScore);

  const averageScore = (finalAvail + finalRes + finalFt + finalScale) / 4;
  let overallRating: 'Resilient' | 'Moderate' | 'Fragile' | 'Incomplete' = 'Moderate';

  if (nodes.length < 3) {
    overallRating = 'Incomplete';
  } else if (averageScore >= 80 && spofs.length === 0) {
    overallRating = 'Resilient';
  } else if (averageScore < 60 || spofs.length >= 2) {
    overallRating = 'Fragile';
  }

  let summary = '';
  if (overallRating === 'Resilient') {
    summary = 'Excellent architecture! Multi-tier redundancy, managed load balancing, and zone isolation provide strong enterprise resilience.';
  } else if (overallRating === 'Moderate') {
    summary = 'Solid foundation, but critical resilience gaps remain. Focus on eliminating single points of failure and configuring multi-AZ redundancy.';
  } else if (overallRating === 'Fragile') {
    summary = 'High risk of catastrophic downtime. Single points of failure will cause total service outages during maintenance or component failures.';
  } else {
    summary = 'Architecture is still in early construction. Connect key components to perform full evaluation.';
  }

  return {
    availability: { score: finalAvail, positiveReasons: availPos, negativeReasons: availNeg },
    resilience: { score: finalRes, positiveReasons: resPos, negativeReasons: resNeg },
    faultTolerance: { score: finalFt, positiveReasons: ftPos, negativeReasons: ftNeg },
    scalability: { score: finalScale, positiveReasons: scalePos, negativeReasons: scaleNeg },
    security: { score: finalSec, positiveReasons: secPos, negativeReasons: secNeg },
    spofs,
    bottlenecks,
    securityIssues,
    overallRating,
    summary
  };
}
