import type { StudentChallenge } from '../types/index.ts';

export const STUDENT_CHALLENGES: StudentChallenge[] = [
  {
    id: 'challenge-eliminate-spof',
    title: 'Challenge 1: Zero Single Points of Failure',
    level: 'Beginner',
    scenario: 'Your e-commerce startup is preparing for a major product launch. The current prototype runs on a single server and database. If either fails, the entire business goes down.',
    trafficScale: '5,000 active concurrent users',
    requirements: [
      'Include an Application Load Balancer (ALB) to distribute traffic',
      'Deploy at least 2 distinct compute targets (ECS or EC2)',
      'Deploy a persistent database (RDS or DynamoDB) with Multi-AZ redundancy enabled',
      'Achieve 0 detected Critical Single Points of Failure in the analysis'
    ],
    initialTemplateId: 'basic-spof-app',
    evaluationCheck: (nodes, _edges, analysis) => {
      const feedback: string[] = [];
      let passed = true;

      const hasAlb = nodes.some(n => n.data.serviceId === 'alb' || n.data.serviceId === 'api_gateway');
      if (!hasAlb) {
        feedback.push('Missing Load Balancer: Add an ALB or API Gateway to distribute incoming traffic.');
        passed = false;
      } else {
        feedback.push('Passed: Ingress load balancing is configured.');
      }

      const computeNodes = nodes.filter(n => ['ecs', 'ec2', 'lambda'].includes(n.data.serviceId));
      const totalComputeInstances = computeNodes.reduce((sum, n) => sum + (n.data.replicas || 1), 0);
      if (computeNodes.length < 2 && totalComputeInstances < 2) {
        feedback.push('Compute SPOF: Deploy at least two compute tasks or instances across availability zones.');
        passed = false;
      } else {
        feedback.push(`Passed: Redundant compute configured (${computeNodes.length} node(s), ${totalComputeInstances} instance(s)).`);
      }

      const dbNodes = nodes.filter(n => ['rds', 'dynamodb', 'aurora'].includes(n.data.serviceId));
      const hasRedundantDb = dbNodes.some(n => n.data.multiAz || n.data.serviceId === 'dynamodb');
      if (dbNodes.length === 0) {
        feedback.push('Missing Database: Add an RDS or DynamoDB datastore for persistence.');
        passed = false;
      } else if (!hasRedundantDb) {
        feedback.push('Database SPOF: Your database is Single-AZ. Enable Multi-AZ or use DynamoDB.');
        passed = false;
      } else {
        feedback.push('Passed: Database layer has Multi-AZ redundancy.');
      }

      const criticalSpofs = analysis.spofs.filter(s => s.impactLevel === 'CRITICAL');
      if (criticalSpofs.length > 0) {
        feedback.push(`Still have ${criticalSpofs.length} critical single point(s) of failure: ${criticalSpofs.map(s => s.nodeName).join(', ')}.`);
        passed = false;
      } else {
        feedback.push('Passed: Zero critical Single Points of Failure detected!');
      }

      const score = Math.round(
        (hasAlb ? 25 : 0) +
        (totalComputeInstances >= 2 ? 25 : 10) +
        (hasRedundantDb ? 25 : 0) +
        (criticalSpofs.length === 0 ? 25 : 0)
      );

      return { passed, feedback, score };
    }
  },

  {
    id: 'challenge-multiaz-resilience',
    title: 'Challenge 2: Survive an Availability Zone Outage',
    level: 'Intermediate',
    scenario: 'AWS data centers can experience fiber cuts or localized power loss. Design an architecture that survives the complete catastrophic loss of Availability Zone A (AZ-A) without dropping user requests.',
    trafficScale: '15,000 active concurrent users',
    requirements: [
      'Deploy compute resources in both AZ-A and AZ-B',
      'Configure the database with Multi-AZ synchronous replication',
      'When AZ-A is failed using [Fail AZ-A], simulated requests must continue to succeed through surviving AZ-B nodes',
      'Achieve a Fault Tolerance score of >= 75%'
    ],
    initialTemplateId: 'highly-available-multiaz',
    evaluationCheck: (nodes, _edges, analysis) => {
      const feedback: string[] = [];
      let passed = true;

      const azANodes = nodes.filter(n => n.data.az === 'AZ-A');
      const azBNodes = nodes.filter(n => n.data.az === 'AZ-B');

      if (azANodes.length === 0 || azBNodes.length === 0) {
        feedback.push('AZ Imbalance: You must have components deployed across both AZ-A and AZ-B.');
        passed = false;
      } else {
        feedback.push(`Passed: Balanced multi-AZ presence (AZ-A: ${azANodes.length} nodes, AZ-B: ${azBNodes.length} nodes).`);
      }

      const computeInB = azBNodes.filter(n => ['ecs', 'ec2', 'lambda'].includes(n.data.serviceId));
      if (computeInB.length === 0) {
        feedback.push('Compute Missing in AZ-B: If AZ-A fails, there are no compute instances in AZ-B to serve requests.');
        passed = false;
      } else {
        feedback.push('Passed: Redundant compute targets running in AZ-B.');
      }

      if (analysis.faultTolerance.score < 75) {
        feedback.push(`Fault Tolerance score is ${analysis.faultTolerance.score}%. Target is >= 75%.`);
        passed = false;
      } else {
        feedback.push(`Passed: Strong Fault Tolerance score of ${analysis.faultTolerance.score}%.`);
      }

      return {
        passed,
        feedback,
        score: Math.min(100, Math.round(analysis.faultTolerance.score))
      };
    }
  },

  {
    id: 'challenge-traffic-spike',
    title: 'Challenge 3: Absorb a 10x Black Friday Spike',
    level: 'Advanced',
    scenario: 'During flash sales, order traffic jumps by 1,000%. If incoming requests write synchronously to the relational database, database connections exhaust within seconds, leading to cascading HTTP 504 gateway timeouts.',
    trafficScale: '100,000 requests/minute',
    requirements: [
      'Include CloudFront CDN at the edge to offload static requests',
      'Include an asynchronous buffer (Amazon SQS) between web compute and database writes',
      'Configure worker compute instances to process queue messages asynchronously',
      'Eliminate synchronous database bottlenecks'
    ],
    initialTemplateId: 'event-driven-async',
    evaluationCheck: (nodes, edges, analysis) => {
      const feedback: string[] = [];
      let passed = true;

      const hasCdn = nodes.some(n => n.data.serviceId === 'cloudfront');
      if (!hasCdn) {
        feedback.push('Edge Caching Missing: Add CloudFront CDN to absorb static asset traffic.');
        passed = false;
      } else {
        feedback.push('Passed: CloudFront edge caching configured.');
      }

      const hasQueue = nodes.some(n => n.data.serviceId === 'sqs');
      if (!hasQueue) {
        feedback.push('Missing Asynchronous Buffer: Add Amazon SQS to queue bursty order requests safely.');
        passed = false;
      } else {
        feedback.push('Passed: Amazon SQS queue acts as a shock absorber.');
      }

      const queueNode = nodes.find(n => n.data.serviceId === 'sqs');
      const hasWorkerAfterQueue = queueNode && edges.some(e => e.source === queueNode.id);
      if (!hasWorkerAfterQueue) {
        feedback.push('Queue Consumer Missing: Connect a worker compute service (ECS or Lambda) downstream of SQS.');
        passed = false;
      } else {
        feedback.push('Passed: Worker compute consumers connected to queue.');
      }

      const score = Math.round(
        (hasCdn ? 30 : 0) +
        (hasQueue ? 40 : 0) +
        (hasWorkerAfterQueue ? 30 : 0)
      );

      return { passed, feedback, score };
    }
  }
];
