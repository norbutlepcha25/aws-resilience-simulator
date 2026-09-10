import React, { useRef, useEffect } from 'react';
import { useArchitecture } from '../../context/ArchitectureContext.tsx';
import {
  Clock,
  CheckCircle2,
  XCircle,
  ChevronRight
} from 'lucide-react';

export const EventTimeline: React.FC = () => {
  const {
    simulationResult,
    activeStepIndex,
    setActiveStepIndex,
    setHoveredStepIndex,
    setSelectedNodeId
  } = useArchitecture();

  const timelineContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll timeline to active step
  useEffect(() => {
    if (activeStepIndex !== null && timelineContainerRef.current) {
      const activeEl = timelineContainerRef.current.children[activeStepIndex] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [activeStepIndex]);

  if (!simulationResult || simulationResult.steps.length === 0) {
    return null;
  }

  const activeStep = activeStepIndex !== null ? simulationResult.steps[activeStepIndex] : null;

  return (
    <div className="bg-white border-t border-slate-200 flex flex-col max-h-52 select-none z-10 shadow-xs">
      {/* Top Banner / Active Event Detail */}
      <div className="px-6 py-2 border-b border-slate-100 bg-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-xs font-semibold text-slate-800">
            Request Flow Timeline
          </span>
          <span className="text-[10px] text-slate-400 font-mono">
            (Click step to scrub)
          </span>
        </div>

        {activeStep && (
          <div className="text-xs text-slate-600 font-mono flex items-center gap-2">
            <span className="text-slate-900 font-semibold">{activeStep.targetNodeName}</span>
            <span className="text-slate-400">:</span>
            <span className="text-slate-700 truncate max-w-md">{activeStep.action}</span>
          </div>
        )}
      </div>

      {/* Timeline Steps Horizontal Scroll */}
      <div
        ref={timelineContainerRef}
        className="flex-1 overflow-x-auto p-3 flex items-stretch gap-3 custom-scrollbar bg-white"
      >
        {simulationResult.steps.map((step, idx) => {
          const isActive = activeStepIndex === idx;
          const isFailed = step.status === 'failed';

          return (
            <div
              key={step.id}
              onClick={() => {
                setActiveStepIndex(idx);
                setSelectedNodeId(step.targetNodeId);
              }}
              onMouseEnter={() => setHoveredStepIndex(idx)}
              onMouseLeave={() => setHoveredStepIndex(null)}
              className={`min-w-[250px] max-w-[280px] flex-shrink-0 p-2.5 rounded-xl border transition-all cursor-pointer ${
                isActive
                  ? 'bg-white border-blue-600 ring-2 ring-blue-500/20 shadow-sm'
                  : 'bg-white border-slate-200 hover:border-blue-300 hover:shadow-xs'
              }`}
            >
              {/* Event Top Bar */}
              <div className="flex items-center justify-between gap-1 mb-1">
                <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
                  <span className="w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-[10px]">
                    {idx + 1}
                  </span>
                  <span className="font-bold">+{step.timestampMs}ms</span>
                  <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 font-semibold">
                    {step.protocol}
                  </span>
                </div>

                {isFailed ? (
                  <span className="flex items-center gap-1 text-[10px] text-rose-600 font-bold">
                    <XCircle className="w-3.5 h-3.5" /> FAILED
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-bold">
                    <CheckCircle2 className="w-3.5 h-3.5" /> OK
                  </span>
                )}
              </div>

              {/* Action Title */}
              <div className="text-xs font-bold text-slate-900 truncate mb-0.5">
                {step.action}
              </div>

              {/* Node Source -> Target */}
              <div className="flex items-center gap-1 text-[11px] text-slate-600 mb-1 truncate">
                <span className="truncate">{step.sourceNodeName}</span>
                <ChevronRight className="w-3 h-3 text-slate-400 flex-shrink-0" />
                <span className="text-slate-900 font-semibold truncate">{step.targetNodeName}</span>
              </div>

              {/* Educational Explanation */}
              <p className="text-[10px] text-slate-600 leading-snug line-clamp-2">
                {step.explanation}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};
