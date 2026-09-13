import React, { useState } from 'react';
import { useArchitecture } from '../../context/ArchitectureContext.tsx';
import { CASCADING_FAILURE_STAGES } from '../../engine/failure/cascadingFailure.ts';
import {
  Flame,
  RotateCcw,
  Activity,
  X,
  ArrowRight
} from 'lucide-react';

export const FailureControls: React.FC = () => {
  const {
    nodes,
    effectiveNodes,
    injectFailure,
    restoreAllNodes,
    failureImpacts
  } = useArchitecture();

  const [showCascadingModal, setShowCascadingModal] = useState(false);
  const [currentCascadeStage, setCurrentCascadeStage] = useState(0);

  const azANodes = nodes.filter(n => n.data.az === 'AZ-A');
  const azBNodes = nodes.filter(n => n.data.az === 'AZ-B');
  // Reflects the REAL propagated consequence of every active failure (Phase 9's failure engine),
  // not just the directly-targeted nodes - a node can end up failed here purely as a cascade.
  const failedNodes = effectiveNodes.filter(n => n.data.health === 'failed');

  const injectAzFailure = (az: 'AZ-A' | 'AZ-B') => {
    injectFailure({
      targetResourceId: az,
      failureType: 'az_failure',
      severity: 'critical',
      trigger: 'manual',
      reason: `Zone Outage (${az} Hardware Failure)`
    });
  };

  return (
    <>
      <div className="bg-white border-b border-slate-200 px-6 py-2 flex flex-wrap items-center justify-between gap-3 text-xs select-none">
        {/* Left: Fault Simulation Actions */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-medium text-slate-700">
            <Flame className="w-4 h-4 text-slate-500" />
            <span>Fault Simulation:</span>
          </div>

          {/* Fail AZ-A */}
          <button
            onClick={() => injectAzFailure('AZ-A')}
            disabled={azANodes.length === 0}
            className="px-2.5 py-1 rounded bg-white hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-200 hover:border-rose-300 font-medium disabled:opacity-40 transition-colors shadow-2xs"
            title="Inject a structured AZ failure through the failure propagation engine"
          >
            Simulate AZ-A Outage ({azANodes.length})
          </button>

          {/* Fail AZ-B */}
          <button
            onClick={() => injectAzFailure('AZ-B')}
            disabled={azBNodes.length === 0}
            className="px-2.5 py-1 rounded bg-white hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-200 hover:border-rose-300 font-medium disabled:opacity-40 transition-colors shadow-2xs"
            title="Inject a structured AZ failure through the failure propagation engine"
          >
            Simulate AZ-B Outage ({azBNodes.length})
          </button>

          {/* Restore All */}
          <button
            onClick={restoreAllNodes}
            disabled={failedNodes.length === 0}
            className="px-2.5 py-1 rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-medium flex items-center gap-1.5 disabled:opacity-40 transition-colors shadow-2xs"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
            <span>Restore All ({failedNodes.length} offline)</span>
          </button>

          {/* Failure Impact Summary - the real propagation result from engine/failure/, not a
              guess: which dependents cascaded, which survived via redundancy. */}
          {failureImpacts.length > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-50 border border-amber-200 text-amber-800 font-medium max-w-xl truncate" title={failureImpacts.map(i => i.summary).join(' ')}>
              <span className="font-bold">Impact:</span>
              <span className="truncate">{failureImpacts[failureImpacts.length - 1].summary}</span>
            </div>
          )}
        </div>

        {/* Right: Cascading Outage */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setShowCascadingModal(true);
              setCurrentCascadeStage(0);
            }}
            className="flex items-center gap-1.5 px-3 py-1 rounded bg-white hover:bg-slate-50 text-slate-700 font-medium border border-slate-200 shadow-xs transition-colors"
          >
            <Activity className="w-3.5 h-3.5 text-slate-500" />
            <span>Case Study: Cascading Outage</span>
          </button>
        </div>
      </div>

      {/* Cascading Failure Walkthrough Modal - a fixed illustrative case study, independent of
          the user's own canvas. It does not read `nodes`/`edges` and is not a simulation of the
          architecture currently on screen; see docs/audit/FAILURE_GAPS.md finding 1. */}
      {showCascadingModal && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white border border-slate-200 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-white">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-rose-100 text-rose-700">
                  <Flame className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Case Study: Cascading Outage
                  </h3>
                  <p className="text-xs text-slate-500">
                    A general, fixed case study (not based on your own architecture) showing how an innocent slow query can trigger a catastrophic multi-tier cloud outage
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCascadingModal(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Stages Stepper */}
            <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
              {CASCADING_FAILURE_STAGES.map((stg, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentCascadeStage(idx)}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg border text-center transition-all ${
                    currentCascadeStage === idx
                      ? 'bg-rose-50 text-rose-800 border-rose-300 shadow-xs'
                      : idx < currentCascadeStage
                      ? 'bg-slate-100 text-slate-700 border-slate-200'
                      : 'bg-white text-slate-400 border-slate-200'
                  }`}
                >
                  Step {stg.stageNumber}: {stg.phase}
                </button>
              ))}
            </div>

            {/* Active Stage Body */}
            {(() => {
              const stage = CASCADING_FAILURE_STAGES[currentCascadeStage];
              return (
                <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-rose-700 uppercase tracking-wider">
                      Targeted Component: {stage.component}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-700">
                      Phase {stage.stageNumber} of {CASCADING_FAILURE_STAGES.length}
                    </span>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                    <div className="font-bold text-slate-900 text-sm">{stage.event}</div>
                    <p className="text-xs text-slate-600 leading-relaxed">{stage.systemImpact}</p>
                  </div>

                  {/* Telemetry Metrics Change */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-center">
                      <div className="text-[10px] text-slate-500 font-medium uppercase">Observed Latency</div>
                      <div className="text-sm font-bold font-mono text-amber-600 mt-0.5">{stage.metricChange.latency}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-center">
                      <div className="text-[10px] text-slate-500 font-medium uppercase">5xx Error Rate</div>
                      <div className="text-sm font-bold font-mono text-rose-600 mt-0.5">{stage.metricChange.errorRate}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-center">
                      <div className="text-[10px] text-slate-500 font-medium uppercase">Thread Saturation</div>
                      <div className="text-sm font-bold font-mono text-purple-600 mt-0.5">{stage.metricChange.activeThreads}</div>
                    </div>
                  </div>

                  {/* Takeaway */}
                  <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
                    <span className="font-bold text-amber-800">💡 Systems Architecture Principle: </span>
                    {stage.teachingTakeaway}
                  </div>
                </div>
              );
            })()}

            {/* Footer Navigation */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                onClick={() => setCurrentCascadeStage(prev => Math.max(0, prev - 1))}
                disabled={currentCascadeStage === 0}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-30 transition-colors"
              >
                Previous Phase
              </button>

              {currentCascadeStage < CASCADING_FAILURE_STAGES.length - 1 ? (
                <button
                  onClick={() => setCurrentCascadeStage(prev => prev + 1)}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold transition-colors"
                >
                  <span>Next Phase</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  onClick={() => setShowCascadingModal(false)}
                  className="px-4 py-1.5 rounded-lg bg-[#232F3E] hover:bg-[#1A232E] text-white text-xs font-bold transition-colors"
                >
                  Close Walkthrough
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
