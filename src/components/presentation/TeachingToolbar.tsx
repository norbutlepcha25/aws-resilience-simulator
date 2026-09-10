import React from 'react';
import { useArchitecture } from '../../context/ArchitectureContext.tsx';
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Flame,
  RotateCcw,
  X
} from 'lucide-react';

export const TeachingToolbar: React.FC = () => {
  const {
    isTeachingMode,
    setIsTeachingMode,
    simulationResult,
    activeStepIndex,
    stepForward,
    stepBackward,
    isPlaying,
    setIsPlaying,
    runScenario,
    failAvailabilityZone,
    restoreAllNodes
  } = useArchitecture();

  if (!isTeachingMode) return null;

  const currentStep = (simulationResult && activeStepIndex !== null)
    ? simulationResult.steps[activeStepIndex]
    : null;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-white border border-slate-200 rounded-2xl shadow-xl p-4 flex flex-col gap-3 min-w-[650px] max-w-3xl animate-in slide-in-from-top-4 select-none">
      {/* Top row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-medium text-xs">
            Teaching Mode
          </span>
          <span className="text-sm font-semibold text-slate-900">
            Interactive Classroom Presentation
          </span>
        </div>
        <button
          onClick={() => setIsTeachingMode(false)}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors"
          title="Exit Teaching Mode"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Narrative Explanation Callout */}
      {currentStep ? (
        <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-1">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-slate-900 font-semibold">
              STEP {currentStep.stepNumber}: {currentStep.targetNodeName}
            </span>
            <span className="text-slate-500 font-medium">
              Action: {currentStep.action}
            </span>
          </div>
          <p className="text-sm text-slate-800 leading-relaxed font-sans font-normal">
            {currentStep.explanation}
          </p>
        </div>
      ) : (
        <div className="p-3 rounded-xl bg-white border border-slate-200 text-sm text-slate-600 text-center">
          Click <b>Send Request</b> to step through the diagram live with students.
        </div>
      )}

      {/* Action Controls Row */}
      <div className="flex items-center justify-between pt-1">
        {/* Playback Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (!simulationResult) runScenario();
              else setIsPlaying(!isPlaying);
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#232F3E] hover:bg-[#1A232E] text-white font-black text-xs shadow-xs transition-colors"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
            <span>{isPlaying ? 'PAUSE' : 'RUN SIMULATION'}</span>
          </button>

          <button
            onClick={stepBackward}
            disabled={!simulationResult || activeStepIndex === 0}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-30 transition-colors"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            onClick={stepForward}
            disabled={!simulationResult || (simulationResult && activeStepIndex === simulationResult.steps.length - 1)}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-30 transition-colors"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        {/* Live Chaos Experiments */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => failAvailabilityZone('AZ-A')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 text-xs font-bold transition-colors"
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Simulate AZ-A Outage</span>
          </button>

          <button
            onClick={restoreAllNodes}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-bold transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restore Health</span>
          </button>
        </div>
      </div>
    </div>
  );
};
