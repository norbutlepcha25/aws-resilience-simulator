import React, { useState } from 'react';
import { useArchitecture } from '../../context/ArchitectureContext.tsx';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Lock,
  ArrowRight,
  Zap,
  BookOpen,
  X
} from 'lucide-react';

interface AnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AnalysisModal: React.FC<AnalysisModalProps> = ({ isOpen, onClose }) => {
  const { analysis } = useArchitecture();
  const [activeTab, setActiveTab] = useState<'scores' | 'spofs' | 'bottlenecks' | 'security'>('scores');

  if (!isOpen) return null;

  const scoreCategories = [
    { key: 'availability', label: 'Availability', detail: analysis.availability, color: 'text-slate-900', barBg: 'bg-slate-800' },
    { key: 'resilience', label: 'Resilience', detail: analysis.resilience, color: 'text-slate-900', barBg: 'bg-slate-800' },
    { key: 'faultTolerance', label: 'Fault Tolerance', detail: analysis.faultTolerance, color: 'text-slate-900', barBg: 'bg-slate-800' },
    { key: 'scalability', label: 'Scalability', detail: analysis.scalability, color: 'text-slate-900', barBg: 'bg-slate-800' },
    { key: 'security', label: 'Security & Isolation', detail: analysis.security, color: 'text-slate-900', barBg: 'bg-slate-800' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white border border-slate-200 w-full max-w-4xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-slate-100 text-slate-700">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-slate-900">
                  Architecture Resilience & Stability Analysis
                </h2>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-semibold font-mono ${
                    analysis.overallRating === 'Resilient'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : analysis.overallRating === 'Moderate'
                      ? 'bg-amber-50 text-amber-800 border border-amber-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  {analysis.overallRating}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Explainable rule-based evaluation aligned with the AWS Well-Architected Framework.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 px-6 gap-6 bg-white">
          <button
            onClick={() => setActiveTab('scores')}
            className={`py-3 px-1 text-xs border-b-2 transition-all ${
              activeTab === 'scores'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            Multidimensional Scorecard
          </button>
          <button
            onClick={() => setActiveTab('spofs')}
            className={`py-3 px-1 text-xs border-b-2 flex items-center gap-1.5 transition-all ${
              activeTab === 'spofs'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            <span>Single Points of Failure</span>
            {analysis.spofs.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-700 text-[10px] font-mono border border-slate-200 font-medium">
                {analysis.spofs.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('bottlenecks')}
            className={`py-3 px-1 text-xs border-b-2 flex items-center gap-1.5 transition-all ${
              activeTab === 'bottlenecks'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            <span>Bottlenecks & Capacity</span>
            {analysis.bottlenecks.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-700 text-[10px] font-mono border border-slate-200 font-medium">
                {analysis.bottlenecks.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={`py-3 px-1 text-xs border-b-2 flex items-center gap-1.5 transition-all ${
              activeTab === 'security'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            <span>Security Audit</span>
            {analysis.securityIssues.filter(s => s.severity === 'CRITICAL').length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-rose-50 text-rose-700 text-[10px] font-mono border border-rose-200 font-medium">
                !
              </span>
            )}
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar space-y-6 bg-white">
          {/* TAB 1: Multidimensional Scorecard */}
          {activeTab === 'scores' && (
            <div className="space-y-5">
              {/* Summary Banner */}
              <div className="p-4 rounded-xl bg-white border border-slate-200 text-xs text-slate-700 leading-relaxed flex items-start gap-3">
                <BookOpen className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-slate-900 mb-0.5">Architectural Assessment</div>
                  <p>{analysis.summary}</p>
                </div>
              </div>

              {/* Score Meters with Explainable Reasons */}
              <div className="space-y-3.5">
                {scoreCategories.map((cat) => (
                  <div key={cat.key} className="p-3.5 rounded-xl bg-slate-50/70 border border-slate-200">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold text-slate-800">{cat.label}</span>
                      <span className={`text-sm font-bold font-mono ${cat.color}`}>
                        {cat.detail.score}%
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden mb-2.5">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${cat.barBg}`}
                        style={{ width: `${cat.detail.score}%` }}
                      />
                    </div>

                    {/* Explainable Reasons */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      {/* Positive Reasons */}
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
                          Strengths (+)
                        </div>
                        {cat.detail.positiveReasons.length > 0 ? (
                          cat.detail.positiveReasons.map((pos, idx) => (
                            <div key={idx} className="text-slate-700 flex items-start gap-1.5 leading-snug">
                              <span className="text-emerald-600 font-bold">+</span>
                              <span>{pos}</span>
                            </div>
                          ))
                        ) : (
                          <div className="text-slate-400 italic text-[11px]">Baseline factors.</div>
                        )}
                      </div>

                      {/* Negative Reasons */}
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold text-rose-700 uppercase tracking-wider">
                          Weaknesses (-)
                        </div>
                        {cat.detail.negativeReasons.length > 0 ? (
                          cat.detail.negativeReasons.map((neg, idx) => (
                            <div key={idx} className="text-slate-700 flex items-start gap-1.5 leading-snug">
                              <span className="text-rose-600 font-bold">-</span>
                              <span>{neg}</span>
                            </div>
                          ))
                        ) : (
                          <div className="text-slate-400 italic text-[11px]">No severe weaknesses identified.</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: Single Points of Failure */}
          {activeTab === 'spofs' && (
            <div className="space-y-3.5">
              {analysis.spofs.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200">
                  <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-2" />
                  <h3 className="text-sm font-bold text-slate-900">Zero Critical SPOFs Detected</h3>
                  <p className="text-xs text-slate-600 mt-1 max-w-md mx-auto">
                    Your architecture provides redundancy across all tiers. Individual component failures will not bring down the entire system!
                  </p>
                </div>
              ) : (
                analysis.spofs.map((spof, idx) => (
                  <div key={idx} className="p-4 rounded-xl bg-rose-50/50 border border-rose-200 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-rose-600" />
                        <span className="font-bold text-slate-900 text-sm">{spof.nodeName}</span>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-rose-100 text-rose-800 border border-rose-300">
                        {spof.impactLevel} RISK
                      </span>
                    </div>

                    <p className="text-xs text-slate-700 leading-relaxed">
                      {spof.explanation}
                    </p>

                    <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs">
                      <div className="text-slate-900 font-semibold mb-0.5">
                        Recommended Architectural Remedy:
                      </div>
                      <div className="text-slate-700 leading-relaxed">
                        {spof.mitigation}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 3: Bottlenecks & Capacity */}
          {activeTab === 'bottlenecks' && (
            <div className="space-y-3.5">
              {analysis.bottlenecks.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200">
                  <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-2" />
                  <h3 className="text-sm font-bold text-slate-900">No Bottlenecks Detected</h3>
                  <p className="text-xs text-slate-600 mt-1 max-w-md mx-auto">
                    Compute concurrency and datastore throughput appear balanced.
                  </p>
                </div>
              ) : (
                analysis.bottlenecks.map((btn, idx) => (
                  <div key={idx} className="p-4 rounded-xl bg-amber-50/50 border border-amber-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-amber-600" />
                        <span className="font-bold text-slate-900 text-sm">{btn.title}</span>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-amber-100 text-amber-800 border border-amber-300">
                        {btn.severity} SEVERITY
                      </span>
                    </div>

                    <p className="text-xs text-slate-700 leading-relaxed">
                      {btn.explanation}
                    </p>

                    <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-700">
                      <span className="font-semibold text-slate-900">Mitigation: </span>
                      {btn.mitigation}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 4: Security & Isolation */}
          {activeTab === 'security' && (
            <div className="space-y-3.5">
              {analysis.securityIssues.map((sec, idx) => (
                <div
                  key={idx}
                  className={`p-4 rounded-xl border space-y-2 ${
                    sec.severity === 'CRITICAL'
                      ? 'bg-rose-50/50 border-rose-200'
                      : 'bg-amber-50/50 border-amber-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Lock className={`w-4 h-4 ${sec.severity === 'CRITICAL' ? 'text-rose-600' : 'text-amber-600'}`} />
                      <span className="font-bold text-slate-900 text-sm">{sec.title}</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                        sec.severity === 'CRITICAL'
                          ? 'bg-rose-100 text-rose-800 border border-rose-300'
                          : 'bg-amber-100 text-amber-800 border border-amber-300'
                      }`}
                    >
                      {sec.severity}
                    </span>
                  </div>

                  <p className="text-xs text-slate-700 leading-relaxed">
                    {sec.explanation}
                  </p>

                  <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-700">
                    <span className="font-semibold text-slate-900">Best Practice: </span>
                    {sec.recommendation}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="text-xs text-slate-500 font-mono">
            Educational Architecture Analyzer • Aligned with AWS Well-Architected Framework
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#232F3E] hover:bg-[#1A232E] text-white text-xs font-bold transition-colors shadow-xs"
          >
            Close Analysis
          </button>
        </div>
      </div>
    </div>
  );
};
