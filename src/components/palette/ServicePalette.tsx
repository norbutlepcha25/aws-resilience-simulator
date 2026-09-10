import React, { useState, useMemo } from 'react';
import { AWS_SERVICES } from '../../data/serviceCatalog.ts';
import { useArchitecture } from '../../context/ArchitectureContext.tsx';
import { AwsServiceIcon } from '../icons/AwsServiceIcons.tsx';
import {
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  Filter,
  Lock,
  Cloud,
  Flag,
  Server,
  Network
} from 'lucide-react';

const CATEGORY_COLORS: Record<string, string> = {
  'Compute': '#ED7100',
  'Storage': '#7AA116',
  'Databases': '#C925D1',
  'Networking & Content Delivery': '#8C4FFF',
  'Security, Identity & Compliance': '#DD344C',
  'Integration & Messaging': '#FF4F8B',
  'Analytics': '#2E27AD',
  'Machine Learning & AI': '#059669',
  'Management & Governance': '#E7157B',
  'Developer Tools': '#2563EB',
  'Containers': '#ED7100',
  'Frontend Web & Mobile': '#D97706',
  'Migration & Transfer': '#0891B2',
  'Media Services': '#B91C1C',
  'Business Applications': '#0284C7',
  'End User Computing': '#7C3AED',
  'Internet of Things (IoT)': '#65A30D',
  'Cloud Financial Management': '#15803D',
  'Blockchain & Quantum': '#4338CA',
  'Robotics & Satellite': '#0F766E',
  'Client / Ingress': '#232F3E'
};

interface BoundaryDef {
  id: string;
  name: string;
  boundaryType: 'vpc' | 'public_subnet' | 'private_subnet' | 'az' | 'region' | 'security_group' | 'account';
  subtitle: string;
  description: string;
  badgeLabel: string;
  badgeBg: string;
  textColor: string;
  borderColor: string;
  cardBg: string;
  iconType: 'cloud' | 'lock' | 'flag' | 'sg' | 'az';
  dashed?: boolean;
}

const BOUNDARY_DEFINITIONS: BoundaryDef[] = [
  {
    id: 'vpc',
    name: 'Amazon VPC',
    boundaryType: 'vpc',
    subtitle: 'Virtual Private Cloud',
    description: 'Logically isolated virtual network. Encloses subnets, route tables, and gateways.',
    badgeLabel: 'VPC',
    badgeBg: '#16A34A',
    textColor: '#545B64',
    borderColor: '#16A34A',
    cardBg: '#FFFFFF',
    iconType: 'cloud'
  },
  {
    id: 'public_subnet',
    name: 'Public Subnet',
    boundaryType: 'public_subnet',
    subtitle: 'Web / DMZ Tier',
    description: 'Subnet with route to Internet Gateway. Encloses ALBs, Web EC2 instances, and NAT Gateways.',
    badgeLabel: 'Public subnet',
    badgeBg: '#16A34A',
    textColor: '#166534',
    borderColor: '#7AA116',
    cardBg: '#EEF7E8',
    iconType: 'lock'
  },
  {
    id: 'private_subnet',
    name: 'Private Subnet',
    boundaryType: 'private_subnet',
    subtitle: 'Database / App Tier',
    description: 'Isolated subnet without public route. Protects RDS databases, backend microservices, and caches.',
    badgeLabel: 'Private subnet',
    badgeBg: '#0073BB',
    textColor: '#0073BB',
    borderColor: '#0073BB',
    cardBg: '#EEF6FC',
    iconType: 'lock'
  },
  {
    id: 'az',
    name: 'Availability Zone',
    boundaryType: 'az',
    subtitle: 'AZ Boundary',
    description: 'Distinct, physically isolated data centers with independent power and redundant connectivity.',
    badgeLabel: 'Availability Zone',
    badgeBg: 'transparent',
    textColor: '#0073BB',
    borderColor: '#0073BB',
    cardBg: '#FFFFFF',
    iconType: 'az',
    dashed: true
  },
  {
    id: 'security_group',
    name: 'Security Group',
    boundaryType: 'security_group',
    subtitle: 'Virtual Firewall Tier',
    description: 'Stateful virtual firewall boundary spanning instances across AZs to filter inbound/outbound ports.',
    badgeLabel: 'Security group',
    badgeBg: 'transparent',
    textColor: '#EF4444',
    borderColor: '#EF4444',
    cardBg: '#FFFFFF',
    iconType: 'sg'
  },
  {
    id: 'region',
    name: 'AWS Region',
    boundaryType: 'region',
    subtitle: 'Regional Perimeter',
    description: 'Physical geographic boundary (e.g. us-east-1) enclosing all AZs, VPCs, and S3 resources.',
    badgeLabel: 'Region',
    badgeBg: '#0073BB',
    textColor: '#0073BB',
    borderColor: '#0073BB',
    cardBg: '#FFFFFF',
    iconType: 'flag'
  },
  {
    id: 'account',
    name: 'AWS Account',
    boundaryType: 'account',
    subtitle: 'Account Boundary',
    description: 'Top-level isolation boundary separating customer workloads from managed AWS or partner accounts.',
    badgeLabel: "Customer's AWS Account",
    badgeBg: '#232F3E',
    textColor: '#232F3E',
    borderColor: '#232F3E',
    cardBg: '#FFFFFF',
    iconType: 'cloud'
  }
];

export const ServicePalette: React.FC = () => {
  const { addServiceNode, addBoundaryNode } = useArchitecture();
  const [activeTab, setActiveTab] = useState<'services' | 'boundaries'>('services');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('All');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  // Extract list of all unique categories
  const allCategoryNames = useMemo(() => {
    const cats = Array.from(new Set(AWS_SERVICES.map(s => s.category)));
    return ['All', ...cats];
  }, []);

  // Filter services by category filter & search query
  const filteredServices = useMemo(() => {
    let result = AWS_SERVICES;

    if (selectedCategoryFilter !== 'All') {
      result = result.filter(s => s.category === selectedCategoryFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        s =>
          s.name.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.architecturalRole.toLowerCase().includes(q)
      );
    }
    return result;
  }, [searchQuery, selectedCategoryFilter]);

  // Group filtered services by category
  const categories = useMemo(() => {
    const groups: Record<string, typeof AWS_SERVICES> = {};
    for (const service of filteredServices) {
      if (!groups[service.category]) {
        groups[service.category] = [];
      }
      groups[service.category].push(service);
    }
    return groups;
  }, [filteredServices]);

  const toggleCategory = (cat: string) => {
    setCollapsedCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const expandAll = () => {
    setCollapsedCategories({});
  };

  const collapseAll = () => {
    const allCollapsed: Record<string, boolean> = {};
    for (const cat of Object.keys(categories)) {
      allCollapsed[cat] = true;
    }
    setCollapsedCategories(allCollapsed);
  };

  const onDragStartService = (event: React.DragEvent, serviceId: string) => {
    event.dataTransfer.setData('application/aws-service-id', serviceId);
    event.dataTransfer.effectAllowed = 'move';
  };

  const onDragStartBoundary = (event: React.DragEvent, boundaryType: string) => {
    event.dataTransfer.setData('application/aws-boundary-type', boundaryType);
    event.dataTransfer.effectAllowed = 'move';
  };

  // Check if search query matches any network boundary
  const matchingBoundaries = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return BOUNDARY_DEFINITIONS.filter(
      b => b.name.toLowerCase().includes(q) || b.description.toLowerCase().includes(q) || b.boundaryType.includes(q)
    );
  }, [searchQuery]);

  return (
    <aside className="w-72 bg-white border-r border-slate-200 flex flex-col h-full flex-shrink-0 select-none z-10">
      {/* Top Tab Switcher: Services vs VPC & Boundaries */}
      <div className="p-2 border-b border-slate-200 bg-white">
        <div className="grid grid-cols-2 gap-1 bg-slate-100/80 p-0.5 rounded-lg text-xs font-medium">
          <button
            onClick={() => setActiveTab('services')}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-all ${
              activeTab === 'services'
                ? 'bg-white text-slate-900 shadow-xs font-semibold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>Services</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200/80 text-slate-600">
              {AWS_SERVICES.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('boundaries')}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-all ${
              activeTab === 'boundaries'
                ? 'bg-white text-slate-900 shadow-xs font-semibold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>VPC & Group</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200/80 text-slate-600">
              {BOUNDARY_DEFINITIONS.length}
            </span>
          </button>
        </div>
      </div>

      {activeTab === 'boundaries' ? (
        /* =================== VPC & BOUNDARIES PALETTE =================== */
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 custom-scrollbar">
          <div className="px-1 pt-1 pb-0.5">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Network & Security Boundaries
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              Drag containers onto canvas to design VPCs, subnets, and security groups matching official AWS architecture standards.
            </p>
          </div>

          <div className="space-y-2 pt-1">
            {BOUNDARY_DEFINITIONS.map((boundary) => (
              <div
                key={boundary.id}
                draggable
                onDragStart={(e) => onDragStartBoundary(e, boundary.boundaryType)}
                onClick={() => addBoundaryNode(boundary.boundaryType)}
                className="group relative p-2.5 rounded-xl border border-slate-200 bg-white hover:border-emerald-500 hover:shadow-xs transition-all cursor-grab active:cursor-grabbing"
              >
                {/* Visual Preview Header */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    {/* Badge Preview */}
                    {boundary.iconType === 'cloud' && (
                      <div
                        className="w-5 h-5 rounded-xs flex items-center justify-center shadow-2xs"
                        style={{ backgroundColor: boundary.badgeBg }}
                      >
                        <Cloud className="w-3 h-3 text-white" />
                      </div>
                    )}
                    {boundary.iconType === 'lock' && (
                      <div
                        className="w-5 h-5 rounded-xs flex items-center justify-center shadow-2xs"
                        style={{ backgroundColor: boundary.badgeBg }}
                      >
                        <Lock className="w-3 h-3 text-white" />
                      </div>
                    )}
                    {boundary.iconType === 'flag' && (
                      <div
                        className="w-5 h-5 rounded-xs flex items-center justify-center shadow-2xs"
                        style={{ backgroundColor: boundary.badgeBg }}
                      >
                        <Flag className="w-3 h-3 text-white" />
                      </div>
                    )}
                    {boundary.iconType === 'az' && (
                      <div className="px-1.5 py-0.5 rounded-xs border border-dashed border-[#0073BB] text-[10px] font-bold text-[#0073BB]">
                        AZ
                      </div>
                    )}
                    {boundary.iconType === 'sg' && (
                      <div className="px-1.5 py-0.5 rounded-xs border border-[#EF4444] text-[10px] font-bold text-[#EF4444]">
                        SG
                      </div>
                    )}

                    <div>
                      <div className="text-xs font-bold text-slate-900 leading-tight">
                        {boundary.name}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {boundary.subtitle}
                      </div>
                    </div>
                  </div>

                  {/* Add Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      addBoundaryNode(boundary.boundaryType);
                    }}
                    title="Add boundary to canvas"
                    className="p-1 rounded-md bg-slate-100 group-hover:bg-emerald-600 group-hover:text-white text-slate-600 transition-all flex-shrink-0 shadow-2xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Container Visual Swatch */}
                <div
                  className={`w-full h-8 rounded-md flex items-center justify-center text-[10px] font-mono font-semibold transition-all mb-1.5 ${
                    boundary.dashed ? 'border-2 border-dashed' : 'border'
                  }`}
                  style={{
                    backgroundColor: boundary.cardBg,
                    borderColor: boundary.borderColor,
                    color: boundary.textColor
                  }}
                >
                  <span className="bg-white/90 px-2 py-0.5 rounded-xs text-[10px] font-bold shadow-2xs">
                    {boundary.badgeLabel}
                  </span>
                </div>

                {/* Description */}
                <p className="text-[10px] text-slate-600 leading-tight">
                  {boundary.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* =================== SERVICES PALETTE =================== */
        <>
          {/* Header & Search */}
          <div className="p-3 border-b border-slate-200 bg-white space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                  AWS Services
                </h2>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-100 border border-slate-200 text-slate-600 font-mono font-medium">
                  {filteredServices.length}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={expandAll}
                  title="Expand all categories"
                  className="text-[10px] text-slate-500 hover:text-slate-800 px-1.5 py-0.5 rounded hover:bg-slate-100 transition-colors"
                >
                  Expand
                </button>
                <span className="text-slate-300">|</span>
                <button
                  onClick={collapseAll}
                  title="Collapse all categories"
                  className="text-[10px] text-slate-500 hover:text-slate-800 px-1.5 py-0.5 rounded hover:bg-slate-100 transition-colors"
                >
                  Collapse
                </button>
              </div>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search 300+ AWS services..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-400 transition-colors"
              />
            </div>

            {/* If searching for VPC / Subnet, show helpful shortcut */}
            {matchingBoundaries.length > 0 && (
              <button
                onClick={() => setActiveTab('boundaries')}
                className="w-full text-left px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-[11px] font-medium flex items-center justify-between hover:bg-slate-100 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <Network className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                  <span>Found {matchingBoundaries.length} boundary containers</span>
                </div>
                <span className="text-[10px] font-medium text-slate-600 underline">View &rarr;</span>
              </button>
            )}

            {/* Category Quick Filter Dropdown */}
            <div className="flex items-center gap-1.5 text-xs">
              <Filter className="w-3 h-3 text-slate-400 flex-shrink-0" />
              <select
                value={selectedCategoryFilter}
                onChange={(e) => setSelectedCategoryFilter(e.target.value)}
                aria-label="Filter by AWS Category"
                className="w-full text-[11px] py-1 px-2 rounded-md bg-white border border-slate-200 text-slate-700 font-medium focus:outline-none focus:border-slate-400 transition-colors cursor-pointer"
              >
                {allCategoryNames.map((cat) => {
                  const count = cat === 'All' ? AWS_SERVICES.length : AWS_SERVICES.filter(s => s.category === cat).length;
                  return (
                    <option key={cat} value={cat}>
                      {cat} ({count})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Services List */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-3 custom-scrollbar bg-white">
            {Object.entries(categories).map(([category, services]) => {
              const isCollapsed = !!collapsedCategories[category];

              return (
                <div key={category} className="space-y-1">
                  {/* Category Header */}
                  <button
                    onClick={() => toggleCategory(category)}
                    className="w-full flex items-center justify-between text-left px-2 py-1 rounded-md hover:bg-slate-100 text-slate-700 font-medium transition-colors group"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                      <span className="text-[11px] tracking-tight truncate font-semibold text-slate-800">
                        {category}
                      </span>
                      <span className="text-[10px] text-slate-400 font-normal">
                        ({services.length})
                      </span>
                    </div>
                    <span className="text-slate-400 group-hover:text-slate-600 flex-shrink-0">
                      {isCollapsed ? (
                        <ChevronRight className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </span>
                  </button>

                  {/* Service Items */}
                  {!isCollapsed && (
                    <div className="space-y-1 pl-1">
                      {services.map((service) => {
                        return (
                          <div
                            key={service.id}
                            draggable
                            onDragStart={(e) => onDragStartService(e, service.id)}
                            className="group flex items-center justify-between p-1.5 rounded-lg bg-white border border-slate-200/80 hover:border-slate-400 hover:bg-slate-50/50 cursor-grab active:cursor-grabbing transition-all"
                          >
                            <div className="flex items-center gap-2.5 overflow-hidden">
                              <div className="flex-shrink-0">
                                <AwsServiceIcon serviceId={service.id} size={32} />
                              </div>
                              <div className="overflow-hidden">
                                <div className="text-xs font-medium text-slate-900 truncate">
                                  {service.name}
                                </div>
                                <div className="text-[10px] text-slate-500 truncate leading-tight">
                                  {service.category}
                                </div>
                              </div>
                            </div>

                            {/* Quick Add Button */}
                            <button
                              onClick={() => addServiceNode(service.id)}
                              title="Add to canvas"
                              className="opacity-0 group-hover:opacity-100 p-1 rounded bg-slate-100 hover:bg-slate-900 hover:text-white text-slate-600 transition-all flex-shrink-0"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {filteredServices.length === 0 && (
              <div className="p-4 text-center text-xs text-slate-500">
                No matching AWS services found.
              </div>
            )}
          </div>
        </>
      )}

      {/* Palette Footer Tip */}
      <div className="p-2.5 border-t border-slate-200 bg-white text-[10px] text-slate-500 flex items-center justify-between">
        <span>💡 Drag onto canvas or click <Plus className="w-2.5 h-2.5 inline" /></span>
        {activeTab === 'services' && (
          <button
            onClick={() => setActiveTab('boundaries')}
            className="text-emerald-700 hover:underline font-semibold"
          >
            VPC Subnets &rarr;
          </button>
        )}
      </div>
    </aside>
  );
};
