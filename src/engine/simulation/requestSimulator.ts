import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData, ConnectionData, SimulationScenario, SimulationResult, SimulationStep, NodeHealth } from '../../types/index.ts';
import { checkNetworkFirewalls } from './networkFirewalls.ts';

export function runSimulation(
  nodes: Node<ServiceNodeData>[],
  edges: Edge<ConnectionData>[],
  scenario: SimulationScenario
): SimulationResult {
  const steps: SimulationStep[] = [];
  let currentTimestamp = 0;
  let stepNumber = 1;
  let overallSuccess = true;
  let finalStatusCode = 200;
  let finalSummary = 'Request successfully processed across all architectural tiers.';
  const bottlenecksDetected: string[] = [];
  let cascadeOccurred = false;

  const boundaryNodes = nodes.filter(n => n.type === 'boundaryNode');

  // Find start node strictly among service nodes (never a boundary container)
  const serviceNodes = nodes.filter(n => n.type === 'serviceNode' || (!n.type && (n.data as any)?.serviceId));
  let startNode = serviceNodes.find(n => n.id === scenario.startNodeId);
  if (!startNode) {
    startNode = serviceNodes.find(n => ['user', 'client_ui', 'api_client'].includes(n.data?.serviceId))
      || serviceNodes.find(n => ['internet_gateway', 'cloudfront', 'route53', 'alb', 'api_gateway'].includes(n.data?.serviceId))
      || serviceNodes[0];
  }

  if (!startNode) {
    return {
      scenario,
      steps: [],
      success: false,
      totalLatencyMs: 0,
      statusCode: 400,
      summary: 'Canvas has no active AWS services. Add services and connect them to simulate requests.',
      bottlenecksDetected: [],
      cascadeOccurred: false
    };
  }

  // Traversal tracker
  const visited = new Set<string>();
  // Hop budget guards against routing cycles. Counting unique visited nodes is not
  // enough: a cycle such as A -> B -> A never grows `visited`, so it would spin forever.
  const MAX_HOPS = 40;
  let hops = 0;
  let currentNode = startNode;

  // Step 1: User initiated request
  steps.push({
    id: `step-${stepNumber++}`,
    stepNumber: steps.length + 1,
    timestampMs: currentTimestamp,
    sourceNodeId: 'client-env',
    targetNodeId: currentNode.id,
    sourceNodeName: 'Client Application',
    targetNodeName: currentNode.data.label,
    protocol: 'HTTPS',
    action: `Issued ${scenario.method} ${scenario.path}`,
    status: 'success',
    explanation: `Client initiated ${scenario.method} ${scenario.path} under ${scenario.trafficLevel.toUpperCase()} traffic load.`,
    targetHealth: currentNode.data.health,
    latencyMs: 5
  });

  currentTimestamp += 5;

  // Shared by every hop that can be gated by a Network ACL or Security Group (ALB->target,
  // compute->database, and the generic direct-connection path). Pushes one step per configured
  // layer that actually gets evaluated (NACL first, then Security Group, matching real packet
  // order) - a failure step for whichever layer blocks first, or an informational "allowed"
  // step when a layer has explicit rules and lets the traffic through, so the mechanism is
  // visible in the trace either way. A layer with no rules configured produces no step at all,
  // so every other reference architecture (none of which set these fields) is unaffected.
  // Returns whether the caller should stop traversal.
  const pushFirewallBlockIfAny = (source: Node<ServiceNodeData>, target: Node<ServiceNodeData>, protocol: string): boolean => {
    const firewall = checkNetworkFirewalls(protocol, target, boundaryNodes);

    for (const layer of [
      { name: 'Network ACL' as const, result: firewall.nacl },
      { name: 'Security Group' as const, result: firewall.securityGroup }
    ]) {
      if (!layer.result.evaluated) continue;

      steps.push({
        id: `step-${stepNumber++}`,
        stepNumber: steps.length + 1,
        timestampMs: currentTimestamp,
        sourceNodeId: source.id,
        targetNodeId: target.id,
        sourceNodeName: source.data.label,
        targetNodeName: target.data.label,
        protocol: protocol as any,
        action: layer.result.blocked ? `${layer.name} Blocked Traffic` : `${layer.name}: Traffic Allowed`,
        status: layer.result.blocked ? 'failed' : 'success',
        explanation: layer.result.blocked ? `PACKET BLOCKED: ${layer.result.note}` : layer.result.note!,
        targetHealth: layer.result.blocked ? 'failed' : target.data.health,
        latencyMs: layer.result.blocked ? 5 : 2,
        details: layer.result.blocked
          ? { statusCode: 403, failureReason: layer.result.note }
          : undefined
      });

      if (layer.result.blocked) {
        overallSuccess = false;
        finalStatusCode = 403;
        finalSummary = `Request blocked by ${layer.name} on ${layer.result.boundaryLabel}: ${target.data.label} never received the ${protocol} request.`;
        return true;
      }

      currentTimestamp += 2;
    }

    return false;
  };

  while (currentNode) {
    if (++hops > MAX_HOPS) {
      steps.push({
        id: `step-${stepNumber++}`,
        stepNumber: steps.length + 1,
        timestampMs: currentTimestamp,
        sourceNodeId: currentNode.id,
        targetNodeId: currentNode.id,
        sourceNodeName: currentNode.data.label,
        targetNodeName: currentNode.data.label,
        protocol: 'HTTP',
        action: 'Routing Loop Detected',
        status: 'failed',
        explanation: `Loop detected: Request traversed more than ${MAX_HOPS} hops without reaching a terminal service. Check your connections for a cycle (for example A -> B -> A).`,
        targetHealth: 'failed',
        latencyMs: 10,
        details: { statusCode: 508, failureReason: 'Infinite loop in architecture routing.' }
      });
      overallSuccess = false;
      finalStatusCode = 508;
      finalSummary = 'Routing loop detected in architecture.';
      break;
    }

    visited.add(currentNode.id);

    // Check if current node is failed
    if (currentNode.data.health === 'failed') {
      const failReason = currentNode.data.failureReason || `${currentNode.data.label} is offline / unresponsive.`;
      steps.push({
        id: `step-${stepNumber++}`,
        stepNumber: steps.length + 1,
        timestampMs: currentTimestamp,
        sourceNodeId: currentNode.id,
        targetNodeId: currentNode.id,
        sourceNodeName: currentNode.data.label,
        targetNodeName: currentNode.data.label,
        protocol: 'HTTP',
        action: 'Service Down Failure',
        status: 'failed',
        explanation: `FAILED: Request halted at ${currentNode.data.label}. Reason: ${failReason}`,
        targetHealth: 'failed',
        latencyMs: 100,
        details: {
          statusCode: 503,
          failureReason: failReason
        }
      });
      overallSuccess = false;
      finalStatusCode = 503;
      finalSummary = `Request failed at ${currentNode.data.label}: Node is marked as FAILED.`;
      break;
    }

    // Check current node's actual canvas placement. A node's `subnet` is derived live from
    // whichever Public/Private subnet boundary it geometrically sits inside (see
    // engine/layout/containment.ts) - 'unassigned' means it is not inside any subnet at all,
    // which AWS would never allow for a resource that requires an ENI in a subnet.
    if (currentNode.data.subnet === 'unassigned') {
      steps.push({
        id: `step-${stepNumber++}`,
        stepNumber: steps.length + 1,
        timestampMs: currentTimestamp,
        sourceNodeId: currentNode.id,
        targetNodeId: currentNode.id,
        sourceNodeName: currentNode.data.label,
        targetNodeName: currentNode.data.label,
        protocol: 'TCP',
        action: 'Invalid Placement: Not Inside Any Subnet',
        status: 'failed',
        explanation: `ARCHITECTURE ERROR: ${currentNode.data.label} is not placed inside any Public or Private subnet boundary on the canvas. Every VPC-hosted resource must have its network interface in exactly one subnet - drag it into a subnet box to make it reachable.`,
        targetHealth: 'failed',
        latencyMs: 0,
        details: {
          statusCode: 400,
          failureReason: `${currentNode.data.label} is not geometrically placed inside a subnet boundary.`
        }
      });
      overallSuccess = false;
      finalStatusCode = 400;
      finalSummary = `Request failed: ${currentNode.data.label} is not placed inside any VPC subnet.`;
      break;
    }

    // =========================================================================
    // BEHAVIOR 1: WAF & Perimeter Inspection
    // =========================================================================
    if (['waf', 'shield'].includes(currentNode.data.serviceId)) {
      const isMalicious = /sql|select|insert|delete|drop|admin|eval|script/i.test(scenario.path);
      if (isMalicious) {
        steps.push({
          id: `step-${stepNumber++}`,
          stepNumber: steps.length + 1,
          timestampMs: currentTimestamp,
          sourceNodeId: currentNode.id,
          targetNodeId: currentNode.id,
          sourceNodeName: currentNode.data.label,
          targetNodeName: currentNode.data.label,
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
        overallSuccess = false;
        finalStatusCode = 403;
        finalSummary = 'Request blocked at perimeter by AWS WAF security rules.';
        break;
      } else {
        steps.push({
          id: `step-${stepNumber++}`,
          stepNumber: steps.length + 1,
          timestampMs: currentTimestamp,
          sourceNodeId: currentNode.id,
          targetNodeId: currentNode.id,
          sourceNodeName: currentNode.data.label,
          targetNodeName: currentNode.data.label,
          protocol: 'HTTPS',
          action: 'AWS WAF: Inspection Passed',
          status: 'success',
          explanation: `AWS WAF inspected headers and payload for '${scenario.path}'. Request validated against rate limits and SQLi/XSS inspection. Passing to origin.`,
          targetHealth: 'healthy',
          latencyMs: 3
        });
        currentTimestamp += 3;
      }
    }

    // =========================================================================
    // BEHAVIOR 2: Auto-Scaling & Load Behavior on Compute Nodes
    // =========================================================================
    const isCompute = ['ec2', 'ecs', 'lambda', 'fargate', 'app_runner'].includes(currentNode.data.serviceId);
    const isSpikeLoad = ['high', 'very_high', '10x', '100x'].includes(scenario.trafficLevel);

    if (isCompute && isSpikeLoad) {
      const isServerless = ['lambda', 'fargate', 'app_runner'].includes(currentNode.data.serviceId);
      const hasAutoScaling =
        isServerless ||
        (currentNode.data.replicas && currentNode.data.replicas > 1) ||
        currentNode.data.multiAz ||
        nodes.some(n => n.data.serviceId === 'auto_scaling' && n.data.health !== 'failed');

      if (hasAutoScaling) {
        // Auto Scaling Scale-Out Event
        const currentCount = currentNode.data.replicas || 1;
        const multiplier = scenario.trafficLevel === '100x' ? 4 : scenario.trafficLevel === '10x' ? 3 : 2;
        const scaledCount = Math.min(12, currentCount * multiplier);

        steps.push({
          id: `step-${stepNumber++}`,
          stepNumber: steps.length + 1,
          timestampMs: currentTimestamp,
          sourceNodeId: currentNode.id,
          targetNodeId: currentNode.id,
          sourceNodeName: currentNode.data.label,
          targetNodeName: currentNode.data.label,
          protocol: 'HTTP',
          action: isServerless ? 'Serverless Elastic Concurrency Scaling' : 'Auto Scaling Group: Dynamic Scale-Out',
          status: 'success',
          explanation: isServerless
            ? `${currentNode.data.label} detected traffic surge (${scenario.trafficLevel.toUpperCase()}). Serverless control plane instantly provisioned concurrent execution environments without provisioning servers.`
            : `High traffic (${scenario.trafficLevel.toUpperCase()}) breached CloudWatch alarm (CPU > 75%). Auto Scaling Group launched +${scaledCount - currentCount} instances across Availability Zones (Total: ${scaledCount} targets). Load successfully balanced!`,
          targetHealth: 'healthy',
          latencyMs: 30,
          details: {
            recoveryApplied: `Dynamic Auto Scaling expanded capacity to ${scaledCount} targets, preventing saturation.`
          }
        });
        currentTimestamp += 30;
      } else if (['10x', '100x'].includes(scenario.trafficLevel)) {
        // Single instance with no auto scaling under extreme load
        steps.push({
          id: `step-${stepNumber++}`,
          stepNumber: steps.length + 1,
          timestampMs: currentTimestamp,
          sourceNodeId: currentNode.id,
          targetNodeId: currentNode.id,
          sourceNodeName: currentNode.data.label,
          targetNodeName: currentNode.data.label,
          protocol: 'HTTP',
          action: 'Instance Capacity Saturation (No Auto-Scaling)',
          status: 'failed',
          explanation: `CRITICAL BOTTLENECK: ${currentNode.data.label} is deployed as a single instance (replicas: 1) without an Auto Scaling Group. Under ${scenario.trafficLevel.toUpperCase()} load surge, CPU hit 100% and connection thread pool was completely exhausted. Request timed out (504 Gateway Timeout).`,
          targetHealth: 'failed',
          latencyMs: 5000,
          details: {
            statusCode: 504,
            failureReason: 'Compute instance saturated. No Auto Scaling Group configured.'
          }
        });
        bottlenecksDetected.push(`${currentNode.data.label} single instance saturated under ${scenario.trafficLevel} load.`);
        overallSuccess = false;
        finalStatusCode = 504;
        finalSummary = `${currentNode.data.label} capacity saturated: Configure an Auto Scaling Group or increase replicas.`;
        cascadeOccurred = true;
        break;
      }
    }

    // =========================================================================
    // BEHAVIOR 3: NAT Gateway Packet Translation
    // =========================================================================
    if (currentNode.data.serviceId === 'nat_gateway') {
      const isPublicNat = currentNode.data.subnet === 'public';
      if (!isPublicNat) {
        steps.push({
          id: `step-${stepNumber++}`,
          stepNumber: steps.length + 1,
          timestampMs: currentTimestamp,
          sourceNodeId: currentNode.id,
          targetNodeId: currentNode.id,
          sourceNodeName: currentNode.data.label,
          targetNodeName: currentNode.data.label,
          protocol: 'TCP',
          action: 'NAT Gateway Misconfiguration in Private Subnet',
          status: 'failed',
          explanation: `ROUTING ERROR: ${currentNode.data.label} is deployed in a private subnet! A NAT Gateway must be placed in a public subnet with a default route to an Internet Gateway (0.0.0.0/0 -> igw). Egress traffic cannot be dispatched.`,
          targetHealth: 'failed',
          latencyMs: 50,
          details: {
            statusCode: 502,
            failureReason: 'NAT Gateway deployed in private subnet instead of public subnet.'
          }
        });
        overallSuccess = false;
        finalStatusCode = 502;
        finalSummary = 'NAT Gateway misconfigured: Must be located in a public subnet.';
        break;
      } else {
        steps.push({
          id: `step-${stepNumber++}`,
          stepNumber: steps.length + 1,
          timestampMs: currentTimestamp,
          sourceNodeId: currentNode.id,
          targetNodeId: currentNode.id,
          sourceNodeName: currentNode.data.label,
          targetNodeName: currentNode.data.label,
          protocol: 'TCP',
          action: 'SNAT: Private IP -> Elastic IP (EIP)',
          status: 'success',
          explanation: `${currentNode.data.label} in public subnet performed Source Network Address Translation (SNAT). Replaced private instance IP with public Elastic IP. Forwarding outbound packet to Internet Gateway.`,
          targetHealth: 'healthy',
          latencyMs: 12
        });
        currentTimestamp += 12;
      }
    }

    // Find outgoing edges
    const outgoingEdges = edges.filter(e => e.source === currentNode.id);

    if (outgoingEdges.length === 0) {
      // Terminal node handling
      const isTerminalDataStore = ['rds', 'dynamodb', 's3', 'elasticache', 'aurora'].includes(currentNode.data.serviceId);
      steps.push({
        id: `step-${stepNumber++}`,
        stepNumber: steps.length + 1,
        timestampMs: currentTimestamp,
        sourceNodeId: currentNode.id,
        targetNodeId: currentNode.id,
        sourceNodeName: currentNode.data.label,
        targetNodeName: currentNode.data.label,
        protocol: isTerminalDataStore ? 'SQL' : 'HTTP',
        action: isTerminalDataStore ? 'Query Completed' : 'Terminal Processing Done',
        status: 'success',
        explanation: isTerminalDataStore
          ? `${currentNode.data.label} committed transaction and returned data.`
          : `${currentNode.data.label} completed terminal execution.`,
        targetHealth: currentNode.data.health,
        latencyMs: isTerminalDataStore ? 25 : 10
      });
      currentTimestamp += 25;
      break;
    }

    // Downstream targets (exclude boundary containers)
    const downstreamNodeIds = outgoingEdges.map(e => e.target);
    const downstreamNodes = nodes.filter(n => downstreamNodeIds.includes(n.id) && n.type !== 'boundaryNode' && (n.data as any)?.serviceId);

    // =========================================================================
    // BEHAVIOR 4: CloudFront Edge Caching
    // =========================================================================
    if (currentNode.data.serviceId === 'cloudfront') {
      const isStaticPath = scenario.path.includes('/static') || scenario.path.endsWith('.png') || scenario.path.endsWith('.js') || scenario.path.endsWith('.css');
      if (isStaticPath) {
        steps.push({
          id: `step-${stepNumber++}`,
          stepNumber: steps.length + 1,
          timestampMs: currentTimestamp,
          sourceNodeId: currentNode.id,
          targetNodeId: currentNode.id,
          sourceNodeName: currentNode.data.label,
          targetNodeName: currentNode.data.label,
          protocol: 'HTTPS',
          action: 'Edge Cache HIT',
          status: 'success',
          explanation: `CloudFront edge location evaluated request for '${scenario.path}'. Cache HIT (Age: 320s). Served directly from edge PoP with 8ms latency without contacting origin!`,
          targetHealth: currentNode.data.health,
          latencyMs: 8,
          details: { cacheHit: true, statusCode: 200 }
        });
        currentTimestamp += 8;
        overallSuccess = true;
        finalStatusCode = 200;
        finalSummary = 'Request served instantly by CloudFront Edge Cache (Origin offloaded).';
        break;
      } else {
        steps.push({
          id: `step-${stepNumber++}`,
          stepNumber: steps.length + 1,
          timestampMs: currentTimestamp,
          sourceNodeId: currentNode.id,
          targetNodeId: downstreamNodes[0]?.id || currentNode.id,
          sourceNodeName: currentNode.data.label,
          targetNodeName: downstreamNodes[0]?.data.label || 'Origin',
          protocol: 'HTTPS',
          action: 'Edge Cache MISS -> Forwarding to Origin',
          status: 'success',
          explanation: `CloudFront cache MISS for dynamic route '${scenario.path}'. Forwarding request to origin backend.`,
          targetHealth: currentNode.data.health,
          latencyMs: 15,
          details: { cacheHit: false }
        });
        currentTimestamp += 15;
      }
    }

    // =========================================================================
    // BEHAVIOR 5: Load Balancer (ALB / API Gateway) Target Health Evaluation
    // =========================================================================
    if (['alb', 'api_gateway'].includes(currentNode.data.serviceId)) {
      const computeTargets = downstreamNodes.filter(n => ['ecs', 'ec2', 'lambda', 'fargate'].includes(n.data.serviceId));
      const targetList = (computeTargets.length > 0 ? computeTargets : downstreamNodes);

      const targetsEvaluation = targetList.map(t => ({
        id: t.id,
        name: t.data.label,
        health: t.data.health,
        selected: false
      }));

      const healthyTargets = targetList.filter(t => t.data.health === 'healthy');

      if (healthyTargets.length === 0) {
        steps.push({
          id: `step-${stepNumber++}`,
          stepNumber: steps.length + 1,
          timestampMs: currentTimestamp,
          sourceNodeId: currentNode.id,
          targetNodeId: currentNode.id,
          sourceNodeName: currentNode.data.label,
          targetNodeName: currentNode.data.label,
          protocol: 'HTTP',
          action: 'Target Health Check: ALL TARGETS FAILED',
          status: 'failed',
          explanation: `HTTP 502 Bad Gateway: ${currentNode.data.label} evaluated registered targets in target group. All ${targetList.length} targets failed health checks! No healthy endpoints available to route traffic.`,
          targetHealth: 'failed',
          latencyMs: 250,
          details: {
            targetsEvaluated: targetsEvaluation,
            statusCode: 502,
            failureReason: 'All registered compute targets are unhealthy or unresponsive.'
          }
        });
        overallSuccess = false;
        finalStatusCode = 502;
        finalSummary = `${currentNode.data.label} returned 502 Bad Gateway: No healthy compute targets available.`;
        break;
      }

      // At least one healthy target! Select healthy target
      const selectedTarget = healthyTargets[0];

      if (pushFirewallBlockIfAny(currentNode, selectedTarget, 'HTTP')) {
        break;
      }

      const failedTargets = targetList.filter(t => t.data.health === 'failed');

      const evaluatedDetails = targetsEvaluation.map(t => ({
        ...t,
        selected: t.id === selectedTarget.id
      }));

      let albExplanation = `${currentNode.data.label} evaluated ${targetList.length} registered target(s). Selected healthy target [${selectedTarget.data.label}].`;
      if (failedTargets.length > 0) {
        albExplanation += ` Health check detected ${failedTargets.length} FAILED target(s) (${failedTargets.map(f => f.data.label).join(', ')}) and removed them from active rotation. Resilience maintained!`;
        const hasAutoScalingGroup = nodes.some(n => n.data.serviceId === 'auto_scaling' && n.data.health !== 'failed');
        if (hasAutoScalingGroup) {
          albExplanation += ` The Auto Scaling Group's own health check will independently mark ${failedTargets.map(f => f.data.label).join(', ')} unhealthy, terminate it, and launch a replacement instance to restore full capacity - all without any user-visible impact.`;
        }
      }

      steps.push({
        id: `step-${stepNumber++}`,
        stepNumber: steps.length + 1,
        timestampMs: currentTimestamp,
        sourceNodeId: currentNode.id,
        targetNodeId: selectedTarget.id,
        sourceNodeName: currentNode.data.label,
        targetNodeName: selectedTarget.data.label,
        protocol: 'HTTP',
        action: `Route to ${selectedTarget.data.label}`,
        status: 'success',
        explanation: albExplanation,
        targetHealth: selectedTarget.data.health,
        latencyMs: 12,
        details: {
          targetsEvaluated: evaluatedDetails,
          recoveryApplied: failedTargets.length > 0 ? `Traffic safely steered away from failed ${failedTargets[0].data.label}` : undefined
        }
      });

      currentTimestamp += 12;
      currentNode = selectedTarget;
      continue;
    }

    // =========================================================================
    // BEHAVIOR 6: Compute Node querying Database / Cache / SQS
    // =========================================================================
    if (['ecs', 'ec2', 'lambda', 'fargate'].includes(currentNode.data.serviceId)) {
      const dbTarget = downstreamNodes.find(n => ['rds', 'dynamodb', 'aurora'].includes(n.data.serviceId));
      const cacheTarget = downstreamNodes.find(n => n.data.serviceId === 'elasticache');
      const queueTarget = downstreamNodes.find(n => n.data.serviceId === 'sqs');

      // Check Database interactions
      if (dbTarget) {
        const dbEdgeProtocol = outgoingEdges.find(e => e.target === dbTarget.id)?.data?.protocol || 'SQL';
        if (pushFirewallBlockIfAny(currentNode, dbTarget, dbEdgeProtocol)) {
          break;
        }

        if (dbTarget.data.health === 'failed') {
          // Multi-AZ Automated Failover Evaluation
          const isMultiAzDb = dbTarget.data.multiAz || dbTarget.data.az === 'Multi-AZ' || dbTarget.data.serviceId === 'aurora';

          if (isMultiAzDb) {
            // Multi-AZ failover succeeds!
            steps.push({
              id: `step-${stepNumber++}`,
              stepNumber: steps.length + 1,
              timestampMs: currentTimestamp,
              sourceNodeId: currentNode.id,
              targetNodeId: dbTarget.id,
              sourceNodeName: currentNode.data.label,
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
            currentTimestamp += 45;
            // Successfully processed query via promoted replica
            overallSuccess = true;
            finalSummary = 'Request succeeded: Multi-AZ database automatically failed over to standby replica.';
            break;
          } else if (cacheTarget && cacheTarget.data.health === 'healthy') {
            // Fallback to cache
            steps.push({
              id: `step-${stepNumber++}`,
              stepNumber: steps.length + 1,
              timestampMs: currentTimestamp,
              sourceNodeId: currentNode.id,
              targetNodeId: cacheTarget.id,
              sourceNodeName: currentNode.data.label,
              targetNodeName: cacheTarget.data.label,
              protocol: 'TCP',
              action: 'Database Failure -> Cache Fallback',
              status: 'success',
              explanation: `Primary database [${dbTarget.data.label}] failed. ${currentNode.data.label} activated circuit breaker and successfully fetched cached records from ${cacheTarget.data.label}!`,
              targetHealth: 'healthy',
              latencyMs: 15,
              details: {
                recoveryApplied: 'Circuit breaker cache fallback preserved partial application availability.'
              }
            });
            currentTimestamp += 15;
            overallSuccess = true;
            finalSummary = 'Request succeeded via ElastiCache fallback despite primary database failure.';
            break;
          } else {
            // Single-AZ DB Down without fallback
            steps.push({
              id: `step-${stepNumber++}`,
              stepNumber: steps.length + 1,
              timestampMs: currentTimestamp,
              sourceNodeId: currentNode.id,
              targetNodeId: dbTarget.id,
              sourceNodeName: currentNode.data.label,
              targetNodeName: dbTarget.data.label,
              protocol: 'SQL',
              action: 'Database Connection Timeout',
              status: 'failed',
              explanation: `CRITICAL ERROR: ${currentNode.data.label} attempted SQL query against ${dbTarget.data.label}. Connection timed out after 5000ms. Single-AZ database node is FAILED. Application cannot retrieve required relational data.`,
              targetHealth: 'failed',
              latencyMs: 5000,
              details: {
                statusCode: 504,
                failureReason: 'Single-AZ Database instance is down and has no standby replica.'
              }
            });
            overallSuccess = false;
            finalStatusCode = 504;
            finalSummary = `Request failed: Database ${dbTarget.data.label} is offline and has no Multi-AZ replica.`;
            break;
          }
        }
      }

      // Check SQS Queue Buffering
      if (queueTarget) {
        steps.push({
          id: `step-${stepNumber++}`,
          stepNumber: steps.length + 1,
          timestampMs: currentTimestamp,
          sourceNodeId: currentNode.id,
          targetNodeId: queueTarget.id,
          sourceNodeName: currentNode.data.label,
          targetNodeName: queueTarget.data.label,
          protocol: 'Message',
          action: 'Enqueue Asynchronous Message',
          status: 'success',
          explanation: `Successfully published message payload to ${queueTarget.data.label}. Web tier responded 202 Accepted immediately, decoupling client from background execution!`,
          targetHealth: queueTarget.data.health,
          latencyMs: 18,
          details: { statusCode: 202 }
        });
        currentTimestamp += 18;
        overallSuccess = true;
        finalStatusCode = 202;
        finalSummary = `Asynchronous message successfully enqueued into ${queueTarget.data.label}. Decoupled processing guaranteed.`;
        break;
      }
    }

    // =========================================================================
    // BEHAVIOR 6B: Explicit VPC Endpoint Hop
    // A private-subnet resource can be wired directly to a Gateway/Interface Endpoint node on
    // the canvas (rather than straight to S3/DynamoDB), which is the architecturally correct way
    // to draw it. When that edge exists, route through it here with its own explanatory step
    // instead of falling through to the generic forwarding logic below.
    // =========================================================================
    const endpointTarget = downstreamNodes.find(n =>
      ['s3_gateway_endpoint', 'vpc_endpoint', 'privatelink'].includes(n.data.serviceId)
    );
    if (endpointTarget && (currentNode.data.subnet === 'private' || currentNode.data.subnet === 'isolated')) {
      const isGatewayEndpoint = endpointTarget.data.serviceId === 's3_gateway_endpoint';
      steps.push({
        id: `step-${stepNumber++}`,
        stepNumber: steps.length + 1,
        timestampMs: currentTimestamp,
        sourceNodeId: currentNode.id,
        targetNodeId: endpointTarget.id,
        sourceNodeName: currentNode.data.label,
        targetNodeName: endpointTarget.data.label,
        protocol: 'HTTPS',
        action: isGatewayEndpoint ? 'AWS VPC Gateway Endpoint Route' : 'AWS VPC Interface Endpoint Route',
        status: 'success',
        explanation: `${currentNode.data.label} in a private subnet routed directly to ${endpointTarget.data.label} over the AWS private backbone. Zero internet exposure, and no NAT Gateway data-processing charges.`,
        targetHealth: endpointTarget.data.health,
        latencyMs: 4
      });
      currentTimestamp += 4;
      currentNode = endpointTarget;
      continue;
    }

    // =========================================================================
    // BEHAVIOR 7: Subnet Routing & Security Boundary Checks
    // =========================================================================
    const nextNode = downstreamNodes.find(n => !visited.has(n.id)) || downstreamNodes[0];

    if (!nextNode) {
      // Every outgoing connection points at a visual boundary container or a node that
      // no longer exists, so there is no service left to receive the request.
      steps.push({
        id: `step-${stepNumber++}`,
        stepNumber: steps.length + 1,
        timestampMs: currentTimestamp,
        sourceNodeId: currentNode.id,
        targetNodeId: currentNode.id,
        sourceNodeName: currentNode.data.label,
        targetNodeName: currentNode.data.label,
        protocol: 'HTTP',
        action: 'Unresolved Downstream Connection',
        status: 'failed',
        explanation: `DEAD END: ${currentNode.data.label} has ${outgoingEdges.length} outgoing connection(s), but none of them lead to an AWS service. Connections drawn to boundary containers (VPC, subnet, Availability Zone) are visual grouping only and cannot carry traffic. Connect ${currentNode.data.label} directly to the downstream service.`,
        targetHealth: 'failed',
        latencyMs: 10,
        details: {
          statusCode: 502,
          failureReason: 'Outgoing connection does not resolve to an AWS service node.'
        }
      });
      overallSuccess = false;
      finalStatusCode = 502;
      finalSummary = `Request stopped at ${currentNode.data.label}: its outgoing connection does not lead to an AWS service.`;
      break;
    }

    const edge = outgoingEdges.find(e => e.target === nextNode.id);
    const protocol = edge?.data?.protocol || 'HTTP';

    // 7A: VPC Internet Gateway Attachment Check
    // A resource sitting in a "public" subnet (ALB/NLB/EC2/ECS/Fargate/API Gateway) is only
    // actually reachable from outside the VPC once an Internet Gateway is attached and a public
    // route table sends 0.0.0.0/0 to it. Fully-managed edge/serverless services (CloudFront,
    // Route 53, Cognito, AppSync, Lambda, S3, DynamoDB, ...) are reached over the AWS backbone
    // and never touch a customer-owned IGW, so they are intentionally excluded here.
    const isPublicOrigin = ['user', 'client_ui', 'api_client'].includes(currentNode.data.serviceId) || currentNode.data.subnet === 'global';
    const vpcHostedIngressServices = ['alb', 'nlb', 'elb', 'api_gateway', 'app_runner', 'ec2', 'ecs', 'fargate'];
    const isVpcHostedPublicTarget = nextNode.data.subnet === 'public' && vpcHostedIngressServices.includes(nextNode.data.serviceId);

    if (isPublicOrigin && isVpcHostedPublicTarget) {
      const igw = nodes.find(n => n.data.serviceId === 'internet_gateway');

      if (!igw) {
        steps.push({
          id: `step-${stepNumber++}`,
          stepNumber: steps.length + 1,
          timestampMs: currentTimestamp,
          sourceNodeId: currentNode.id,
          targetNodeId: nextNode.id,
          sourceNodeName: currentNode.data.label,
          targetNodeName: nextNode.data.label,
          protocol: 'TCP',
          action: 'VPC Unreachable: No Internet Gateway Attached',
          status: 'failed',
          explanation: `NO ROUTE TO HOST: The VPC has no Internet Gateway attached. ${nextNode.data.label} sits in a public subnet with a public IP, but without an IGW there is no route between the VPC and the internet at all - public route tables have nowhere to send 0.0.0.0/0 traffic. Add an Internet Gateway to the VPC.`,
          targetHealth: 'failed',
          latencyMs: 10,
          details: {
            statusCode: 504,
            failureReason: 'VPC has no Internet Gateway attached; public subnets are unreachable from the internet.'
          }
        });
        overallSuccess = false;
        finalStatusCode = 504;
        finalSummary = `Request failed: VPC has no Internet Gateway attached, so ${nextNode.data.label} cannot be reached from outside the VPC.`;
        bottlenecksDetected.push('VPC has no Internet Gateway: public subnets are unreachable from the internet.');
        break;
      }

      if (igw.data.health === 'failed') {
        steps.push({
          id: `step-${stepNumber++}`,
          stepNumber: steps.length + 1,
          timestampMs: currentTimestamp,
          sourceNodeId: currentNode.id,
          targetNodeId: igw.id,
          sourceNodeName: currentNode.data.label,
          targetNodeName: igw.data.label,
          protocol: 'TCP',
          action: 'Internet Gateway Outage',
          status: 'failed',
          explanation: `CRITICAL OUTAGE: Internet Gateway [${igw.data.label}] is offline/unhealthy. The VPC has lost its only path to and from the internet; ${nextNode.data.label} is unreachable.`,
          targetHealth: 'failed',
          latencyMs: 10,
          details: {
            statusCode: 504,
            failureReason: 'Internet Gateway is failed.'
          }
        });
        overallSuccess = false;
        finalStatusCode = 504;
        finalSummary = `Request failed: Internet Gateway ${igw.data.label} is offline.`;
        break;
      }
    }

    // 7B: Direct Public Ingress into Private Subnet Check
    const isPrivateTarget = nextNode.data.subnet === 'private' || nextNode.data.subnet === 'isolated';
    const isIngressProxy = ['alb', 'nlb', 'elb', 'api_gateway', 'cloudfront'].includes(nextNode.data.serviceId);

    if (isPublicOrigin && isPrivateTarget && !isIngressProxy) {
      steps.push({
        id: `step-${stepNumber++}`,
        stepNumber: steps.length + 1,
        timestampMs: currentTimestamp,
        sourceNodeId: currentNode.id,
        targetNodeId: nextNode.id,
        sourceNodeName: currentNode.data.label,
        targetNodeName: nextNode.data.label,
        protocol: 'TCP',
        action: 'VPC Ingress Violation: Direct Public Access to Private Subnet Blocked',
        status: 'failed',
        explanation: `PACKET BLOCKED: Unsolicited public internet traffic cannot reach instances in private subnet [${nextNode.data.subnet}]. Private route tables have no 0.0.0.0/0 route to Internet Gateway. Public ingress must be mediated by an ALB or API Gateway in a public subnet.`,
        targetHealth: 'failed',
        latencyMs: 10,
        details: {
          statusCode: 403,
          failureReason: 'Direct public internet ingress into private subnet is prohibited by VPC route tables.'
        }
      });
      overallSuccess = false;
      finalStatusCode = 403;
      finalSummary = `Ingress blocked: Direct public internet access to private instance [${nextNode.data.label}] is prohibited by VPC route tables.`;
      bottlenecksDetected.push('Instances in private subnets cannot accept direct public internet traffic.');
      break;
    }

    // 7C: Outbound Egress from Private Subnet (NAT Gateway & VPC Endpoint Check)
    const isPrivateSource = (currentNode.data.subnet === 'private' || currentNode.data.subnet === 'isolated') &&
      !['privatelink', 'vpc_endpoint', 's3_gateway_endpoint'].includes(currentNode.data.serviceId);
    const isExternalTarget = nextNode.data.subnet === 'global' || ['api_client', 'user'].includes(nextNode.data.serviceId);

    if (isPrivateSource && isExternalTarget && !['rds', 'dynamodb'].includes(nextNode.data.serviceId)) {
      const vpcEndpoint = nodes.find(n => ['privatelink', 'vpc_endpoint', 's3_gateway_endpoint'].includes(n.data.serviceId) && n.data.health !== 'failed');
      const natGateway = nodes.find(n => n.data.serviceId === 'nat_gateway');

      if (vpcEndpoint && ['s3', 'dynamodb'].includes(nextNode.data.serviceId)) {
        // VPC Endpoint routing
        steps.push({
          id: `step-${stepNumber++}`,
          stepNumber: steps.length + 1,
          timestampMs: currentTimestamp,
          sourceNodeId: currentNode.id,
          targetNodeId: vpcEndpoint.id,
          sourceNodeName: currentNode.data.label,
          targetNodeName: vpcEndpoint.data.label,
          protocol: 'HTTPS',
          action: 'AWS VPC Gateway Endpoint Route',
          status: 'success',
          explanation: `Private instance [${currentNode.data.label}] routed directly to ${nextNode.data.label} over AWS Private Backbone via ${vpcEndpoint.data.label}. Zero internet exposure, zero NAT Gateway data processing fees!`,
          targetHealth: 'healthy',
          latencyMs: 4
        });
        currentTimestamp += 4;
      } else if (!natGateway) {
        // Missing NAT Gateway!
        steps.push({
          id: `step-${stepNumber++}`,
          stepNumber: steps.length + 1,
          timestampMs: currentTimestamp,
          sourceNodeId: currentNode.id,
          targetNodeId: nextNode.id,
          sourceNodeName: currentNode.data.label,
          targetNodeName: nextNode.data.label,
          protocol: 'HTTPS',
          action: 'Outbound Egress Timeout: NAT Gateway Missing',
          status: 'failed',
          explanation: `EGRESS TIMEOUT: Instance [${currentNode.data.label}] in private subnet attempted external communication, but no NAT Gateway or VPC Endpoint exists in the route table. Outbound packets dropped.`,
          targetHealth: 'failed',
          latencyMs: 3000,
          details: {
            statusCode: 504,
            failureReason: 'Missing NAT Gateway in route table for private subnet.'
          }
        });
        overallSuccess = false;
        finalStatusCode = 504;
        finalSummary = `Outbound egress failed: No NAT Gateway exists for private subnet instance ${currentNode.data.label}.`;
        bottlenecksDetected.push('Private subnet instances lack a NAT Gateway for internet egress.');
        break;
      } else if (natGateway.data.health === 'failed') {
        steps.push({
          id: `step-${stepNumber++}`,
          stepNumber: steps.length + 1,
          timestampMs: currentTimestamp,
          sourceNodeId: currentNode.id,
          targetNodeId: natGateway.id,
          sourceNodeName: currentNode.data.label,
          targetNodeName: natGateway.data.label,
          protocol: 'TCP',
          action: 'NAT Gateway Outage',
          status: 'failed',
          explanation: `CRITICAL OUTAGE: NAT Gateway [${natGateway.data.label}] is offline/unhealthy. Private subnet outbound egress dropped.`,
          targetHealth: 'failed',
          latencyMs: 2500,
          details: {
            statusCode: 504,
            failureReason: 'NAT Gateway is failed.'
          }
        });
        overallSuccess = false;
        finalStatusCode = 504;
        finalSummary = `Egress failed: NAT Gateway ${natGateway.data.label} is offline.`;
        break;
      } else {
        // NAT Gateway is healthy and in public subnet
        steps.push({
          id: `step-${stepNumber++}`,
          stepNumber: steps.length + 1,
          timestampMs: currentTimestamp,
          sourceNodeId: currentNode.id,
          targetNodeId: natGateway.id,
          sourceNodeName: currentNode.data.label,
          targetNodeName: natGateway.data.label,
          protocol: 'TCP',
          action: 'NAT Gateway SNAT: Private IP -> Elastic IP',
          status: 'success',
          explanation: `Outbound egress routed through NAT Gateway [${natGateway.data.label}] in public subnet. Translated private IP to Elastic IP (EIP) via Source NAT (SNAT). Forwarding outbound traffic to ${nextNode.data.label}.`,
          targetHealth: 'healthy',
          latencyMs: 14
        });
        currentTimestamp += 14;
      }
    }

    if (pushFirewallBlockIfAny(currentNode, nextNode, protocol)) {
      break;
    }

    // Default Step Execution
    steps.push({
      id: `step-${stepNumber++}`,
      stepNumber: steps.length + 1,
      timestampMs: currentTimestamp,
      sourceNodeId: currentNode.id,
      targetNodeId: nextNode.id,
      sourceNodeName: currentNode.data.label,
      targetNodeName: nextNode.data.label,
      protocol: protocol,
      action: `Forward ${protocol} request`,
      status: nextNode.data.health === 'failed' ? 'failed' : 'success',
      explanation: `${currentNode.data.label} forwarded ${protocol} request to ${nextNode.data.label}.`,
      targetHealth: nextNode.data.health,
      latencyMs: 20
    });

    currentTimestamp += 20;
    currentNode = nextNode;
  }

  // Response journey step if request was successful
  if (overallSuccess && steps.length > 1) {
    steps.push({
      id: `step-${stepNumber++}`,
      stepNumber: steps.length + 1,
      timestampMs: currentTimestamp + 15,
      sourceNodeId: currentNode ? currentNode.id : 'backend',
      targetNodeId: startNode.id,
      sourceNodeName: currentNode ? currentNode.data.label : 'Origin Backend',
      targetNodeName: startNode.data.label,
      protocol: 'HTTPS',
      action: `HTTP ${finalStatusCode} Response Delivered`,
      status: 'success',
      explanation: `Full roundtrip complete. Client received HTTP ${finalStatusCode} in ${currentTimestamp + 15}ms.`,
      targetHealth: 'healthy',
      latencyMs: 15,
      details: { statusCode: finalStatusCode }
    });
  }

  return {
    scenario,
    steps,
    success: overallSuccess,
    totalLatencyMs: currentTimestamp + (overallSuccess ? 15 : 0),
    statusCode: finalStatusCode,
    summary: finalSummary,
    bottlenecksDetected,
    cascadeOccurred
  };
}
