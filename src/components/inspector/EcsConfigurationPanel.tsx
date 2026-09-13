import type { ServiceNodeData } from '../../types/index.ts';
import { ecsConfiguration } from '../../engine/service/models/ecs.ts';

/** Configuration input only; validation and runtime decisions belong to the ECS model. */
export function EcsConfigurationPanel({ data, onChange }: {
  data: ServiceNodeData;
  onChange: (config: NonNullable<ServiceNodeData['customConfig']>) => void;
}) {
  const config = ecsConfiguration(data);
  const update = (values: Record<string, unknown>) => onChange({ ...data.customConfig, ecs: { ...config, ...values } });
  return <section className="p-3 rounded-xl border border-slate-200 space-y-3">
    <h4 className="text-xs font-bold">ECS running service · partial coverage</h4>
    <label className="block text-xs">Launch type
      <select className="block w-full mt-1 border rounded p-1" value={config.launchType ?? 'EC2'} onChange={event => update({ launchType: event.target.value })}>
        <option value="EC2">EC2</option><option value="FARGATE">Fargate</option>
      </select>
    </label>
    <p className="text-xs text-slate-500">This model supports awsvpc task networking. Scheduler timing and load saturation are not simulated.</p>
    {(['desiredCount', 'runningCount'] as const).map(field => <label key={field} className="block text-xs">
      {field === 'desiredCount' ? 'Desired tasks' : 'Observed running tasks'}
      <input type="number" min="0" step="1" className="block w-full mt-1 border rounded p-1" value={config[field] ?? data.replicas ?? 1}
        onChange={event => update({ [field]: Number(event.target.value) })} />
    </label>)}
  </section>;
}
