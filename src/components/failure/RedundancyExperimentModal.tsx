import React, { useState } from 'react';
import { useArchitecture } from '../../context/ArchitectureContext';
import {
  GitCompare,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Flame,
  RotateCcw,
  ArrowRight,
  ShieldCheck,
  X
} from 'lucide-react';

interface RedundancyExperimentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RedundancyExperimentModal: React.FC<RedundancyExperimentModalProps> = ({
  isOpen,
  onClose
}) => {
  const [ecs1Failed, setEcs1Failed] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <GitCompare className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100">
                Redundancy Resilience Experiment
              </h2>
              <p className="text-xs text-slate-400">
                Compare a Single-Instance architecture against a Multi-Instance redundant architecture under failure.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Experiment Controls */}
        <div className="px-6 py-3 bg-slate-950/70 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs text-slate-300 font-medium">
            Simulate failure on the primary compute instance:
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEcs1Failed(!ecs1Failed)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                ecs1Failed
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-rose-950 hover:bg-rose-900 text-rose-200 border border-rose-700'
              }`}
            >
              {ecs1Failed ? 'Restore Compute #1' : 'Simulate: Crash Compute #1'}
            </button>
          </div>
        </div>

        {/* Comparison Side-by-Side */}
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-950">
          {/* Architecture A: Single Instance */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-4">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold font-mono text-amber-400 uppercase tracking-wider">
                  Architecture A (Baseline)
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-slate-800 text-slate-300">
                  Single Instance
                </span>
              </div>

              {/* Topology Mini Diagram */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 font-mono text-xs text-slate-300 space-y-2 text-center">
                <div className="p-1.5 rounded bg-slate-800 inline-block font-semibold">User</div>
                <div className="text-slate-600">↓</div>
                <div className="p-1.5 rounded bg-pink-950 text-pink-300 border border-pink-800 inline-block font-semibold">ALB</div>
                <div className="text-slate-600">↓</div>
                <div
                  className={`p-2 rounded border inline-block font-bold transition-all ${
                    ecs1Failed
                      ? 'bg-rose-950 text-rose-300 border-rose-700 ring-2 ring-rose-500'
                      : 'bg-orange-950 text-orange-300 border-orange-800'
                  }`}
                >
                  {ecs1Failed ? '❌ ECS Task #1 (CRASHED)' : '✓ ECS Task #1 (Healthy)'}
                </div>
                <div className="text-slate-600">↓</div>
                <div className="p-1.5 rounded bg-sky-950 text-sky-300 border border-sky-800 inline-block font-semibold">RDS Database</div>
              </div>
            </div>

            {/* Request Outcome */}
            <div
              className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                ecs1Failed
                  ? 'bg-rose-950/60 border-rose-800 text-rose-200'
                  : 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
              }`}
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                {ecs1Failed ? (
                  <>
                    <XCircle className="w-4 h-4 text-rose-400" />
                    <span>502 Bad Gateway (Service Unavailable)</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>200 OK (Request Succeeds)</span>
                  </>
                )}
              </div>
              <p className="text-[11px] leading-relaxed opacity-90">
                {ecs1Failed
                  ? 'ALB has no remaining healthy targets in its target group. 100% of user traffic fails.'
                  : 'Single instance accepts and responds to client requests.'}
              </p>
            </div>
          </div>

          {/* Architecture B: Redundant Multi-Instance */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-4">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold font-mono text-emerald-400 uppercase tracking-wider">
                  Architecture B (Resilient)
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-emerald-950 text-emerald-300 border border-emerald-800">
                  Redundant Tiers
                </span>
              </div>

              {/* Topology Mini Diagram */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 font-mono text-xs text-slate-300 space-y-2 text-center">
                <div className="p-1.5 rounded bg-slate-800 inline-block font-semibold">User</div>
                <div className="text-slate-600">↓</div>
                <div className="p-1.5 rounded bg-pink-950 text-pink-300 border border-pink-800 inline-block font-semibold">ALB</div>
                <div className="text-slate-600">↓</div>
                <div className="flex items-center justify-center gap-2">
                  <div
                    className={`p-1.5 rounded border text-[11px] font-bold ${
                      ecs1Failed
                        ? 'bg-rose-950 text-rose-300 border-rose-700'
                        : 'bg-orange-950 text-orange-300 border-orange-800'
                    }`}
                  >
                    {ecs1Failed ? '❌ Task #1' : '✓ Task #1'}
                  </div>
                  <div className="p-1.5 rounded bg-orange-950 text-orange-300 border border-orange-800 text-[11px] font-bold ring-1 ring-emerald-500">
                    ✓ Task #2 (AZ-B)
                  </div>
                </div>
                <div className="text-slate-600">↓</div>
                <div className="p-1.5 rounded bg-sky-950 text-sky-300 border border-sky-800 inline-block font-semibold">RDS Database</div>
              </div>
            </div>

            {/* Request Outcome */}
            <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-200 text-xs space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>200 OK (Traffic Rerouted Successfully)</span>
              </div>
              <p className="text-[11px] leading-relaxed opacity-90">
                {ecs1Failed
                  ? 'ALB health check marks Task #1 unhealthy and transparently routes all requests to Task #2. Zero user disruption!'
                  : 'Traffic is balanced across both healthy compute tasks.'}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950 flex items-center justify-between text-xs text-slate-400">
          <span>
            💡 <b>Core Lesson:</b> Redundancy + Automated Health Checks = High Availability.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold transition-colors"
          >
            Close Experiment
          </button>
        </div>
      </div>
    </div>
  );
};
