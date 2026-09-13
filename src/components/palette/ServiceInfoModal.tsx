import React, { useState, useEffect } from 'react';
import { getServiceKnowledge, ServiceNoteKnowledge } from '../../data/serviceKnowledgeBase.ts';
import { AwsServiceIcon } from '../icons/AwsServiceIcons.tsx';
import {
  X,
  Layers,
  Sparkles,
  Server,
  Compass,
  DollarSign,
  CheckCircle2,
  Plus,
  ExternalLink,
  BookOpen,
  HardDrive,
  Database,
  FileText
} from 'lucide-react';

interface ServiceInfoModalProps {
  serviceId: string;
  onClose: () => void;
  onAddToCanvas?: (serviceId: string) => void;
}

export const ServiceInfoModal: React.FC<ServiceInfoModalProps> = ({
  serviceId,
  onClose,
  onAddToCanvas
}) => {
  const [activeTab, setActiveTab] = useState<'classes' | 'features' | 'useCases' | 'finops'>('classes');
  const knowledge: ServiceNoteKnowledge = getServiceKnowledge(serviceId);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const getStorageModelIcon = (model: string) => {
    switch (model) {
      case 'Object Storage':
        return <Database className="w-3.5 h-3.5 text-amber-500" />;
      case 'Block Storage':
        return <HardDrive className="w-3.5 h-3.5 text-circuit-500" />;
      case 'File Storage (POSIX)':
        return <FileText className="w-3.5 h-3.5 text-emerald-500" />;
      default:
        return <Server className="w-3.5 h-3.5 text-circuit-500" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-200 bg-slate-50/50 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-white p-1.5 border border-slate-200 shadow-xs flex items-center justify-center flex-shrink-0">
              <AwsServiceIcon serviceId={knowledge.serviceId} size={36} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                  {knowledge.serviceName}
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-slate-100 border border-slate-200 text-slate-700">
                  {getStorageModelIcon(knowledge.storageModel)}
                  {knowledge.storageModel}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed max-w-2xl">
                {knowledge.tagline}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {onAddToCanvas && (
              <button
                onClick={() => {
                  onAddToCanvas(knowledge.serviceId);
                  onClose();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#232F3E] hover:bg-[#1A232E] text-white text-xs font-semibold shadow-xs transition-colors"
                title="Add service directly to diagram canvas"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add to Canvas</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              title="Close modal (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Overview Banner Card */}
        <div className="px-6 py-3 bg-amber-50/60 border-b border-amber-200/60 flex items-start gap-2.5">
          <BookOpen className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-950 leading-relaxed">
            <strong className="font-semibold">Core Architecture Overview:</strong> {knowledge.overview}
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 pt-3 border-b border-slate-200 bg-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('classes')}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'classes'
                  ? 'border-circuit-600 text-circuit-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>{knowledge.keyClassesOrTypesTitle}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 font-mono">
                {knowledge.classesOrTypes.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('features')}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'features'
                  ? 'border-circuit-600 text-circuit-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>Key Features</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 font-mono">
                {knowledge.architecturalFeatures.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('useCases')}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'useCases'
                  ? 'border-circuit-600 text-circuit-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <Compass className="w-4 h-4" />
              <span>Production Use Cases</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 font-mono">
                {knowledge.useCases.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('finops')}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'finops'
                  ? 'border-circuit-600 text-circuit-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <DollarSign className="w-4 h-4" />
              <span>FinOps & Cost Tips</span>
            </button>
          </div>

          <div className="text-[11px] text-slate-400">
            Press <kbd className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[10px]">Esc</kbd> to close
          </div>
        </div>

        {/* Tab Content Area */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-slate-50/40">
          {/* TAB 1: CLASSES / TYPES */}
          {activeTab === 'classes' && (
            <div className="space-y-4">
              <div className="text-xs text-slate-500 font-medium">
                Comprehensive comparison of available storage tiers, classes, performance SLAs, and cost drivers:
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {knowledge.classesOrTypes.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs hover:border-circuit-300 hover:shadow-xs transition-all flex flex-col justify-between"
                  >
                    <div>
                      {/* Header with Title and Code */}
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">
                            {item.name}
                          </h3>
                          {item.code && (
                            <span className="inline-block font-mono text-[10px] text-circuit-600 font-semibold bg-circuit-50 px-1.5 py-0.5 rounded border border-circuit-200/60 mt-0.5">
                              {item.code}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Headline */}
                      <p className="text-xs text-slate-700 font-medium leading-relaxed mb-3">
                        {item.headline}
                      </p>

                      {/* Specs Matrix */}
                      <div className="space-y-2 text-xs border-t border-slate-100 pt-3">
                        <div className="flex items-start gap-2">
                          <span className="text-slate-400 font-medium min-w-[90px] text-[11px]">Durability:</span>
                          <span className="text-slate-800 font-semibold text-[11px] leading-tight">
                            {item.durabilityOrAvailability}
                          </span>
                        </div>

                        <div className="flex items-start gap-2">
                          <span className="text-slate-400 font-medium min-w-[90px] text-[11px]">Performance:</span>
                          <span className="text-slate-800 font-semibold text-[11px] leading-tight">
                            {item.performance}
                          </span>
                        </div>

                        <div className="flex items-start gap-2">
                          <span className="text-slate-400 font-medium min-w-[90px] text-[11px]">Use Cases:</span>
                          <span className="text-slate-600 text-[11px] leading-tight">
                            {item.useCases}
                          </span>
                        </div>

                        <div className="flex items-start gap-2">
                          <span className="text-slate-400 font-medium min-w-[90px] text-[11px]">Cost Profile:</span>
                          <span className="text-emerald-700 font-medium text-[11px] leading-tight">
                            {item.costProfile}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Features Tags */}
                    {item.features && item.features.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center gap-1.5 flex-wrap">
                        {item.features.map((feat, fIdx) => (
                          <span
                            key={fIdx}
                            className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-medium"
                          >
                            ✓ {feat}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: KEY FEATURES */}
          {activeTab === 'features' && (
            <div className="space-y-4">
              <div className="text-xs text-slate-500 font-medium">
                Architectural capabilities, operational mechanisms, and resilience building blocks:
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {knowledge.architecturalFeatures.map((feat, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs hover:border-circuit-300 transition-all space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-circuit-50 border border-circuit-200/60 flex items-center justify-center text-circuit-600">
                        <Sparkles className="w-3.5 h-3.5" />
                      </div>
                      <h3 className="text-xs font-bold text-slate-900">
                        {feat.title}
                      </h3>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed font-normal">
                      {feat.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: USE CASES */}
          {activeTab === 'useCases' && (
            <div className="space-y-4">
              <div className="text-xs text-slate-500 font-medium">
                Proven production architectural design patterns and deployment topologies:
              </div>

              <div className="space-y-3">
                {knowledge.useCases.map((uc, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        {uc.title}
                      </h3>
                      <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                        Design Pattern {idx + 1}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      {uc.description}
                    </p>
                    <div className="p-2.5 rounded-lg bg-circuit-50/70 border border-circuit-200/60 text-xs text-circuit-950 flex items-start gap-2">
                      <strong className="font-semibold text-circuit-700 min-w-[95px] text-[11px]">
                        Architectural Tip:
                      </strong>
                      <span className="text-[11px] leading-relaxed">
                        {uc.architectureTip}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: FINOPS TIPS */}
          {activeTab === 'finops' && (
            <div className="space-y-4">
              <div className="text-xs text-slate-500 font-medium">
                Cloud financial management (FinOps) and cost optimization principles:
              </div>

              <div className="space-y-2.5">
                {knowledge.finopsTips.map((tip, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/50 flex items-start gap-3"
                  >
                    <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5">
                      $
                    </div>
                    <p className="text-xs text-slate-800 leading-relaxed">
                      {tip}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
          <div className="text-slate-500 text-[11px]">
            AWS Architecture & Resilience Reference Guide
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors"
            >
              Close
            </button>
            {onAddToCanvas && (
              <button
                onClick={() => {
                  onAddToCanvas(knowledge.serviceId);
                  onClose();
                }}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#232F3E] hover:bg-[#1A232E] text-white text-xs font-semibold shadow-xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add {knowledge.serviceName.split(' ')[1] || knowledge.serviceName} to Canvas</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
