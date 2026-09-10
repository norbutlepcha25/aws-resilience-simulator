import React from 'react';
import { useArchitecture } from '../../context/ArchitectureContext.tsx';
import { STUDENT_CHALLENGES } from '../../data/studentChallenges.ts';
import {
  Trophy,
  CheckCircle2,
  XCircle,
  Play,
  X,
  RotateCcw
} from 'lucide-react';

interface ChallengeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ChallengeModal: React.FC<ChallengeModalProps> = ({ isOpen, onClose }) => {
  const {
    activeChallenge,
    setActiveChallenge,
    challengeResult,
    runChallengeTest,
    loadTemplate
  } = useArchitecture();

  if (!isOpen) return null;

  const currentChallenge = activeChallenge || STUDENT_CHALLENGES[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white border border-slate-200 w-full max-w-3xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-slate-100 text-slate-700">
              <Trophy className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                AWS Architecture Challenges
              </h2>
              <p className="text-xs text-slate-500">
                Design and validate reliable architectures against real-world cloud requirements.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Challenge Picker Tabs */}
        <div className="px-6 py-2.5 bg-slate-50/70 border-b border-slate-200 flex items-center gap-2 overflow-x-auto custom-scrollbar">
          {STUDENT_CHALLENGES.map((ch) => {
            const isSelected = currentChallenge.id === ch.id;
            return (
              <button
                key={ch.id}
                onClick={() => setActiveChallenge(ch)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                  isSelected
                    ? 'bg-[#232F3E] text-white shadow-xs'
                    : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
                }`}
              >
                {ch.title}
              </button>
            );
          })}
        </div>

        {/* Challenge Body */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar space-y-4">
          {/* Scenario Overview */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-blue-700 uppercase tracking-wider">
                Level: {currentChallenge.level} • Traffic: {currentChallenge.trafficScale}
              </span>
              {currentChallenge.initialTemplateId && (
                <button
                  onClick={() => loadTemplate(currentChallenge.initialTemplateId!)}
                  className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Load Challenge Starter Canvas
                </button>
              )}
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              {currentChallenge.scenario}
            </p>
          </div>

          {/* Requirements Checklist */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
              Architecture Requirements
            </h4>
            <div className="space-y-2">
              {currentChallenge.requirements.map((req, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700"
                >
                  <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-800 flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <span>{req}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Challenge Evaluation Result */}
          {challengeResult && (
            <div
              className={`p-4 rounded-xl border space-y-2.5 ${
                challengeResult.passed
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : 'bg-rose-50 border-rose-300 text-rose-900'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {challengeResult.passed ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  ) : (
                    <XCircle className="w-5 h-5 text-rose-600" />
                  )}
                  <span className="font-bold text-sm">
                    {challengeResult.passed ? 'Challenge Passed! 🎉' : 'Challenge Incomplete'}
                  </span>
                </div>
                <span className="text-sm font-bold font-mono">
                  Score: {challengeResult.score} / 100
                </span>
              </div>

              {/* Feedback list */}
              <div className="space-y-1 text-xs pt-1 border-t border-slate-200">
                {challengeResult.feedback.map((fb, idx) => (
                  <div key={idx} className="flex items-start gap-2 leading-relaxed">
                    <span className={fb.startsWith('Passed') ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                      {fb.startsWith('Passed') ? '✓' : '•'}
                    </span>
                    <span>{fb}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="text-xs text-slate-500 font-mono">
            Modify your diagram topology and evaluate resilience.
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={runChallengeTest}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-[#232F3E] hover:bg-[#1A232E] text-white font-bold text-xs shadow-xs active:scale-95 transition-all"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>TEST ARCHITECTURE</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
