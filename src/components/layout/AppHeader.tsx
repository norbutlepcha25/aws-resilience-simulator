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
    edges,
    loadTemplate,
    clearCanvas,
    analysis,
    costReport
  } = useArchitecture();

  const [showTemplatesDropdown, setShowTemplatesDropdown] = useState(false);
  const [isDownloadingImage, setIsDownloadingImage] = useState(false);

  const handleNewCanvas = () => {
    const hasAddedContent = nodes.some(n => n.type !== 'boundaryNode') || edges.length > 0;
    if (!hasAddedContent) {
      clearCanvas();
      return;
    }
    const confirmed = window.confirm('Reset canvas to default VPC, Public and Private subnets? This will clear all added services and connections.');
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
    <header className="bg-[#12181F] border-b border-black/40 px-6 py-2.5 flex items-center justify-between select-none z-30">
      {/* Brand & Title */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 48 48" fill="none">
            <path d="M12 28C6 28 2 23 2 17C2 11.5 6.5 7 12 7C13.5 7 15 7.5 16 8.5C18.5 4.5 22.5 2 27 2C35 2 41 8 41 16C44.5 17 47 20 47 24C47 29.5 42.5 34 37 34H12C7 34 2 29.5 2 24" stroke="#FF9900" strokeWidth="4" strokeLinecap="round" />
          </svg>
        </div>
        <div>
          <h1 className="text-sm font-semibold text-white tracking-tight leading-none">
            Cloud Architecture Lab
          </h1>
          <div className="text-[11px] text-white/40 hidden sm:block mt-0.5">
            Design, simulate, and break AWS cloud architectures
          </div>
        </div>
      </div>

      {/* Mode Switcher / Primary Tabs */}
      <nav className="flex items-center gap-0.5 bg-black/25 p-1 rounded-lg border border-white/10">
        <button
          onClick={() => setAppMode('design')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            appMode === 'design'
              ? 'bg-circuit-500 text-white font-semibold'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Design</span>
        </button>

        <button
          onClick={() => setAppMode('simulate')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            appMode === 'simulate'
              ? 'bg-circuit-500 text-white font-semibold'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Simulate</span>
        </button>

        <button
          onClick={() => setAppMode('failure')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            appMode === 'failure'
              ? 'bg-circuit-500 text-white font-semibold'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>Failure Lab</span>
        </button>

        <div className="w-px h-4 bg-white/10 mx-0.5" />

        <button
          onClick={onOpenAnalysis}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white/60 hover:text-white hover:bg-white/5 transition-colors"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          <span>Analyze</span>
          {analysis.spofs.length > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          )}
        </button>

        <button
          onClick={onOpenChallenges}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white/60 hover:text-white hover:bg-white/5 transition-colors"
        >
          <Trophy className="w-3.5 h-3.5" />
          <span>Challenges</span>
        </button>
      </nav>

      {/* Right Actions: Templates Dropdown, Clear, Export */}
      <div className="flex items-center gap-2">
        {/* Estimated AWS Bill - live figure, kept visually distinct from the action buttons */}
        <button
          onClick={onOpenCost}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 text-xs font-medium transition-colors cursor-pointer"
          title="Simulate realistic AWS architecture monthly bill & FinOps cost optimizations"
        >
          <DollarSign className="w-3.5 h-3.5" />
          <span className="font-mono font-semibold tabular-nums">${costReport.monthlyTotal.toFixed(2)}/mo</span>
        </button>

        <div className="w-px h-5 bg-white/10 mx-0.5" />

        {/* Secondary utility actions - quiet ghost buttons, not competing with Export */}
        <div className="relative">
          <button
            onClick={() => setShowTemplatesDropdown(!showTemplatesDropdown)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/5 text-xs font-medium transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Reference Diagrams</span>
            <ChevronDown className="w-3 h-3" />
          </button>

          {showTemplatesDropdown && (
            <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden py-1 z-50 animate-in fade-in">
              <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 border-b border-slate-100">
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

        <button
          onClick={handleNewCanvas}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/5 text-xs font-medium transition-colors"
          title="Reset canvas to default VPC, Public and Private subnets"
        >
          <FilePlus2 className="w-3.5 h-3.5" />
          <span className="hidden md:inline">New</span>
        </button>

        <button
          onClick={handleDownloadImage}
          disabled={isDownloadingImage || nodes.length === 0}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed text-xs font-medium transition-colors"
          title="Download the diagram as a PNG image"
        >
          <ImageDown className="w-3.5 h-3.5" />
          <span className="hidden md:inline">{isDownloadingImage ? 'Rendering…' : 'Download Image'}</span>
        </button>

        {/* Export - the one primary action in the bar, given real visual weight */}
        <button
          onClick={onOpenExport}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-white text-[#12181F] hover:bg-white/90 text-xs font-semibold transition-colors ml-1"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Export</span>
        </button>
      </div>
    </header>
  );
};
