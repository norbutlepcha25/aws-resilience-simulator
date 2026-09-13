import type { AdapterContext, AdapterSignal } from './types.ts';
import { CONTINUE, TERMINATE } from './types.ts';

/**
 * Executes ECS application API calls as child operations. A child call produces trace steps on
 * its own edge and then returns control to ECS, so it does not replace the image request's next
 * forwarding hop. This first bounded behavior models required DynamoDB policy lookups only.
 */
export const ecsDependencyCallsAdapter = (ctx: AdapterContext): AdapterSignal => {
  const { node, nodes, dependencyEdges, trace, pushFirewallBlockIfAny } = ctx;
  if (node.data.serviceId !== 'ecs') return CONTINUE;

  const calls = dependencyEdges
    .map(edge => ({ edge, target: nodes.find(candidate => candidate.id === edge.target) }))
    .filter(call => call.target?.data.serviceId === 'dynamodb');

  for (const { edge, target } of calls) {
    if (!target) continue;
    const required = edge.data?.dependencyRequired !== false;

    if (target.data.health === 'failed') {
      trace.pushStep({
        sourceNodeId: node.id,
        targetNodeId: target.id,
        sourceNodeName: node.data.label,
        targetNodeName: target.data.label,
        protocol: 'HTTPS',
        action: 'DynamoDB policy lookup failed',
        status: required ? 'failed' : 'bypassed',
        explanation: `${target.data.label} is unavailable. ${required ? 'The required ECS policy lookup cannot complete, so image processing stops.' : 'This optional lookup is skipped.'}`,
        targetHealth: target.data.health,
        latencyMs: edge.data?.timeoutMs ?? 1500,
        details: { statusCode: required ? 503 : undefined, failureReason: 'DynamoDB dependency unavailable.' }
      });
      trace.advanceTime(edge.data?.timeoutMs ?? 1500);
      if (required) {
        trace.fail(503, `Request failed: required DynamoDB dependency ${target.data.label} is unavailable.`);
        return TERMINATE;
      }
      continue;
    }

    // This shared gate records any NACL, SG, and IAM decisions on the dependency edge.
    if (pushFirewallBlockIfAny(node, target, edge.data?.protocol || 'HTTPS')) return TERMINATE;

    trace.pushStep({
      sourceNodeId: node.id,
      targetNodeId: target.id,
      sourceNodeName: node.data.label,
      targetNodeName: target.data.label,
      protocol: edge.data?.protocol || 'HTTPS',
      action: edge.data?.label || 'Read transformation policy',
      status: 'success',
      explanation: `${node.data.label} read transformation policy and origin mapping data from ${target.data.label}, then returned to image processing. In-memory cache behavior is represented by whether this dependency call is enabled for the scenario.`,
      targetHealth: target.data.health,
      latencyMs: 12,
      details: { statusCode: 200, dependencyCall: true, returnsToNodeId: node.id }
    });
    trace.advanceTime(12);
  }

  return CONTINUE;
};
