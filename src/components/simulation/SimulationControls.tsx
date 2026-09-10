import React from 'react';
import { useArchitecture } from '../../context/ArchitectureContext.tsx';
import {
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  SkipBack,
  Gauge,
  Send,
  CheckCircle2,
  XCircle,
  Route
} from 'lucide-react';

export const SimulationControls: React.FC = () => {
  const {
    scenario,
    setScenario,
    runScenario,
    resetSimulation,
    simulationResult,
    activeStepIndex,
    stepForward,
    stepBackward,
    isPlaying,
    setIsPlaying,
    playbackSpeed,
    setPlaybackSpeed,
    highlightTaskFlow,
    toggleTaskFlow
  } = useArchitecture();

  const totalSteps = simulationResult?.steps.length || 0;
  const currentStepNum = activeStepIndex !== null ? activeStepIndex + 1 : 0;

  return (
    <div className="bg-white border-t border-slate-200 px-6 py-2.5 shadow-sm flex flex-wrap items-center justify-between gap-4 z-10 select-none">
      {/* Left: Request Parameters */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 font-mono text-xs">
          {/* HTTP Method */}
          <select
            value={scenario.method}
            onChange={(e) => setScenario(prev => ({ ...prev, method: e.target.value as any }))}
            className="px-2 py-1 rounded-md bg-white border border-slate-200 text-slate-800 font-medium focus:outline-none focus:border-slate-400"
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
          </select>

          {/* Request Path */}
          <input
            type="text"
            value={scenario.path}
            onChange={(e) => setScenario(prev => ({ ...prev, path: e.target.value }))}
            placeholder="/products"
            className="w-36 px-2.5 py-1 rounded-md bg-white border border-slate-200 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400"
          />
        </div>

        {/* Traffic Load Selector */}
        <div className="flex items-center gap-1.5 text-xs text-slate-600">
          <Gauge className="w-3.5 h-3.5 text-slate-400" />
          <span className="font-normal text-slate-500">Load:</span>
          <select
            value={scenario.trafficLevel}
            onChange={(e) => setScenario(prev => ({ ...prev, trafficLevel: e.target.value as any }))}
            className="px-2 py-1 rounded-md bg-white border border-slate-200 text-slate-800 focus:outline-none focus:border-slate-400 font-mono text-xs"
          >
            <option value="low">Low (1 req/s)</option>
            <option value="normal">Normal (10 req/s)</option>
            <option value="high">High (100 req/s)</option>
            <option value="10x">10x Surge Spike</option>
            <option value="100x">100x Extreme Spike</option>
          </select>
        </div>

        {/* Run Request Button */}
        <button
          onClick={runScenario}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#232F3E] hover:bg-[#1A232E] text-white font-medium text-xs shadow-xs active:scale-98 transition-all"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Send Request</span>
        </button>

        {/* Task Flow Highlighting Toggle */}
        <button
          onClick={toggleTaskFlow}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
            highlightTaskFlow
              ? 'bg-blue-50 text-blue-700 border-blue-300 shadow-xs'
              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}
          title={highlightTaskFlow ? 'Task flow lines highlighted (click to disable)' : 'Click to highlight task flow lines'}
        >
          <Route className="w-3.5 h-3.5 text-blue-600" />
          <span>Task Flow</span>
          <span className={`w-1.5 h-1.5 rounded-full ${highlightTaskFlow ? 'bg-blue-600 animate-pulse' : 'bg-slate-300'}`} />
        </button>
      </div>

      {/* Center: Playback Controls */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 bg-slate-100/80 p-1 rounded-lg border border-slate-200">
          {/* Step Back */}
          <button
            onClick={stepBackward}
            disabled={!simulationResult || activeStepIndex === 0}
            className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Step backward"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          {/* Play / Pause */}
          <button
            onClick={() => {
              if (!simulationResult) {
                runScenario();
              } else {
                setIsPlaying(!isPlaying);
              }
            }}
            className="p-1 rounded text-slate-800 bg-white hover:bg-slate-50 shadow-xs transition-colors"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-4 h-4 text-slate-800" /> : <Play className="w-4 h-4 text-slate-800 fill-current" />}
          </button>

          {/* Step Forward */}
          <button
            onClick={stepForward}
            disabled={!simulationResult || (simulationResult && activeStepIndex === totalSteps - 1)}
            className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Step forward"
          >
            <SkipForward className="w-4 h-4" />
          </button>

          {/* Reset */}
          <button
            onClick={resetSimulation}
            disabled={!simulationResult}
            className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Reset simulation"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        {/* Step Counter */}
        {simulationResult && (
          <div className="text-xs font-mono text-slate-600 bg-slate-100 px-2.5 py-1 rounded border border-slate-200">
            Step <span className="text-slate-900 font-semibold">{currentStepNum}</span> of {totalSteps}
          </div>
        )}

        {/* Speed Controls */}
        <div className="flex items-center gap-1 text-[10px] font-mono font-bold bg-slate-100 p-0.5 rounded border border-slate-200">
          {[0.5, 1, 2].map((sp) => (
            <button
              key={sp}
              onClick={() => setPlaybackSpeed(sp)}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                playbackSpeed === sp
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {sp}x
            </button>
          ))}
        </div>
      </div>

      {/* Right: Simulation Result Summary Pill */}
      {simulationResult ? (
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-bold border ${
              simulationResult.success
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                : 'bg-rose-50 text-rose-800 border-rose-300'
            }`}
          >
            {simulationResult.success ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-rose-600" />
            )}
            <span>HTTP {simulationResult.statusCode}</span>
            <span className="text-[10px] opacity-80">({simulationResult.totalLatencyMs}ms)</span>
          </div>
        </div>
      ) : (
        <div className="text-xs text-slate-500 font-mono hidden md:block">
          Ready to simulate flow
        </div>
      )}
    </div>
  );
};
