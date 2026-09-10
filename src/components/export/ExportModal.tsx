import React, { useState } from 'react';
import { useArchitecture } from '../../context/ArchitectureContext.tsx';
import { Download, Copy, Check, FileText, Code2, X } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose }) => {
  const { nodes, edges, analysis } = useArchitecture();
  const [activeFormat, setActiveFormat] = useState<'markdown' | 'json'>('markdown');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  // Filter out pure visual boundaries from JSON topology
  const serviceNodesOnly = nodes.filter(n => n.type !== 'boundaryNode');

  // Generate JSON Export
  const jsonExport = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      architectureName: 'Official AWS Architecture Diagram',
      nodes: serviceNodesOnly.map(n => ({
        id: n.id,
        serviceId: n.data.serviceId,
        label: n.data.label,
        category: n.data.category,
        az: n.data.az,
        subnet: n.data.subnet,
        health: n.data.health,
        position: n.position
      })),
      edges: edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        stepNumber: (e.data as any)?.stepNumber,
        protocol: e.data?.protocol,
        interactionType: e.data?.interactionType
      })),
      analysisSummary: {
        overallRating: analysis.overallRating,
        availability: analysis.availability.score,
        resilience: analysis.resilience.score,
        faultTolerance: analysis.faultTolerance.score,
        scalability: analysis.scalability.score,
        security: analysis.security.score,
        spofCount: analysis.spofs.length
      }
    },
    null,
    2
  );

  // Generate Comprehensive Markdown Audit Report
  const markdownReport = `# AWS Architecture Resilience Audit Report

**Generated:** ${new Date().toLocaleString()}  
**System Rating:** ${analysis.overallRating.toUpperCase()}  

---

## 1. Executive Summary
${analysis.summary}

---

## 2. Multidimensional Evaluation

| Dimension | Score | Primary Contributing Factors |
| :--- | :--- | :--- |
| **Availability** | ${analysis.availability.score}% | ${analysis.availability.positiveReasons.slice(0, 2).join('; ') || 'Baseline'} |
| **Resilience** | ${analysis.resilience.score}% | ${analysis.resilience.positiveReasons.slice(0, 2).join('; ') || 'Baseline'} |
| **Fault Tolerance** | ${analysis.faultTolerance.score}% | ${analysis.faultTolerance.positiveReasons.slice(0, 2).join('; ') || 'Single AZ presence'} |
| **Scalability** | ${analysis.scalability.score}% | ${analysis.scalability.positiveReasons.slice(0, 2).join('; ') || 'Baseline'} |
| **Security & Isolation** | ${analysis.security.score}% | ${analysis.security.positiveReasons.slice(0, 2).join('; ') || 'Private subnets configured'} |

---

## 3. Single Points of Failure (${analysis.spofs.length} Detected)
${
  analysis.spofs.length === 0
    ? '✓ **Zero Single Points of Failure identified.** All critical layers contain redundant compute or multi-AZ data replication.'
    : analysis.spofs.map(s => `### ⚠ ${s.nodeName} (${s.impactLevel} Risk)
- **Failure Impact:** ${s.explanation}
- **Recommended Remedy:** ${s.mitigation}
`).join('\n')
}

---

## 4. Scalability & Bottleneck Assessment
${
  analysis.bottlenecks.length === 0
    ? '✓ No severe throughput or concurrency bottlenecks detected.'
    : analysis.bottlenecks.map(b => `### ⚡ ${b.title} (${b.severity} Severity)
- **Risk:** ${b.explanation}
- **Mitigation:** ${b.mitigation}
`).join('\n')
}

---

## 5. Deployed Services
${serviceNodesOnly.map(n => `- **${n.data.label}** (${n.data.category}) - Placement: \`${n.data.az}\`, Subnet: \`${n.data.subnet}\``).join('\n')}
`;

  const contentToDisplay = activeFormat === 'markdown' ? markdownReport : jsonExport;

  const handleCopy = () => {
    navigator.clipboard.writeText(contentToDisplay);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const filename = activeFormat === 'markdown' ? 'aws-architecture-audit.md' : 'aws-diagram.json';
    const blob = new Blob([contentToDisplay], { type: activeFormat === 'markdown' ? 'text/markdown' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white border border-slate-200 w-full max-w-3xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-slate-100 text-slate-700">
              <Download className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Export Architecture & Resilience Report
              </h2>
              <p className="text-xs text-slate-500">
                Download your diagram topology or printable architecture audit documentation.
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

        {/* Format Switcher */}
        <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveFormat('markdown')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeFormat === 'markdown'
                  ? 'bg-[#232F3E] text-white shadow-xs'
                  : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Audit Report (Markdown)</span>
            </button>

            <button
              onClick={() => setActiveFormat('json')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeFormat === 'json'
                  ? 'bg-[#232F3E] text-white shadow-xs'
                  : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Diagram Topology (JSON)</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-300 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download File</span>
            </button>
          </div>
        </div>

        {/* Content Preview */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar bg-slate-50">
          <pre className="text-xs font-mono text-slate-800 leading-relaxed whitespace-pre-wrap">
            {contentToDisplay}
          </pre>
        </div>
      </div>
    </div>
  );
};
