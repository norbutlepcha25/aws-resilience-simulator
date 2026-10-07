import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Layers, Box, Server, Cloud, Network, Activity, ArrowDown } from 'lucide-react';
import type { Node, Edge } from '@xyflow/react';
import type { ServiceNodeData } from '../../types/index.ts';
import { eksConfiguration, eksReadyEndpoints, recommendEksReplicas, validateEks, type EksConfiguration } from '../../engine/service/models/eks.ts';
const button = 'min-h-11 rounded border border-slate-300 px-3 py-2 text-sm bg-white hover:bg-circuit-50 focus-visible:outline-circuit-600';
const input = 'w-full block mt-1 border border-slate-300 rounded p-2 bg-white text-sm';
type Section = 'cluster' | 'workload' | 'service' | 'compute' | 'hpa' | 'container';
export function EksExplorer({ nodeId, nodes, edges, onUpdate, onClose }: {
  nodeId: string; nodes: Node<ServiceNodeData>[]; edges: Edge[];
  onUpdate: (id: string, patch: Partial<ServiceNodeData>) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState(nodeId);
  const [section, setSection] = useState<Section>('workload');
  const origin = nodes.find(n => n.id === nodeId)!;
  const originConfig = eksConfiguration(origin.data);
  const members = nodes.filter(n => n.data.serviceId === 'eks' && (n.id === nodeId || (originConfig.clusterName && eksConfiguration(n.data).clusterName === originConfig.clusterName)));
  const selected = members.find(n => n.id === selectedId) ?? origin;
  const c = eksConfiguration(selected.data);
  const update = (patch: Partial<EksConfiguration>) => onUpdate(selected.id, { customConfig: { ...selected.data.customConfig, eks: { ...selected.data.customConfig?.eks, ...patch } } });
  const choose = (id: string, part: Section) => { setSelectedId(id); setSection(part); };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; dialog.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  const text = (label: string, key: 'clusterName' | 'namespace' | 'workloadName' | 'serviceSelector' | 'podLabel' | 'image') => <label className="block text-sm">{label}<input className={input} value={c[key]} onChange={e => update({ [key]: e.target.value })} /></label>;
  const number = (label: string, key: 'desiredReplicas' | 'runningPods' | 'readyPods' | 'servicePort' | 'containerPort' | 'nodeCount' | 'cpuRequestMilli' | 'observedCpuPercent' | 'targetCpuPercent' | 'minReplicas' | 'maxReplicas') => <label className="block text-sm">{label}<input className={input} type="number" min="0" value={c[key]} onChange={e => update({ [key]: Number(e.target.value) })} /></label>;
  const check = (label: string, key: 'controlPlaneAvailable' | 'fargateProfileMatches' | 'hpaEnabled' | 'metricsAvailable') => <label className="flex gap-2 text-sm"><input type="checkbox" checked={c[key]} onChange={e => update({ [key]: e.target.checked })} />{label}</label>;
  const recommendation = recommendEksReplicas(selected.data);
  const titles = { cluster: 'Cluster & control plane', workload: 'Deployment & pod snapshot', service: 'Kubernetes Service', compute: 'Compute capacity', hpa: 'Horizontal Pod Autoscaler', container: 'Container blueprint' };
  const links = edges.filter(e => e.source === selected.id || e.target === selected.id);
  return createPortal(<div className="fixed inset-0 z-[11000] bg-slate-900/60 p-2 sm:p-6 flex justify-center items-center" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="eks-title" tabIndex={-1} className="w-full max-w-7xl h-[92dvh] bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden text-slate-900" onKeyDown={e => {
      e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'Tab') {
        const items = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]');
        if (!items?.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { e.preventDefault(); first.focus(); }
      }
    }}>
      <header className="p-4 border-b flex justify-between gap-4 items-center"><div><p className="text-xs text-slate-500">Architecture / Amazon EKS</p><h2 id="eks-title" className="text-xl font-semibold">Inside {origin.data.label}</h2></div><button className={button} aria-label="Close EKS explorer" onClick={onClose}><X size={20} /></button></header>
      <p className="px-5 py-3 border-b bg-slate-50 text-xs text-slate-600">Partial simulation: Service selectors and observed Ready endpoints govern requests. Cluster names group canvas snapshots; they do not create a real cluster. Changes save immediately.</p>
      <div className="flex-1 min-h-0 grid lg:grid-cols-[minmax(0,1fr)_360px] overflow-y-auto lg:overflow-hidden">
        <main className="min-w-0 p-4 sm:p-6 bg-slate-50 lg:overflow-y-auto space-y-4">
          <section aria-label="EKS cluster boundary" className="border-2 border-circuit-500 rounded-xl overflow-hidden bg-white">
            <button className="w-full p-4 bg-circuit-50 text-left flex gap-3 items-center min-h-11 focus-visible:outline-circuit-600" onClick={() => choose(origin.id, 'cluster')}><Layers className="text-circuit-700" /><strong>{originConfig.clusterName || 'Cluster · unnamed'}</strong></button>
            <div className="p-4 space-y-4">
              <button className={`${button} w-full text-left bg-slate-100`} onClick={() => choose(selected.id, 'cluster')}><Layers size={18} className="inline mr-2" />AWS-managed control plane<span className="block text-xs text-slate-600 mt-1">API server · scheduler · controllers. Application traffic goes to workloads; this is a management relationship.</span></button>
              {members.filter(n => eksConfiguration(n.data).kind === 'workload').map(n => {
                const w = eksConfiguration(n.data); const ready = eksReadyEndpoints(n.data);
                const shown = Number.isFinite(w.runningPods) ? Math.min(8, Math.max(0, Math.floor(w.runningPods))) : 0;
                return <section key={n.id} aria-label={`EKS namespace boundary: ${w.namespace}`} className={`border rounded-lg p-3 space-y-3 ${selected.id === n.id ? 'border-circuit-600' : 'border-slate-300'}`}>
                  <p className="text-xs font-semibold text-slate-500">Namespace: {w.namespace}</p>
                  <button className={`${button} w-full text-left`} onClick={() => choose(n.id, 'workload')}><Layers size={18} className="inline mr-2" />Deployment: {w.workloadName}<span className="block text-xs text-slate-600 mt-1">{w.desiredReplicas} desired · {w.runningPods} observed running · {w.readyPods} observed Ready</span></button>
                  <button className={`${button} w-full text-left bg-circuit-50`} onClick={() => choose(n.id, 'service')}><Network size={18} className="inline mr-2" />Service ({w.serviceType}) · {ready} eligible endpoints<span className="block text-xs mt-1">Selector {w.serviceSelector || '(empty)'} → pod label {w.podLabel || '(empty)'} · port {w.servicePort} → targetPort {w.containerPort}</span></button>
                  <ArrowDown size={18} className="mx-auto text-circuit-700" aria-hidden="true" />
                  <div className="grid sm:grid-cols-2 gap-3">{Array.from({ length: shown }, (_, i) => <section key={i} aria-label={`EKS pod snapshot ${i + 1}`} className="border rounded bg-slate-50 p-3 space-y-2"><button onClick={() => choose(n.id, 'workload')} className={`${button} w-full text-left`}><Box size={16} className="inline mr-2" />Pod {i + 1} · {i < w.readyPods ? 'Ready' : 'Not Ready'}</button><button className={`${button} w-full text-left border-dashed`} onClick={() => choose(n.id, 'container')}><Box size={18} className="inline mr-2 text-circuit-700" />Container<span className="block mt-1 text-xs break-all text-slate-600">{w.image || 'Image not specified'}</span></button></section>)}</div>
                  {shown === 0 && <p className="text-sm text-slate-600 p-3 border border-dashed rounded">No observed running pods. Desired replicas do not prove that pods have started.</p>}
                  {w.runningPods > 8 && <p className="text-xs">Showing 8 of {w.runningPods} pod snapshots.</p>}
                  <div><button className={`${button} text-left`} onClick={() => choose(n.id, 'hpa')}><Activity size={18} className="inline mr-2" />HPA · {w.hpaEnabled ? 'Configured' : 'Not configured'}<span className="block text-xs text-slate-500 mt-1">Pod scaling and node scaling are separate</span></button></div>
                </section>;
              })}
              <section aria-label="EKS compute references" className="border rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-slate-500">Cluster compute references · nodes are not namespace resources</p>
                {members.filter(n => eksConfiguration(n.data).kind === 'workload').map(n => {
                  const w = eksConfiguration(n.data);
                  return <button key={n.id} className={`${button} w-full text-left`} onClick={() => choose(n.id, 'compute')}>{w.compute === 'FARGATE' ? <Cloud size={18} className="inline mr-2" /> : <Server size={18} className="inline mr-2" />}{w.compute === 'FARGATE' ? 'Fargate pod compute' : `EC2 node group · ${w.nodeCount} nodes`}<span className="block text-xs text-slate-500 mt-1">{w.workloadName} snapshot annotation · shared group identity and placement are not inferred</span></button>;
                })}
              </section>
              {c.kind === 'control-plane' && !members.some(n => eksConfiguration(n.data).kind === 'workload') && <p className="text-sm">This is a control-plane reference. Give workload snapshots the same cluster name to display them here.</p>}
            </div>
          </section>
          <p className="text-xs text-slate-500">Numbered pods are aggregate snapshot illustrations, not live pod IDs or placements. ALB, NLB, IAM, and ECR remain external resources; inspect their own icons.</p>
        </main>
        <aside aria-label="EKS component details" className="p-5 border-t lg:border-t-0 lg:border-l lg:overflow-y-auto space-y-4">
          <h3 className="font-semibold text-lg">{titles[section]}</h3>
          {section === 'cluster' && <>{text('Cluster name', 'clusterName')}<label className="block text-sm">Canvas representation<select className={input} value={c.kind} onChange={e => update({ kind: e.target.value as EksConfiguration['kind'] })}><option value="workload">Workload Service snapshot</option><option value="control-plane">Control-plane reference</option></select></label>{check('Control plane available for reconciliation', 'controlPlaneAvailable')}<p className="text-sm text-slate-600">AWS manages the control plane. Existing Ready pods may still serve during API unavailability; desired-state changes need reconciliation. This checkbox describes this snapshot, not every workload grouped by name.</p><a className="text-sm underline text-circuit-700" href="https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-concepts.html" target="_blank" rel="noreferrer">AWS: EKS components</a></>}
          {section === 'workload' && <>{text('Cluster name', 'clusterName')}{text('Namespace', 'namespace')}{text('Deployment name', 'workloadName')}{number('Desired replicas', 'desiredReplicas')}{number('Observed running pods', 'runningPods')}{number('Observed Ready pods', 'readyPods')}<p className="text-xs text-slate-600">Desired state does not automatically change observed state. Running does not imply Ready. Replacements and startup are not instantaneous.</p><button className={button} onClick={() => update({ readyPods: 0 })}>Make all pods Not Ready</button></>}
          {section === 'service' && <>{text('Service selector (single label value)', 'serviceSelector')}{text('Pod label (single label value)', 'podLabel')}{number('Service port', 'servicePort')}{number('Container / target port', 'containerPort')}<label className="block text-sm">Service type<select className={input} value={c.serviceType} onChange={e => update({ serviceType: e.target.value as EksConfiguration['serviceType'] })}><option>ClusterIP</option><option>NodePort</option><option>LoadBalancer</option></select></label><p className="text-sm text-slate-600">The model matches one label value and counts Ready endpoints. ClusterIP is internal; selecting LoadBalancer does not provision an AWS load balancer. Configure the controller and actual ALB/NLB separately. DNS, EndpointSlice objects, kube-proxy, NodePort and NetworkPolicy are not executed.</p><a className="underline text-sm text-circuit-700" href="https://kubernetes.io/docs/concepts/services-networking/service/" target="_blank" rel="noreferrer">Kubernetes: Services and endpoints</a></>}
          {section === 'compute' && <><label className="block text-sm">Compute<select className={input} value={c.compute} onChange={e => update({ compute: e.target.value as EksConfiguration['compute'] })}><option value="EC2">EC2 managed node group</option><option value="FARGATE">Fargate</option></select></label>{c.compute === 'EC2' ? <>{number('Observed node count (annotation)', 'nodeCount')}<label className="block text-sm">Node autoscaler (annotation)<select className={input} value={c.nodeAutoscaler} onChange={e => update({ nodeAutoscaler: e.target.value as EksConfiguration['nodeAutoscaler'] })}><option value="NONE">None</option><option value="CLUSTER_AUTOSCALER">Cluster Autoscaler</option><option value="KARPENTER">Karpenter</option><option value="AUTO_MODE">EKS Auto Mode</option></select></label></> : <>{check('Fargate profile matches namespace / labels (annotation)', 'fargateProfileMatches')}<p className="text-sm">Fargate needs a matching profile for new pods and supplies per-pod compute. It has no customer EC2 node group to scale. Profiles and startup are not evaluated here.</p></>}<p className="text-xs text-slate-600">Compute fields are descriptive. HPA changes pods; Cluster Autoscaler / Karpenter / Auto Mode address compute capacity. Scheduling, limits, taints, node health and placement are outside this snapshot model.</p><a className="text-sm underline text-circuit-700" href="https://docs.aws.amazon.com/eks/latest/userguide/autoscaling.html" target="_blank" rel="noreferrer">AWS: compute scaling</a></>}
          {section === 'container' && <>{text('Container image URI', 'image')}{number('CPU request (millicores)', 'cpuRequestMilli')}<p className="text-xs">Blueprint only. EKS uses a container runtime; this view does not assume a Docker daemon. Image pulls, secrets, volumes and container startup are not executed.</p></>}
          {section === 'hpa' && <>{check('HPA configured', 'hpaEnabled')}{check('Pod CPU metrics available', 'metricsAvailable')}{number('Observed CPU utilization (% of CPU requests)', 'observedCpuPercent')}{number('CPU request (millicores)', 'cpuRequestMilli')}{number('Target CPU utilization (%)', 'targetCpuPercent')}{number('Minimum replicas', 'minReplicas')}{number('Maximum replicas', 'maxReplicas')}<p role="status" className="text-sm">{recommendation.reason}</p><button className={`${button} disabled:opacity-50`} disabled={recommendation.replicas === null || c.kind !== 'workload'} onClick={() => { if (recommendation.replicas !== null) update({ desiredReplicas: recommendation.replicas }); }}>Apply estimate to desired replicas</button><p className="text-xs text-slate-600">This basic estimate does not start pods. Real HPA has tolerance, stabilization and metric handling. Requests never create pods automatically.</p><a className="underline text-sm text-circuit-700" href="https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/" target="_blank" rel="noreferrer">Kubernetes: HPA algorithm</a></>}
          {validateEks(selected.data).length > 0 && <div role="alert" className="border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{validateEks(selected.data).map(i => <p key={i.field}>{i.message}</p>)}</div>}
          <section className="border-t pt-3 space-y-2"><h4 className="text-sm font-semibold">Canvas connections</h4>{links.length === 0 && <p className="text-xs text-slate-500">No connections.</p>}{links.map(e => <p key={e.id} className="text-xs border rounded p-2">{e.source === selected.id ? 'To ' : 'From '}{nodes.find(n => n.id === (e.source === selected.id ? e.target : e.source))?.data.label || 'Missing resource'}</p>)}</section>
        </aside>
      </div>
    </div>
  </div>, document.body);
}
