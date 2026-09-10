import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData, BottleneckItem } from '../../types/index.ts';

export function detectBottlenecks(
  nodes: Node<ServiceNodeData>[],
  edges: Edge<ConnectionData>[]
): BottleneckItem[] {
  const bottlenecks: BottleneckItem[] = [];

  const rdsNodes = nodes.filter(n => n.data.serviceId === 'rds');
  const computeNodes = nodes.filter(n => ['ecs', 'ec2', 'lambda'].includes(n.data.serviceId));
  const queueNodes = nodes.filter(n => n.data.serviceId === 'sqs');
  const cacheNodes = nodes.filter(n => n.data.serviceId === 'elasticache');
  const cdnNodes = nodes.filter(n => n.data.serviceId === 'cloudfront');

  // 1. High Compute to Single RDS bottleneck (Connection Pool Exhaustion)
  const totalComputeCapacity = computeNodes.reduce((sum, n) => sum + (n.data.replicas || 1), 0);
  for (const rds of rdsNodes) {
    if (totalComputeCapacity >= 4 && cacheNodes.length === 0) {
      bottlenecks.push({
        nodeId: rds.id,
        nodeName: rds.data.label,
        severity: 'HIGH',
        title: 'Database Connection & Throughput Contention',
        explanation: `${totalComputeCapacity} compute tasks/instances connect directly to a single relational database without an in-memory cache or RDS Proxy. Under peak traffic, open DB connections will exhaust connection pool limits (max_connections), causing queueing and timeouts.`,
        mitigation: 'Introduce Amazon ElastiCache (Redis) to absorb read queries, and configure Amazon RDS Proxy to pool and share database connections.'
      });
    }
  }

  // 2. Synchronous Coupling without Asynchronous Buffer
  const hasDirectSynchronousWrite = edges.some(e => {
    const src = nodes.find(n => n.id === e.source);
    const tgt = nodes.find(n => n.id === e.target);
    return src && tgt && ['ecs', 'ec2', 'lambda'].includes(src.data.serviceId) && tgt.data.serviceId === 'rds' && e.data?.interactionType === 'synchronous';
  });

  if (hasDirectSynchronousWrite && queueNodes.length === 0) {
    const rds = rdsNodes[0];
    if (rds) {
      bottlenecks.push({
        nodeId: rds.id,
        nodeName: rds.data.label,
        severity: 'MEDIUM',
        title: 'Unbuffered Synchronous Write Bottleneck',
        explanation: 'Workloads execute synchronous SQL writes directly from frontend API workers to the database. Sudden traffic spikes will immediately overwhelm disk IOPS and lock tables.',
        mitigation: 'Decouple high-volume write traffic using an Amazon SQS queue. Return an instant 202 Accepted to clients and let background workers consume messages at a controlled rate.'
      });
    }
  }

  // 3. Static Assets Served from Origin without Edge Caching
  if (cdnNodes.length === 0 && computeNodes.length > 0) {
    const compute = computeNodes[0];
    bottlenecks.push({
      nodeId: compute.id,
      nodeName: compute.data.label,
      severity: 'LOW',
      title: 'Missing Edge CDN (Origin Compute Load)',
      explanation: 'Without CloudFront at the edge, every static asset request (HTML, CSS, images) hits backend compute servers directly, wasting CPU cycles and networking bandwidth.',
      mitigation: 'Deploy Amazon CloudFront in front of your ALB or S3 bucket to cache static assets close to end users worldwide.'
    });
  }

  return bottlenecks;
}
