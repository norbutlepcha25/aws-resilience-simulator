import React, { useState, useMemo } from 'react';
import { useArchitecture } from '../../context/ArchitectureContext.tsx';
import { calculateArchitectureCost, getTrafficScaleFactor, HOURS_PER_MONTH } from '../../engine/cost/costCalculator.ts';
import { AwsServiceIcon } from '../icons/AwsServiceIcons.tsx';
import {
  DollarSign,
  TrendingUp,
  HardDrive,
  Cpu,
  Database,
  Network,
  ShieldAlert,
  Sparkles,
  Download,
  X,
  Layers,
  ArrowUpRight,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Tag
} from 'lucide-react';

interface CostEstimatorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CostEstimatorModal: React.FC<CostEstimatorModalProps> = ({ isOpen, onClose }) => {
  const { nodes, scenario, setScenario } = useArchitecture();
  const [activeTab, setActiveTab] = useState<'invoice' | 'recommendations'>('invoice');
  const [timeframe, setTimeframe] = useState<'hourly' | 'daily' | 'monthly' | 'annual'>('monthly');

  // Local traffic level override for interactive bill simulation
  const [simulatedTraffic, setSimulatedTraffic] = useState<string>(scenario.trafficLevel || 'normal');

  const report = useMemo(() => {
    return calculateArchitectureCost(nodes, simulatedTraffic);
  }, [nodes, simulatedTraffic]);

  if (!isOpen) return null;

  // Multiplier based on timeframe
  const timeframeMultiplier =
    timeframe === 'hourly' ? 1 / HOURS_PER_MONTH :
    timeframe === 'daily' ? 24 / HOURS_PER_MONTH :
    timeframe === 'annual' ? 12 : 1;

  const totalCost = report.monthlyTotal * timeframeMultiplier;
  const timeframeLabel =
    timeframe === 'hourly' ? '/ hr' :
    timeframe === 'daily' ? '/ day' :
    timeframe === 'annual' ? '/ yr' : '/ mo';

  // Category Colors
  const CATEGORY_COLORS: Record<string, { bg: string; text: string; bar: string }> = {
    'Compute': { bg: 'bg-orange-50', text: 'text-orange-700', bar: 'bg-orange-500' },
    'Storage': { bg: 'bg-lime-50', text: 'text-lime-700', bar: 'bg-lime-500' },
    'Databases': { bg: 'bg-purple-50', text: 'text-purple-700', bar: 'bg-purple-500' },
    'Networking & Content Delivery': { bg: 'bg-indigo-50', text: 'text-indigo-700', bar: 'bg-indigo-500' },
    'Security, Identity & Compliance': { bg: 'bg-rose-50', text: 'text-rose-700', bar: 'bg-rose-500' },
    'Management & Governance': { bg: 'bg-pink-50', text: 'text-pink-700', bar: 'bg-pink-500' }
  };

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(report, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `aws-bill-estimate-${simulatedTraffic}-traffic.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white border border-slate-200 w-full max-w-5xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200">
              <DollarSign className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 tracking-tight">
                  AWS Architecture Cost Estimator & Bill Simulator
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                  US-East-1 Pricing
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Realistic cloud billing simulation based on instance types, storage classes, data transfer, and traffic scaling.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportJson}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors shadow-2xs"
              title="Download detailed JSON invoice"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Bill</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Traffic Simulation Selector & Timeframe Controls */}
        <div className="px-6 py-3 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          {/* Traffic Scale Simulator */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
              Simulate Traffic Load:
            </span>
            <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200 shadow-2xs">
              {[
                { id: 'low', label: 'Low (0.5x)' },
                { id: 'normal', label: 'Normal (1x)' },
                { id: 'high', label: 'High (2.5x)' },
                { id: 'very_high', label: 'Peak (5x)' },
                { id: '10x', label: '10x Surge' },
                { id: '100x', label: '100x Surge' }
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => {
                    setSimulatedTraffic(t.id);
                    setScenario(prev => ({ ...prev, trafficLevel: t.id as any }));
                  }}
                  className={`px-2 py-1 rounded text-[11px] font-semibold transition-all ${
                    simulatedTraffic === t.id
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Timeframe selector */}
          <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200 shadow-2xs">
            {(['hourly', 'daily', 'monthly', 'annual'] as const).map(tf => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold capitalize transition-all ${
                  timeframe === tf
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {/* Top Summary KPI Cards */}
        <div className="p-6 pb-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-white">
          <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 shadow-xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
              Total Architecture Bill
            </span>
            <div className="text-2xl font-extrabold font-mono text-slate-900 mt-1">
              ${totalCost.toFixed(2)}
              <span className="text-xs font-normal text-slate-500 font-sans ml-1">{timeframeLabel}</span>
            </div>
            <div className="text-[11px] text-emerald-700 mt-1 flex items-center gap-1">
              <span>{report.nodeCosts.length} provisioned AWS resources</span>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 shadow-xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
              <Cpu className="w-3.5 h-3.5 text-orange-600" />
              Compute Services
            </span>
            <div className="text-xl font-bold font-mono text-slate-900 mt-1">
              ${((report.byCategory['Compute'] || 0) * timeframeMultiplier).toFixed(2)}
              <span className="text-xs font-normal text-slate-500 ml-1">{timeframeLabel}</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              EC2, Lambda, Fargate, ECS
            </div>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 shadow-xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
              <HardDrive className="w-3.5 h-3.5 text-lime-600" />
              Storage & Persistence
            </span>
            <div className="text-xl font-bold font-mono text-slate-900 mt-1">
              ${((report.byCategory['Storage'] || 0) * timeframeMultiplier).toFixed(2)}
              <span className="text-xs font-normal text-slate-500 ml-1">{timeframeLabel}</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              S3 Buckets, EBS Root Volumes
            </div>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 shadow-xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
              <Network className="w-3.5 h-3.5 text-indigo-600" />
              Networking & Routing
            </span>
            <div className="text-xl font-bold font-mono text-slate-900 mt-1">
              ${((report.byCategory['Networking & Content Delivery'] || 0) * timeframeMultiplier).toFixed(2)}
              <span className="text-xs font-normal text-slate-500 ml-1">{timeframeLabel}</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              ALBs, NAT Gateways, CloudFront
            </div>
          </div>
        </div>

        {/* Category Breakdown Meter Bar */}
        {report.monthlyTotal > 0 && (
          <div className="px-6 py-2 bg-white">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 mb-1">
              <span>Cost Distribution by Category</span>
              <span className="font-mono text-slate-500">${report.monthlyTotal.toFixed(2)} / month</span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-slate-100 flex overflow-hidden">
              {Object.entries(report.byCategory).map(([cat, amount]) => {
                const pct = (amount / report.monthlyTotal) * 100;
                if (pct < 1) return null;
                const colors = CATEGORY_COLORS[cat] || { bar: 'bg-slate-500' };
                return (
                  <div
                    key={cat}
                    style={{ width: `${pct}%` }}
                    className={`${colors.bar} h-full transition-all`}
                    title={`${cat}: $${amount.toFixed(2)}/mo (${pct.toFixed(1)}%)`}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="px-6 border-b border-slate-200 flex gap-4 bg-white mt-1">
          <button
            onClick={() => setActiveTab('invoice')}
            className={`pb-2 text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              activeTab === 'invoice'
                ? 'border-b-2 border-slate-900 text-slate-900'
                : 'border-b-2 border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            <span>Itemized Resource Invoice ({report.nodeCosts.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('recommendations')}
            className={`pb-2 text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              activeTab === 'recommendations'
                ? 'border-b-2 border-slate-900 text-slate-900'
                : 'border-b-2 border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>FinOps Cost Optimizations</span>
            {report.recommendations.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold flex items-center justify-center">
                {report.recommendations.length}
              </span>
            )}
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar bg-slate-50/40">
          {activeTab === 'invoice' && (
            <div className="space-y-4">
              {report.nodeCosts.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-xl border border-slate-200 text-slate-500 text-xs">
                  No AWS services placed on canvas yet. Drag services from the palette to start simulating your AWS architecture bill.
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        <th className="py-2.5 px-4">AWS Resource</th>
                        <th className="py-2.5 px-4">Category</th>
                        <th className="py-2.5 px-4">Configuration & Specs</th>
                        <th className="py-2.5 px-4 text-right">Unit Details</th>
                        <th className="py-2.5 px-4 text-right">Monthly Bill</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {report.nodeCosts.map(item => {
                        const colors = CATEGORY_COLORS[item.category] || { bg: 'bg-slate-100', text: 'text-slate-700' };
                        return (
                          <tr key={item.nodeId} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 flex-shrink-0 flex items-center justify-center">
                                  <AwsServiceIcon serviceId={item.serviceId} size={24} />
                                </div>
                                <div>
                                  <div className="font-bold text-slate-900">{item.nodeName}</div>
                                  <div className="text-[10px] text-slate-400 font-mono">{item.serviceId}</div>
                                </div>
                              </div>
                            </td>

                            <td className="py-3 px-4">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${colors.bg} ${colors.text}`}>
                                {item.category}
                              </span>
                            </td>

                            <td className="py-3 px-4">
                              <span className="font-mono text-[11px] text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                                {item.configurationSummary}
                              </span>
                              {item.freeTierEligible && (
                                <span className="ml-2 text-[9px] font-bold uppercase px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800">
                                  Free Tier
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-4 text-right font-mono text-[11px] text-slate-500">
                              {item.lineItems.map((li, idx) => (
                                <div key={idx} className="truncate max-w-xs text-right">
                                  {li.name}: ${li.cost.toFixed(2)}
                                </div>
                              ))}
                            </td>

                            <td className="py-3 px-4 text-right">
                              <div className="font-mono font-bold text-slate-900 text-sm">
                                ${(item.monthlyCost * timeframeMultiplier).toFixed(2)}
                              </div>
                              <div className="text-[10px] font-mono text-slate-400">
                                ≈ ${(item.hourlyCost).toFixed(4)}/hr
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold text-slate-900">
                        <td colSpan={4} className="py-3 px-4 text-right uppercase text-xs tracking-wider text-slate-600">
                          Total Estimated Architecture Invoice:
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-base text-slate-900">
                          ${totalCost.toFixed(2)}
                          <span className="text-xs font-normal text-slate-500 ml-1">{timeframeLabel}</span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'recommendations' && (
            <div className="space-y-3">
              {report.recommendations.length === 0 ? (
                <div className="p-8 text-center bg-white rounded-xl border border-slate-200 space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                  <h3 className="text-sm font-bold text-slate-900">Architecture is Cost Optimized!</h3>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    No critical cost leaks or idle resource overhead detected based on AWS Well-Architected Framework FinOps guidelines.
                  </p>
                </div>
              ) : (
                report.recommendations.map(tip => (
                  <div
                    key={tip.id}
                    className={`p-4 rounded-xl border bg-white shadow-xs space-y-2 ${
                      tip.severity === 'high'
                        ? 'border-rose-300'
                        : tip.severity === 'medium'
                        ? 'border-amber-300'
                        : 'border-blue-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        {tip.severity === 'high' ? (
                          <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                        ) : tip.severity === 'medium' ? (
                          <Zap className="w-4 h-4 text-amber-600 flex-shrink-0" />
                        ) : (
                          <Sparkles className="w-4 h-4 text-blue-600 flex-shrink-0" />
                        )}
                        <h4 className="text-xs font-bold text-slate-900">{tip.title}</h4>
                      </div>

                      {tip.estimatedMonthlySavings && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 flex-shrink-0">
                          Save ~${tip.estimatedMonthlySavings.toFixed(2)}/mo
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed pl-6">
                      {tip.description}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-200 bg-white flex items-center justify-between">
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <span className="font-semibold text-slate-700">AWS Free Tier:</span>
            <span>Eligible resources (e.g. t3.micro, 1M Lambda calls) automatically account for free allowance.</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs transition-colors"
          >
            Close Cost Estimator
          </button>
        </div>
      </div>
    </div>
  );
};
