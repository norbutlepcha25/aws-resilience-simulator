import React, { useState } from 'react';
import { useArchitecture } from '../../context/ArchitectureContext.tsx';
import { REFERENCE_ARCHITECTURES } from '../../data/referenceArchitectures.ts';
import { downloadCanvasAsPng } from '../../utils/exportImage.ts';
import {
  Activity,
  Layers,
  ShieldAlert,
  BarChart3,
  Trophy,
  Download,
  FilePlus2,
  ImageDown,
  FolderOpen,
  Presentation,
  ChevronDown,
  DollarSign
} from 'lucide-react';

interface AppHeaderProps {
  onOpenAnalysis: () => void;
  onOpenChallenges: () => void;
  onOpenExport: () => void;
  onOpenCost: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  onOpenAnalysis,
  onOpenChallenges,
  onOpenExport,
  onOpenCost
}) => {
  const {
    appMode,
    setAppMode,
    nodes,
    loadTemplate,
    clearCanvas,
    isTeachingMode,
    setIsTeachingMode,
    analysis,
    costReport
  } = useArchitecture();

  const [showTemplatesDropdown, setShowTemplatesDropdown] = useState(false);
  const [isDownloadingImage, setIsDownloadingImage] = useState(false);

  const handleNewCanvas = () => {
    if (nodes.length === 0) {
      clearCanvas();
      return;
    }
    const confirmed = window.confirm('Start a new blank canvas? This clears everything currently on the canvas and cannot be undone.');
    if (confirmed) {
      clearCanvas();
    }
  };

  const handleDownloadImage = async () => {
    if (isDownloadingImage) return;
    setIsDownloadingImage(true);
    try {
      await downloadCanvasAsPng(nodes);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not download the diagram image.');
    } finally {
      setIsDownloadingImage(false);
    }
  };

  return (
    <header className="bg-white border-b border-slate-200 px-6 py-2.5 flex items-center justify-between select-none z-30">
      {/* Brand & Title */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-[#232F3E] flex items-center justify-center text-white shadow-xs">
          <svg width="20" height="20" viewBox="0 0 48 48" fill="none">
            <path d="M12 28C6 28 2 23 2 17C2 11.5 6.5 7 12 7C13.5 7 15 7.5 16 8.5C18.5 4.5 22.5 2 27 2C35 2 41 8 41 16C44.5 17 47 20 47 24C47 29.5 42.5 34 37 34H12C7 34 2 29.5 2 24" stroke="#FF9900" strokeWidth="4" strokeLinecap="round" />
          </svg>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold text-slate-900 tracking-tight">
              AWS Architecture Lab
            </h1>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium bg-slate-100 text-slate-600 border border-slate-200">
              Simulator
            </span>
          </div>
          <div className="text-[11px] text-slate-500 hidden sm:block">
            Interactive Cloud Architecture & Resilience Simulator
          </div>
        </div>
      </div>

      {/* Mode Switcher / Primary Tabs */}
      <nav className="flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200">
        <button
          onClick={() => setAppMode('design')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            appMode === 'design'
              ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80 font-semibold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Layers className={`w-3.5 h-3.5 ${appMode === 'design' ? 'text-slate-900' : 'text-slate-500'}`} />
          <span>Design</span>
        </button>

        <button
          onClick={() => setAppMode('simulate')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            appMode === 'simulate'
              ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80 font-semibold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Activity className={`w-3.5 h-3.5 ${appMode === 'simulate' ? 'text-slate-900' : 'text-slate-500'}`} />
          <span>Simulate</span>
        </button>

        <button
          onClick={() => setAppMode('failure')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            appMode === 'failure'
              ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80 font-semibold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ShieldAlert className={`w-3.5 h-3.5 ${appMode === 'failure' ? 'text-slate-900' : 'text-slate-500'}`} />
          <span>Failure Lab</span>
        </button>

        <button
          onClick={onOpenAnalysis}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 transition-all"
        >
          <BarChart3 className="w-3.5 h-3.5 text-slate-500" />
          <span>Analyze</span>
          {analysis.spofs.length > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          )}
        </button>

        <button
          onClick={onOpenChallenges}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 transition-all"
        >
          <Trophy className="w-3.5 h-3.5 text-slate-500" />
          <span>Challenges</span>
        </button>
      </nav>

      {/* Right Actions: Templates Dropdown, Teaching Mode, Clear, Export */}
      <div className="flex items-center gap-2">
        {/* Predefined Templates Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowTemplatesDropdown(!showTemplatesDropdown)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium border border-slate-200 shadow-xs transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5 text-slate-500" />
            <span className="hidden md:inline">Reference Diagrams</span>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {showTemplatesDropdown && (
            <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden py-1 z-50 animate-in fade-in">
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                Official AWS Architecture Diagrams
              </div>
              {REFERENCE_ARCHITECTURES.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => {
                    loadTemplate(tpl.id);
                    setShowTemplatesDropdown(false);
                  }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 transition-colors flex flex-col border-b border-slate-50 last:border-0"
                >
                  <span className="font-semibold text-slate-900">{tpl.name}</span>
                  <span className="text-[10px] text-slate-500 line-clamp-1">{tpl.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Teaching Mode Toggle */}
        <button
          onClick={() => setIsTeachingMode(!isTeachingMode)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
            isTeachingMode
              ? 'bg-slate-900 text-white border-slate-900 shadow-xs font-semibold'
              : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
          }`}
          title="Toggle Teaching Presentation Mode"
        >
          <Presentation className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Teaching Mode</span>
        </button>

        {/* New Blank Canvas */}
        <button
          onClick={handleNewCanvas}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium border border-slate-200 shadow-xs transition-colors"
          title="Start a new blank canvas"
        >
          <FilePlus2 className="w-3.5 h-3.5 text-slate-500" />
          <span className="hidden md:inline">New</span>
        </button>

        {/* Download Diagram as PNG Image */}
        <button
          onClick={handleDownloadImage}
          disabled={isDownloadingImage || nodes.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 text-xs font-medium border border-slate-200 shadow-xs transition-colors"
          title="Download the diagram as a PNG image"
        >
          <ImageDown className="w-3.5 h-3.5 text-slate-500" />
          <span className="hidden md:inline">{isDownloadingImage ? 'Rendering…' : 'Download Image'}</span>
        </button>

        {/* Estimated AWS Bill Button */}
        <button
          onClick={onOpenCost}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          title="Simulate realistic AWS architecture monthly bill & FinOps cost optimizations"
        >
          <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
          <span className="font-mono font-bold">${costReport.monthlyTotal.toFixed(2)}/mo</span>
        </button>

        {/* Export Report / JSON */}
        <button
          onClick={onOpenExport}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#232F3E] hover:bg-[#1A232E] text-white text-xs font-medium shadow-xs transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Export</span>
        </button>
      </div>
    </header>
  );
};
