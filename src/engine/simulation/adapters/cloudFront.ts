import type { AdapterContext, AdapterSignal } from './types.ts';
import { CONTINUE, TERMINATE } from './types.ts';

/** CloudFront edge caching: a cache HIT never contacts the origin at all and ends the request
 *  right here; a cache MISS narrates the forward-to-origin step and falls through to whatever
 *  hop-resolution logic actually forwards the request. */
export const cloudFrontAdapter = (ctx: AdapterContext): AdapterSignal => {
  const { trace, node, scenario, downstreamNodes } = ctx;

  if (node.data.serviceId !== 'cloudfront') {
    return CONTINUE;
  }

  const isStaticPath = scenario.path.includes('/static') || scenario.path.endsWith('.png') || scenario.path.endsWith('.js') || scenario.path.endsWith('.css');

  if (node.data.customConfig?.cacheState === 'hit' || (node.data.customConfig?.cacheState === undefined && isStaticPath)) {
    trace.pushStep({
      sourceNodeId: node.id,
      targetNodeId: node.id,
      sourceNodeName: node.data.label,
      targetNodeName: node.data.label,
      protocol: 'HTTPS',
      action: 'Edge Cache HIT',
      status: 'success',
      explanation: `CloudFront edge location evaluated request for '${scenario.path}'. Cache HIT (Age: 320s). Served directly from edge PoP with 8ms latency without contacting origin!`,
      targetHealth: node.data.health,
      latencyMs: 8,
      details: { cacheHit: true, statusCode: 200 }
    });
    trace.advanceTime(8);
    trace.succeed(200, 'Request served instantly by CloudFront Edge Cache (Origin offloaded).');
    return TERMINATE;
  }

  trace.pushStep({
    sourceNodeId: node.id,
    targetNodeId: downstreamNodes[0]?.id || node.id,
    sourceNodeName: node.data.label,
    targetNodeName: downstreamNodes[0]?.data.label || 'Origin',
    protocol: 'HTTPS',
    action: 'Edge Cache MISS -> Forwarding to Origin',
    status: 'success',
    explanation: `CloudFront cache MISS for dynamic route '${scenario.path}'. Forwarding request to origin backend.`,
    targetHealth: node.data.health,
    latencyMs: 15,
    details: { cacheHit: false }
  });
  trace.advanceTime(15);
  return CONTINUE;
};
