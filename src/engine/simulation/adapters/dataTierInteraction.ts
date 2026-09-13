import type { AdapterContext, AdapterSignal } from './types.ts';
import { CONTINUE, TERMINATE } from './types.ts';

const COMPUTE_SERVICE_IDS = ['ecs', 'ec2', 'lambda', 'fargate'];
const DB_SERVICE_IDS = ['rds', 'dynamodb', 'aurora'];

/** Compute node interacting with a database, cache, or queue: DB Multi-AZ failover / cache
 *  fallback / hard failure, or SQS enqueue-and-decouple. */
export const dataTierInteractionAdapter = (ctx: AdapterContext): AdapterSignal => {
  const { trace, node, downstreamNodes, outgoingEdges, pushFirewallBlockIfAny } = ctx;

  if (!COMPUTE_SERVICE_IDS.includes(node.data.serviceId)) {
    return CONTINUE;
  }

  const dbTarget = downstreamNodes.find(n => DB_SERVICE_IDS.includes(n.data.serviceId));
  const cacheTarget = downstreamNodes.find(n => n.data.serviceId === 'elasticache');
  const queueTarget = downstreamNodes.find(n => n.data.serviceId === 'sqs');

  if (dbTarget) {
    const dbEdgeProtocol = outgoingEdges.find(e => e.target === dbTarget.id)?.data?.protocol || 'SQL';
    if (pushFirewallBlockIfAny(node, dbTarget, dbEdgeProtocol)) {
      return TERMINATE;
    }

    if (dbTarget.data.health === 'failed') {
      const isMultiAzDb = dbTarget.data.multiAz || dbTarget.data.az === 'Multi-AZ' || dbTarget.data.serviceId === 'aurora';

      if (isMultiAzDb) {
        trace.pushStep({
          sourceNodeId: node.id,
          targetNodeId: dbTarget.id,
          sourceNodeName: node.data.label,
          targetNodeName: dbTarget.data.label,
          protocol: 'SQL',
          action: 'Multi-AZ Automated Database Failover',
          status: 'success',
          explanation: `Primary DB in ${dbTarget.data.az || 'AZ-A'} failed. Amazon RDS Multi-AZ automated failover detected heartbeat loss: Promoted synchronous standby replica in secondary AZ to primary writer via DNS CNAME update (~35 seconds). Zero data loss!`,
          targetHealth: 'healthy',
          latencyMs: 45,
          details: {
            recoveryApplied: 'Multi-AZ automated failover restored database connectivity without data loss.'
          }
        });
        trace.advanceTime(45);
        trace.markSuccess('Request succeeded: Multi-AZ database automatically failed over to standby replica.');
        return TERMINATE;
      }

      if (cacheTarget && cacheTarget.data.health === 'healthy') {
        trace.pushStep({
          sourceNodeId: node.id,
          targetNodeId: cacheTarget.id,
          sourceNodeName: node.data.label,
          targetNodeName: cacheTarget.data.label,
          protocol: 'TCP',
          action: 'Database Failure -> Cache Fallback',
          status: 'success',
          explanation: `Primary database [${dbTarget.data.label}] failed. ${node.data.label} activated circuit breaker and successfully fetched cached records from ${cacheTarget.data.label}!`,
          targetHealth: 'healthy',
          latencyMs: 15,
          details: {
            recoveryApplied: 'Circuit breaker cache fallback preserved partial application availability.'
          }
        });
        trace.advanceTime(15);
        trace.markSuccess('Request succeeded via ElastiCache fallback despite primary database failure.');
        return TERMINATE;
      }

      trace.pushStep({
        sourceNodeId: node.id,
        targetNodeId: dbTarget.id,
        sourceNodeName: node.data.label,
        targetNodeName: dbTarget.data.label,
        protocol: 'SQL',
        action: 'Database Connection Timeout',
        status: 'failed',
        explanation: `CRITICAL ERROR: ${node.data.label} attempted SQL query against ${dbTarget.data.label}. Connection timed out after 5000ms. Single-AZ database node is FAILED. Application cannot retrieve required relational data.`,
        targetHealth: 'failed',
        latencyMs: 5000,
        details: {
          statusCode: 504,
          failureReason: 'Single-AZ Database instance is down and has no standby replica.'
        }
      });
      trace.fail(504, `Request failed: Database ${dbTarget.data.label} is offline and has no Multi-AZ replica.`);
      return TERMINATE;
    }
  }

  if (queueTarget) {
    if (ctx.enforceIam && pushFirewallBlockIfAny(node, queueTarget, 'HTTPS')) return TERMINATE;
    trace.pushStep({
      sourceNodeId: node.id,
      targetNodeId: queueTarget.id,
      sourceNodeName: node.data.label,
      targetNodeName: queueTarget.data.label,
      protocol: 'Message',
      action: 'Enqueue Asynchronous Message',
      status: 'success',
      explanation: `Successfully published message payload to ${queueTarget.data.label}. Web tier responded 202 Accepted immediately, decoupling client from background execution!`,
      targetHealth: queueTarget.data.health,
      latencyMs: 18,
      details: { statusCode: 202 }
    });
    trace.advanceTime(18);
    trace.succeed(202, `Asynchronous message successfully enqueued into ${queueTarget.data.label}. Decoupled processing guaranteed.`);
    return TERMINATE;
  }

  return CONTINUE;
};
