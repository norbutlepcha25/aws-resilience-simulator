import type { ConfigIssue, ServiceModel, ServiceNodeSnapshot } from '../types.ts';

/** A running ECS service snapshot; counts are observed, not instant scheduler predictions. */
export interface EcsConfiguration {
  launchType?: 'EC2' | 'FARGATE';
  networkMode?: 'awsvpc' | 'bridge' | 'host' | 'none';
  desiredCount?: number;
  runningCount?: number;
}
export function ecsConfiguration(node: ServiceNodeSnapshot): EcsConfiguration {
  return (node.customConfig?.ecs || {}) as EcsConfiguration;
}
export function validateEcs(node: ServiceNodeSnapshot): ConfigIssue[] {
  const c = ecsConfiguration(node);
  const issues: ConfigIssue[] = [];
  if (c.launchType && !['EC2', 'FARGATE'].includes(c.launchType)) issues.push({ field: 'ecs.launchType', message: 'Supported ECS launch types are EC2 and FARGATE.' });
  if (c.networkMode && c.networkMode !== 'awsvpc') issues.push({ field: 'ecs.networkMode', message: c.launchType === 'FARGATE'
    ? 'Fargate requires awsvpc networking.' : 'UNSUPPORTED: ECS bridge/host/none networking is not simulated. Use awsvpc for this model.' });
  if (!['private', 'public', 'isolated'].includes(node.subnet)) issues.push({ field: 'subnet', message: 'ECS awsvpc tasks require a VPC subnet.' });
  for (const field of ['desiredCount', 'runningCount'] as const) {
    const count = c[field];
    if (count !== undefined && (!Number.isInteger(count) || count < 0)) issues.push({ field: `ecs.${field}`, message: `${field} must be a non-negative integer.` });
  }
  return issues;
}
export function ecsHasAvailableTasks(node: ServiceNodeSnapshot): boolean {
  const c = ecsConfiguration(node);
  return node.health !== 'failed' && (c.runningCount ?? node.replicas ?? 1) > 0;
}
export const ecsModel: ServiceModel = {
  id: 'ecs', tier: 1, description: 'Running ECS service using task ENIs (awsvpc), on EC2 or Fargate.',
  validateConfiguration: validateEcs,
  resolveEndpoints: () => ({ requiresEni: true, isIngressProxy: false, isManagedEventTarget: false, isVpcEndpoint: null }),
  canSend: () => ({ ok: true }), canReceive: () => ({ ok: true }),
  processRequest: ({ target }) => {
    const issues = validateEcs(target);
    if (issues.length) return { status: 'failure', statusCode: 400, reason: issues.map(i => i.message).join(' ') };
    if (!ecsHasAvailableTasks(target)) return { status: 'failure', statusCode: 503, reason: `${target.label} has no available running tasks. Desired count is not proof that a task is running.` };
    return { status: 'success', detail: `${target.label} has an available running task. Load saturation and scheduler timing are not modeled; no automatic scale-out is assumed.` };
  },
  getDependencies: () => ['rds', 's3'],
  getFailureModes: () => [{ id: 'ecs-scheduler-task-failure', description: 'Unavailable tasks cannot receive traffic. Replacement requires scheduler placement and startup; recovery is not instantaneous.', detectionSystem: 'ecs_scheduler' }]
};
