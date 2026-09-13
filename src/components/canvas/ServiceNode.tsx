import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { ServiceNodeData } from '../../types/index.ts';
import { SERVICE_MAP } from '../../data/serviceCatalog.ts';
import { AwsServiceIcon } from '../icons/AwsServiceIcons.tsx';
import { XCircle, CheckCircle2, AlertTriangle } from 'lucide-react';

export const ServiceNode = memo((props: any) => {
  const { data, selected } = props;
  const nodeData = data as ServiceNodeData;
  const serviceDef = SERVICE_MAP[nodeData.serviceId] || {
    name: nodeData.label || 'AWS Service',
    category: nodeData.category || 'Compute',
    color: '#ED7100',
    iconName: nodeData.serviceId
  };

  const isFailed = nodeData.health === 'failed';
  const isDegraded = nodeData.health === 'degraded';
  const isSimActive = nodeData.isSimulating;

  // Visual halo for active simulation, failure, or degradation - driven entirely by the
  // simulation/failure engines' real `health`/`isSimulating` state, never decorative.
  let iconWrapperClasses = 'transition-all duration-200';
  if (isFailed) {
    iconWrapperClasses += ' ring-2 ring-rose-500 rounded-lg p-0.5 bg-rose-50';
  } else if (isSimActive) {
    iconWrapperClasses += ' ring-4 ring-amber-400 rounded-lg p-0.5 shadow-lg shadow-amber-300/60 scale-105';
  } else if (isDegraded) {
    iconWrapperClasses += ' ring-2 ring-amber-400 rounded-lg p-0.5 bg-amber-50';
  } else if (selected) {
    iconWrapperClasses += ' ring-2 ring-circuit-600 rounded-lg p-0.5 shadow-md shadow-circuit-200';
  }

  return (
    <div className="flex flex-col items-center justify-center p-1 select-none group min-w-[100px] max-w-[140px] text-center">
      {/* Target Handles (Left & Top) */}
      <Handle
        type="target"
        position={Position.Left}
        id="target-left"
        className="!w-2.5 !h-2.5 !bg-slate-400 hover:!bg-circuit-600 !border-2 !border-white transition-colors"
      />
      <Handle
        type="target"
        position={Position.Top}
        id="target-top"
        className="!w-2.5 !h-2.5 !bg-slate-400 hover:!bg-circuit-600 !border-2 !border-white transition-colors"
      />

      {/* Official AWS Service Icon */}
      <div className="relative flex items-center justify-center">
        <div className={iconWrapperClasses}>
          <AwsServiceIcon serviceId={nodeData.serviceId} size={50} />
        </div>

        {/* Failed overlay tag */}
        {isFailed && (
          <div className="absolute -top-2 -right-2 bg-rose-600 text-white rounded-full p-0.5 shadow-md">
            <XCircle className="w-3.5 h-3.5 fill-current" />
          </div>
        )}

        {/* Active Simulation Spinner Badge */}
        {isSimActive && (
          <div className="absolute -top-2 -right-2 bg-amber-500 text-slate-900 rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-bold animate-ping-slow shadow-md">
            ●
          </div>
        )}

        {/* Degraded overlay tag - distinct from Failed (red X): still serving traffic, but not
            at full health (e.g. one target down behind a load balancer that still has others). */}
        {isDegraded && !isFailed && !isSimActive && (
          <div className="absolute -top-2 -right-2 bg-amber-500 text-white rounded-full p-0.5 shadow-md">
            <AlertTriangle className="w-3.5 h-3.5 fill-current text-white" />
          </div>
        )}
      </div>

      {/* Clean Service Label under the icon (matches reference diagram) */}
      <div className="mt-1.5 px-1 leading-tight">
        <span className="text-[12px] font-semibold text-slate-900 tracking-tight block">
          {nodeData.label || serviceDef.name}
        </span>
        {nodeData.notes && (
          <span className="text-[10px] text-slate-500 line-clamp-1 mt-0.5">
            {nodeData.notes}
          </span>
        )}
      </div>

      {/* Source Handles (Right & Bottom) */}
      <Handle
        type="source"
        position={Position.Right}
        id="source-right"
        className="!w-2.5 !h-2.5 !bg-slate-400 hover:!bg-circuit-600 !border-2 !border-white transition-colors"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="source-bottom"
        className="!w-2.5 !h-2.5 !bg-slate-400 hover:!bg-circuit-600 !border-2 !border-white transition-colors"
      />
    </div>
  );
});

ServiceNode.displayName = 'ServiceNode';
