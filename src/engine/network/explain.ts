// Renders one hop's full network decision as the plain-text explainability block requested for
// this engine: Route / NACL / Security Group / RESULT, each line naming what was evaluated and
// what was decided. Used by tests and by anything that wants a single human-readable summary of
// a `NetworkDecisionTrace` (see types.ts) instead of walking its structured fields by hand.
import type { NetworkDecisionTrace } from './types.ts';

export function formatDecisionTrace(trace: NetworkDecisionTrace): string {
  const lines: string[] = [];

  if (trace.route) {
    lines.push('Route:');
    lines.push(
      trace.route.selectedRoute
        ? `${trace.route.selectedRoute.destinationCidr} → ${trace.route.selectedRoute.target.type}`
        : `${trace.route.destination} → NO ROUTE`
    );
    lines.push('');
  }

  if (trace.nacl) {
    lines.push('NACL:');
    lines.push(`Rule ${trace.nacl.decidingRule.ruleNumber} → ${trace.nacl.blocked ? 'DENY' : 'ALLOW'}`);
    lines.push('');
  }

  if (trace.securityGroup) {
    lines.push('Security Group:');
    const label = trace.securityGroup.matchedRule
      ? `${trace.securityGroup.matchedRule.protocol} ${trace.securityGroup.matchedRule.portRange}`
      : trace.packet.protocol;
    lines.push(`${label} → ${trace.securityGroup.allowed ? 'ALLOW' : 'DENY'}`);
    lines.push('');
  }

  lines.push('RESULT:');
  lines.push(trace.allowed ? 'NETWORK CONNECTION ALLOWED' : 'NETWORK CONNECTION DENIED');

  return lines.join('\n');
}
