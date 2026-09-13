import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData } from '../../types/index.ts';
import { makeFinding, type Finding } from '../findings.ts';
import { detectSPOFs } from './spofDetector.ts';
import { detectBottlenecks } from './bottleneckDetector.ts';
import { detectPublicExposure } from './publicExposure.ts';
import { detectMissingRedundancy } from './redundancy.ts';
import { detectDependencyConcentration } from './concentration.ts';
import { detectBlastRadius } from './blastRadius.ts';

export { detectPublicExposure, detectMissingRedundancy, detectDependencyConcentration, detectBlastRadius };

const EDGE_SERVICE_IDS = ['alb', 'cloudfront'];

/** Missing compensating controls at the edge - distinct from `detectPublicExposure` (which is
 *  about a resource being directly *reachable*): these are about traffic that reaches a resource
 *  exactly as intended, over a path with no Layer 7 protection or no encryption in transit. */
function detectSecurityRisks(nodes: Node<ServiceNodeData>[], edges: Edge<ConnectionData>[]): Finding[] {
  const findings: Finding[] = [];
  const serviceNodes = nodes.filter(n => n.type !== 'boundaryNode');

  const edgeEntryNodes = serviceNodes.filter(n => EDGE_SERVICE_IDS.includes(n.data.serviceId));
  const hasWaf = serviceNodes.some(n => n.data.serviceId === 'waf');
  if (edgeEntryNodes.length > 0 && !hasWaf) {
    findings.push(makeFinding('architecture', 'security_risk', {
      severity: 'MEDIUM',
      resource: edgeEntryNodes.map(n => n.data.label).join(', '),
      resourceId: edgeEntryNodes[0].id,
      problem: `No AWS WAF is attached to any public entry point (${edgeEntryNodes.map(n => n.data.label).join(', ')}).`,
      whyItMatters: 'Without a Web Application Firewall, common Layer 7 exploits (SQL injection, XSS, request floods) reach the application tier directly instead of being filtered at the edge.',
      awsRule: 'AWS WAF should be attached to CloudFront distributions and Application Load Balancers that accept public traffic.',
      recommendation: `Attach AWS WAF to ${edgeEntryNodes.map(n => n.data.label).join(' and ')}.`
    }));
  }

  const httpEdges = edges.filter(e => (e.data as any)?.protocol === 'HTTP');
  if (httpEdges.length > 0) {
    const example = httpEdges[0];
    const source = serviceNodes.find(n => n.id === example.source);
    findings.push(makeFinding('architecture', 'security_risk', {
      severity: 'MEDIUM',
      resource: source?.data.label || example.source,
      resourceId: example.source,
      problem: `${httpEdges.length} connection(s) use unencrypted HTTP instead of HTTPS.`,
      whyItMatters: 'Traffic sent over plain HTTP can be read or tampered with by anything on the network path - credentials, session tokens, and response data are all exposed in transit.',
      awsRule: 'Public-facing and inter-tier connections should use HTTPS/TLS rather than HTTP.',
      recommendation: 'Switch these connections to HTTPS, terminating TLS at the load balancer or CloudFront.'
    }));
  }

  return findings;
}

export { detectSecurityRisks };

/**
 * "Is this a GOOD architecture?" - never "is this valid config" (`engine/validation`, a separate
 * question entirely: a database wide open to 0.0.0.0/0 is perfectly valid AWS config and shows up
 * here, not there) and never "did this specific request succeed" (`runSimulation`). Every check
 * here is grounded in a stated AWS constraint or resilience pattern, not a diff against any one
 * reference architecture - a design that looks different from a reference template is not, by
 * itself, a finding.
 */
export function analyzeArchitectureFindings(
  nodes: Node<ServiceNodeData>[],
  edges: Edge<ConnectionData>[]
): Finding[] {
  const spofFindings: Finding[] = detectSPOFs(nodes, edges).map(spof => makeFinding('architecture', 'spof', {
    severity: spof.impactLevel,
    resource: spof.nodeName,
    resourceId: spof.nodeId,
    problem: `${spof.nodeName} is a single point of failure (path: ${spof.impactPath.join(' -> ')}).`,
    whyItMatters: spof.explanation,
    awsRule: 'A well-architected system has no single point of failure in any tier - the loss of any one component should degrade capacity, not availability.',
    recommendation: spof.mitigation
  }));

  const bottleneckFindings: Finding[] = detectBottlenecks(nodes, edges).map(b => makeFinding('architecture', 'bottleneck', {
    severity: b.severity,
    resource: b.nodeName,
    resourceId: b.nodeId,
    problem: b.title,
    whyItMatters: b.explanation,
    awsRule: 'Capacity at each tier should scale independently and match the load the tier in front of it can actually generate, with buffering (caching, queuing) between tiers of mismatched throughput.',
    recommendation: b.mitigation
  }));

  return [
    ...spofFindings,
    ...bottleneckFindings,
    ...detectPublicExposure(nodes, edges),
    ...detectSecurityRisks(nodes, edges),
    ...detectMissingRedundancy(nodes),
    ...detectDependencyConcentration(nodes, edges),
    ...detectBlastRadius(nodes, edges)
  ];
}
