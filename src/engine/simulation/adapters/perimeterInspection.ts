import type { AdapterContext, AdapterSignal } from './types.ts';
import { CONTINUE, TERMINATE } from './types.ts';

/**
 * AWS WAF performs Layer 7 (HTTP request content) inspection; AWS Shield protects against Layer
 * 3/4 volumetric/protocol DDoS and does NOT perform this kind of signature-based request
 * inspection - the two are deliberately not modeled as the same check (a `shield` node is
 * inert here and simply falls through).
 */
export const perimeterInspectionAdapter = (ctx: AdapterContext): AdapterSignal => {
  const { trace, node, scenario } = ctx;

  if (node.data.serviceId !== 'waf') {
    return CONTINUE;
  }

  const isMalicious = /sql|select|insert|delete|drop|admin|eval|script/i.test(scenario.path);

  if (isMalicious) {
    trace.pushStep({
      sourceNodeId: node.id,
      targetNodeId: node.id,
      sourceNodeName: node.data.label,
      targetNodeName: node.data.label,
      protocol: 'HTTPS',
      action: 'AWS WAF: Malicious Pattern Blocked',
      status: 'failed',
      explanation: `AWS WAF Core Rule Set (CRS) detected SQL injection / exploit pattern in '${scenario.path}'. Packet blocked at the perimeter with HTTP 403 Forbidden. Backend origin protected!`,
      targetHealth: 'healthy',
      latencyMs: 4,
      details: {
        statusCode: 403,
        failureReason: 'WAF OWASP Top 10 rule trigger (SQL Injection / unauthorized endpoint).'
      }
    });
    trace.fail(403, 'Request blocked at perimeter by AWS WAF security rules.');
    return TERMINATE;
  }

  trace.pushStep({
    sourceNodeId: node.id,
    targetNodeId: node.id,
    sourceNodeName: node.data.label,
    targetNodeName: node.data.label,
    protocol: 'HTTPS',
    action: 'AWS WAF: Inspection Passed',
    status: 'success',
    explanation: `AWS WAF inspected headers and payload for '${scenario.path}'. Request validated against rate limits and SQLi/XSS inspection. Passing to origin.`,
    targetHealth: 'healthy',
    latencyMs: 3
  });
  trace.advanceTime(3);
  return CONTINUE;
};
