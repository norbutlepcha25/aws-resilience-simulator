import React from 'react';
import { useArchitecture } from '../../context/ArchitectureContext.tsx';
import { Route as RouteIcon, X, CheckCircle2, XCircle } from 'lucide-react';

interface RequestTraceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DECISION_STYLE: Record<string, string> = {
  ALLOW: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  SUCCESS: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  DENY: 'bg-rose-50 text-rose-800 border-rose-300',
  FAILURE: 'bg-rose-50 text-rose-800 border-rose-300',
  NOT_REQUIRED: 'bg-slate-100 text-slate-600 border-slate-300',
  INFO: 'bg-slate-100 text-slate-600 border-slate-300'
};

/**
 * Renders the Phase 11 explainable AWS decision trace (`engine/trace/`) for the current
 * `simulationResult` - request path, decision points, and the AWS rule/reason behind each one.
 * Purely a display of the `RequestTrace` data the engine already computed; no AWS semantics are
 * decided here.
 */
export const RequestTraceModal: React.FC<RequestTraceModalProps> = ({ isOpen, onClose }) => {
  const { requestTrace, simulationResult } = useArchitecture();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white border border-slate-200 w-full max-w-3xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-slate-100 text-slate-700">
              <RouteIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">AWS Decision Trace</h3>
              <p className="text-xs text-slate-500">
                What happened, where, why, and which AWS rule caused it - for the last simulated request.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded text-slate-400 hover:text-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar space-y-3 bg-white">
          {!requestTrace || !simulationResult ? (
            <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200">
              <p className="text-xs text-slate-600">Send a request first - there's nothing to explain yet.</p>
            </div>
          ) : (
            <>
              {requestTrace.entries.map((entry) => (
                <div key={entry.order} className="pl-3 border-l-2 border-slate-200 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900">
                      {entry.order + 1}. {entry.component}
                      {entry.resource !== 'N/A' && <span className="text-slate-500 font-normal"> - {entry.resource}</span>}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border shrink-0 ${DECISION_STYLE[entry.decision] || 'bg-slate-100 text-slate-600 border-slate-300'}`}>
                      {entry.decision}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">{entry.reason}</p>
                  <p className="text-[11px] text-slate-500 italic leading-relaxed">AWS rule: {entry.awsRule}</p>
                </div>
              ))}

              <div className={`mt-4 p-3 rounded-xl border flex items-center gap-2 ${
                requestTrace.final === 'SUCCESS' ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'
              }`}>
                {requestTrace.final === 'SUCCESS' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <div className="text-xs">
                  <span className="font-bold text-slate-900">FINAL: {requestTrace.final}</span>
                  <span className="text-slate-700"> - {requestTrace.why}</span>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#232F3E] hover:bg-[#1A232E] text-white text-xs font-bold transition-colors shadow-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
