import type { ConfigIssue, ServiceModel, ServiceNodeSnapshot } from '../types.ts';

/** Observed Kubernetes workload state, not a scheduler prediction. One canvas workload per Service. */
export interface EksConfiguration {
  kind: 'workload' | 'control-plane'; clusterName: string; namespace: string; workloadName: string;
  compute: 'EC2' | 'FARGATE'; desiredReplicas: number; runningPods: number; readyPods: number;
  serviceSelector: string; podLabel: string; servicePort: number; containerPort: number;
  serviceType: 'ClusterIP' | 'NodePort' | 'LoadBalancer'; image: string;
  controlPlaneAvailable: boolean; nodeCount: number; fargateProfileMatches: boolean;
  hpaEnabled: boolean; metricsAvailable: boolean; cpuRequestMilli: number;
  observedCpuPercent: number; targetCpuPercent: number; minReplicas: number; maxReplicas: number;
  nodeAutoscaler: 'NONE' | 'CLUSTER_AUTOSCALER' | 'KARPENTER' | 'AUTO_MODE';
}
export function eksConfiguration(node: ServiceNodeSnapshot): EksConfiguration {
  const c = (node.customConfig?.eks ?? {}) as Partial<EksConfiguration>;
  const replicas = node.replicas ?? 1;
  return { kind: node.customConfig?.referenceOnly || node.subnet === 'global' ? 'control-plane' : 'workload',
    clusterName: '', namespace: 'default', workloadName: node.label,
    compute: 'EC2', desiredReplicas: replicas, runningPods: replicas, readyPods: replicas,
    serviceSelector: 'app', podLabel: 'app', servicePort: 80, containerPort: 8080,
    serviceType: 'ClusterIP', image: '', controlPlaneAvailable: true,
    nodeCount: 2, fargateProfileMatches: false,
    hpaEnabled: false, metricsAvailable: false, cpuRequestMilli: 100,
    observedCpuPercent: 50, targetCpuPercent: 50, minReplicas: 1, maxReplicas: 10,
    nodeAutoscaler: 'NONE', ...c };
}
export function validateEks(node: ServiceNodeSnapshot): ConfigIssue[] {
  const c = eksConfiguration(node); const issues: ConfigIssue[] = [];
  const bad = (field: string, message: string) => issues.push({ field: `eks.${field}`, message });
  if (!['workload', 'control-plane'].includes(c.kind)) bad('kind', 'Choose workload or control-plane.');
  if (!['EC2', 'FARGATE'].includes(c.compute)) bad('compute', 'Supported compute is EC2 or Fargate.');
  if (!['ClusterIP', 'NodePort', 'LoadBalancer'].includes(c.serviceType)) bad('serviceType', 'Unsupported Kubernetes Service type.');
  for (const field of ['desiredReplicas', 'runningPods', 'readyPods', 'nodeCount', 'minReplicas', 'maxReplicas'] as const) if (!Number.isInteger(c[field]) || c[field] < 0) bad(field, `${field} must be a non-negative integer.`);
  if (c.readyPods > c.runningPods) bad('readyPods', 'Ready pods cannot exceed observed running pods.');
  for (const field of ['servicePort', 'containerPort'] as const) if (!Number.isInteger(c[field]) || c[field] < 1 || c[field] > 65535) bad(field, 'Port must be an integer from 1 to 65535.');
  if (c.minReplicas < 1 || c.maxReplicas < c.minReplicas) bad('maxReplicas', 'HPA bounds require min ≥ 1 and max ≥ min in this model.');
  if (c.targetCpuPercent <= 0 || !Number.isFinite(c.targetCpuPercent)) bad('targetCpuPercent', 'CPU target must be positive.');
  if (!Number.isFinite(c.observedCpuPercent) || c.observedCpuPercent < 0 || !Number.isFinite(c.cpuRequestMilli) || c.cpuRequestMilli < 0) bad('observedCpuPercent', 'CPU utilization and requests must be finite and non-negative.');
  if (c.kind === 'workload' && !['private', 'public', 'isolated'].includes(node.subnet)) bad('subnet', 'EKS workload snapshot requires a VPC subnet.');
  return issues;
}
export function eksReadyEndpoints(node: ServiceNodeSnapshot): number {
  const c = eksConfiguration(node);
  return c.kind === 'workload' && node.health !== 'failed' && !validateEks(node).length
    && c.serviceSelector.length > 0 && c.serviceSelector === c.podLabel ? c.readyPods : 0;
}
export function recommendEksReplicas(node: ServiceNodeSnapshot): { replicas: number | null; reason: string } {
  const c = eksConfiguration(node);
  if (validateEks(node).length) return { replicas: null, reason: 'Correct invalid configuration first.' };
  if (!c.controlPlaneAvailable) return { replicas: null, reason: 'Control plane unavailable: HPA cannot reconcile a new desired state.' };
  if (!c.hpaEnabled) return { replicas: null, reason: 'HPA is not configured. Load alone does not create pods.' };
  if (!c.metricsAvailable || c.cpuRequestMilli <= 0 || c.runningPods === 0) return { replicas: null, reason: 'UNKNOWN: CPU HPA needs observed pod metrics, CPU requests, and running pods. No recommendation.' };
  const replicas = Math.max(c.minReplicas, Math.min(c.maxReplicas, Math.ceil(c.runningPods * c.observedCpuPercent / c.targetCpuPercent)));
  return { replicas, reason: `Basic HPA estimate: ceil(${c.runningPods} × ${c.observedCpuPercent} / ${c.targetCpuPercent}), bounded to ${c.minReplicas}–${c.maxReplicas}. Tolerance, stabilization, missing pod metrics and rollout state are not modeled; this is not a full HPA reconciliation.` };
}
export const eksModel: ServiceModel = {
  id: 'eks', tier: 1, description: 'EKS control-plane reference or Kubernetes Service/Ready-pod workload snapshot; partial coverage.',
  validateConfiguration: validateEks,
  resolveEndpoints: node => ({ requiresEni: eksConfiguration(node).kind === 'workload', isIngressProxy: false, isManagedEventTarget: false, isVpcEndpoint: null }),
  canSend: node => eksConfiguration(node).kind === 'workload' ? { ok: true } : { ok: false, reason: 'Control plane is not an application forwarding hop.' },
  canReceive: node => eksConfiguration(node).kind === 'workload' ? { ok: true } : { ok: false, reason: 'Kubernetes API access/authentication is not simulated by application requests.' },
  processRequest: ({ target }) => {
    const c = eksConfiguration(target); const issues = validateEks(target);
    if (issues.length) return { status: 'failure', statusCode: 400, reason: issues.map(i => i.message).join(' ') };
    if (c.kind === 'control-plane') return { status: 'failure', statusCode: 400, reason: 'EKS control plane is not an application endpoint. Connect traffic to a workload Service; Kubernetes API operations are outside coverage.' };
    if (!eksReadyEndpoints(target)) return { status: 'failure', statusCode: 503, reason: c.serviceSelector !== c.podLabel || !c.serviceSelector ? 'Kubernetes Service selector has no matching pod endpoints.' : `${target.label} has zero Ready pod endpoints. Desired replicas and Running pods do not prove readiness.` };
    return { status: 'success', detail: `Kubernetes Service ${c.workloadName} in namespace ${c.namespace} has ${c.readyPods} matching Ready pod endpoints; port ${c.servicePort} maps to configured targetPort ${c.containerPort}. ${c.controlPlaneAvailable ? '' : 'Control plane unavailable: this observed existing data path may still serve; reconciliation is unavailable. '}No automatic HPA, scheduling, pod startup, target registration or saturation is inferred from traffic.` };
  },
  getDependencies: () => [],
  getFailureModes: () => [{ id: 'eks-no-ready-endpoints', description: 'Service has no matching Ready pod endpoints. Replacement depends on controllers, available compute and startup; not instantaneous.', detectionSystem: 'manual' }]
};
