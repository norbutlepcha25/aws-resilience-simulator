import React, { useState } from 'react';
import { ArchitectureProvider, useArchitecture } from './context/ArchitectureContext.tsx';
import { AppHeader } from './components/layout/AppHeader.tsx';
import { ServicePalette } from './components/palette/ServicePalette.tsx';
import { ArchitectureCanvas } from './components/canvas/ArchitectureCanvas.tsx';
import { ServiceInspector } from './components/inspector/ServiceInspector.tsx';
import { SimulationControls } from './components/simulation/SimulationControls.tsx';
import { EventTimeline } from './components/simulation/EventTimeline.tsx';
import { FailureControls } from './components/failure/FailureControls.tsx';
import { AnalysisModal } from './components/analysis/AnalysisModal.tsx';
import { ChallengeModal } from './components/challenges/ChallengeModal.tsx';
import { ExportModal } from './components/export/ExportModal.tsx';
import { CostEstimatorModal } from './components/cost/CostEstimatorModal.tsx';
import { TeachingToolbar } from './components/presentation/TeachingToolbar.tsx';

const AppContent: React.FC = () => {
  const { appMode } = useArchitecture();
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
  const [isChallengesOpen, setIsChallengesOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isCostOpen, setIsCostOpen] = useState(false);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-white text-slate-900 font-sans select-none">
      {/* Top Application Header */}
      <AppHeader
        onOpenAnalysis={() => setIsAnalysisOpen(true)}
        onOpenChallenges={() => setIsChallengesOpen(true)}
        onOpenExport={() => setIsExportOpen(true)}
        onOpenCost={() => setIsCostOpen(true)}
      />

      {/* Failure Testing Strip (Active in failure mode) */}
      {appMode === 'failure' && <FailureControls />}

      {/* Main Diagram Canvas Workspace */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left AWS Service Palette */}
        <ServicePalette />

        {/* Center Diagram Canvas Area */}
        <main className="flex-1 relative flex flex-col h-full overflow-hidden bg-white">
          {/* Classroom / Projector Mode Overlay */}
          <TeachingToolbar />

          {/* Graph Canvas */}
          <ArchitectureCanvas />

          {/* Bottom Simulation Scrubbing Event Timeline */}
          <EventTimeline />

          {/* Simulation Controls Footer Bar */}
          <SimulationControls />
        </main>

        {/* Right Service & Connection Inspector */}
        <ServiceInspector />
      </div>

      {/* Modals */}
      <AnalysisModal
        isOpen={isAnalysisOpen}
        onClose={() => setIsAnalysisOpen(false)}
      />

      <ChallengeModal
        isOpen={isChallengesOpen}
        onClose={() => setIsChallengesOpen(false)}
      />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
      />

      <CostEstimatorModal
        isOpen={isCostOpen}
        onClose={() => setIsCostOpen(false)}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ArchitectureProvider>
      <AppContent />
    </ArchitectureProvider>
  );
};

export default App;
