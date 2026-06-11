import { useState, useMemo } from 'react';
import { Clock } from 'lucide-react';
import { useTheme } from '../../../hooks/useTheme';

const TABS = [
  { key: 'ctr_graph', label: 'CTR', yLabel: 'CTR' },
  { key: 'cvr_graph', label: 'CVR', yLabel: 'CVR' },
  { key: 'clicks_graph', label: 'Clicks', yLabel: 'Clicks' },
  { key: 'conversion_graph', label: 'Conversion', yLabel: 'Conversion' },
  { key: 'remain_graph', label: 'Remain', yLabel: 'Remain' },
];

const TOOLTIPS = {
  ctr_graph: 'Click-through rate over time — higher values indicate more engaging moments.',
  cvr_graph: 'Conversion rate over time — shows which moments drive conversions.',
  clicks_graph: 'Click distribution over time — shows when viewers click.',
  conversion_graph: 'Conversion events over time.',
  remain_graph: 'Audience retention — percentage of viewers still watching at each second.',
};

const TikTokTimeAnalysis = ({ analytics }) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [activeTab, setActiveTab] = useState('ctr_graph');
  const [hoveredPoint, setHoveredPoint] = useState(null);

  const graphData = useMemo(() => {
    if (!analytics) return [];
    const raw = analytics[activeTab];
    if (!Array.isArray(raw) || raw.length === 0) return [];
    return raw;
  }, [analytics, activeTab]);

  const maxValue = useMemo(() => {
    if (graphData.length === 0) return 1;
    return Math.max(...graphData.map(d => d.value)) || 1;
  }, [graphData]);

  const maxSecond = useMemo(() => {
    if (graphData.length === 0) return 1;
    return Math.max(...graphData.map(d => d.second)) || 1;
  }, [graphData]);

  // Scale values to 0-100 for display
  const scaledData = useMemo(() => {
    return graphData.map(d => ({
      ...d,
      scaled: (d.value / maxValue) * 100,
    }));
  }, [graphData, maxValue]);

  // Build SVG path
  const svgWidth = 800;
  const svgHeight = 300;
  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const chartW = svgWidth - padding.left - padding.right;
  const chartH = svgHeight - padding.top - padding.bottom;

  const pathD = useMemo(() => {
    if (scaledData.length === 0) return '';
    return scaledData.map((d, i) => {
      const x = padding.left + (d.second / maxSecond) * chartW;
      const y = padding.top + chartH - (d.scaled / 100) * chartH;
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');
  }, [scaledData, maxSecond, chartW, chartH]);

  const areaD = useMemo(() => {
    if (!pathD) return '';
    const lastX = padding.left + chartW;
    const firstX = padding.left;
    const baseY = padding.top + chartH;
    return `${pathD} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;
  }, [pathD, chartW, chartH]);

  // Y-axis labels
  const yLabels = [0, 20, 40, 60, 80, 100];

  // X-axis labels (seconds)
  const xLabels = useMemo(() => {
    const step = Math.max(1, Math.ceil(maxSecond / 6));
    const labels = [];
    for (let s = 0; s <= maxSecond; s += step) {
      labels.push(s);
    }
    return labels;
  }, [maxSecond]);

  const currentTab = TABS.find(t => t.key === activeTab);

  if (!analytics) {
    return (
      <div className="px-6">
        <h3 className="flex items-center gap-2 text-[18px] font-bold tracking-wider mb-2 text-white/90">
          <Clock size={16} className="opacity-60" />Interactive Time Analysis
        </h3>
        <div className={`rounded-xl border py-12 flex items-center justify-center ${isLight ? 'bg-gray-50 border-gray-200' : 'bg-white/[0.02] border-white/5'}`}>
          <span className={`text-sm ${isLight ? 'text-gray-400' : 'text-white/30'}`}>Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6">
      <h3 className="flex items-center gap-2 text-[18px] font-bold tracking-wider mb-3 text-white/90">
        <Clock size={16} className="opacity-60" />Interactive Time Analysis
      </h3>

      {/* Tabs */}
      <div className={`flex gap-1 mb-3 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}`}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setHoveredPoint(null); }}
            className={`px-4 py-2 text-xs font-bold tracking-wider transition-all relative ${
              activeTab === tab.key
                ? `${isLight ? 'text-blue-600' : 'text-blue-400'}`
                : `${isLight ? 'text-gray-400 hover:text-gray-600' : 'text-white/30 hover:text-white/50'}`
            }`}
          >
            {tab.label}
            {activeTab === tab.key && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t" />
            )}
          </button>
        ))}
      </div>

      {/* Description — shows tooltip text for active tab */}
      <p className={`text-[11px] mb-4 ${isLight ? 'text-gray-500' : 'text-white/35'}`}>
        {TOOLTIPS[activeTab]}
      </p>

      {/* Chart */}
      <div className={`rounded-xl overflow-hidden border ${isLight ? 'bg-white shadow-sm border-gray-200' : 'bg-white/[0.02] border-white/5'}`}>
        {graphData.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <span className={`text-sm ${isLight ? 'text-gray-400' : 'text-white/30'}`}>No data available</span>
          </div>
        ) : (
          <div className="p-4">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full"
              onMouseLeave={() => setHoveredPoint(null)}
            >
              {/* Grid lines */}
              {yLabels.map(v => {
                const y = padding.top + chartH - (v / 100) * chartH;
                return (
                  <g key={v}>
                    <line
                      x1={padding.left} y1={y} x2={svgWidth - padding.right} y2={y}
                      stroke={isLight ? '#e5e7eb' : 'rgba(255,255,255,0.05)'}
                      strokeDasharray="4 4"
                    />
                    <text
                      x={padding.left - 8} y={y + 4}
                      textAnchor="end"
                      className={`text-[11px] ${isLight ? 'fill-gray-400' : 'fill-white/25'}`}
                    >
                      {Math.round(v)}
                    </text>
                  </g>
                );
              })}

              {/* X-axis labels */}
              {xLabels.map(s => {
                const x = padding.left + (s / maxSecond) * chartW;
                return (
                  <text
                    key={s} x={x} y={svgHeight - 5}
                    textAnchor="middle"
                    className={`text-[11px] ${isLight ? 'fill-gray-400' : 'fill-white/25'}`}
                  >
                    {s}s
                  </text>
                );
              })}

              {/* Y-axis label */}
              <text
                x={12} y={svgHeight / 2}
                textAnchor="middle"
                transform={`rotate(-90, 12, ${svgHeight / 2})`}
                className={`text-[11px] font-bold ${isLight ? 'fill-gray-500' : 'fill-white/30'}`}
              >
                {currentTab?.yLabel}
              </text>

              {/* Area fill */}
              <path d={areaD} fill="url(#areaGradient)" />

              {/* Line */}
              <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

              {/* Gradient definition */}
              <defs>
                <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {/* Hover detection areas */}
              {scaledData.map((d, i) => {
                const x = padding.left + (d.second / maxSecond) * chartW;
                const y = padding.top + chartH - (d.scaled / 100) * chartH;
                return (
                  <g key={i} onMouseEnter={() => setHoveredPoint(i)}>
                    <rect
                      x={x - chartW / scaledData.length / 2}
                      y={padding.top}
                      width={chartW / scaledData.length}
                      height={chartH}
                      fill="transparent"
                      className="cursor-pointer"
                    />
                    {hoveredPoint === i && (
                      <>
                        <line x1={x} y1={padding.top} x2={x} y2={padding.top + chartH} stroke={isLight ? '#9ca3af' : 'rgba(255,255,255,0.15)'} strokeDasharray="3 3" />
                        <circle cx={x} cy={y} r={5} fill="#3b82f6" stroke="white" strokeWidth="2" />
                        {/* Tooltip */}
                        <rect
                          x={x - 30} y={y - 38}
                          width={60} height={28}
                          rx={6}
                          fill={isLight ? '#1f2937' : 'rgba(255,255,255,0.9)'}
                        />
                        <text
                          x={x} y={y - 28}
                          textAnchor="middle"
                          className={`text-[10px] font-bold ${isLight ? 'fill-white' : 'fill-black'}`}
                        >
                          {currentTab?.yLabel}
                        </text>
                        <text
                          x={x} y={y - 16}
                          textAnchor="middle"
                          className={`text-[11px] font-bold ${isLight ? 'fill-white' : 'fill-black'}`}
                        >
                          {Math.round(d.scaled)}
                        </text>
                      </>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </div>
    </div>
  );
};

export default TikTokTimeAnalysis;
