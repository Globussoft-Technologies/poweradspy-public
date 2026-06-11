import React, { useEffect, useState, useMemo, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { DateRange } from "react-date-range";
import { FiCalendar } from "react-icons/fi";
import { GrPowerReset } from "react-icons/gr";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import "react-date-range/dist/styles.css";
import "react-date-range/dist/theme/default.css";

import { fetchUserUsageCost } from "../store/actions/adsgptActions";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

/* ---------- Utils ---------- */
const formatForBackend = (date) => {
  if (!date) return undefined;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

/* ---------- Components (Custom Tooltip) ---------- */
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white p-3 border border-gray-100 shadow-xl rounded-lg text-sm">
        <p className="font-bold text-gray-700 mb-2">{label}</p>
        <p className="text-[#5C61F2] font-semibold">
          Cost: ${Number(data.cost_usd).toFixed(4)}
        </p>
        <div className="mt-1 pt-1 border-t border-gray-100 flex flex-col gap-0.5 text-xs text-gray-500">
          <p>Input Tokens: {data.input_tokens}</p>
          <p>Output Tokens: {data.output_tokens}</p>
        </div>
      </div>
    );
  }
  return null;
};

/* ---------- Main Component ---------- */
const UsageLineGraph = ({ userId }) => {
  const dispatch = useDispatch();
  const { userUsageCost, loading } = useSelector((s) => s.adsgpt);

  const pickerRef = useRef(null);
  const lastRequestRef = useRef(null);

  /* ---------- Date State ---------- */
  const [range, setRange] = useState([
    { startDate: null, endDate: null, key: "selection" },
  ]);
  const [tempRange, setTempRange] = useState(range);
  const [isOpen, setIsOpen] = useState(false);

  /* ---------- Initial Load (Day-wise) ---------- */
  useEffect(() => {
    if (!userId) return;

    const requestKey = JSON.stringify({
      userId,
      groupBy: "day",
    });

    if (lastRequestRef.current === requestKey) return;

    lastRequestRef.current = requestKey;

    dispatch(fetchUserUsageCost({ userId, groupBy: "day" }));
  }, [userId, dispatch]);

  /* ---------- Apply ---------- */
  const handleApply = () => {
    setRange(tempRange);
    setIsOpen(false);

    dispatch(
      fetchUserUsageCost({
        userId,
        groupBy: "range",
        from: formatForBackend(tempRange[0].startDate),
        to: formatForBackend(tempRange[0].endDate),
      })
    );
  };

  const handleReset = () => {
    // 1. Clear local UI state
    const emptyRange = [{ startDate: null, endDate: null, key: "selection" }];
    setRange(emptyRange);
    setTempRange(emptyRange);
    setIsOpen(false);

    // 2. Reset graph to default (day-wise)
    dispatch(
      fetchUserUsageCost({
        userId,
        groupBy: "day",
      })
    );
  };

  /* ---------- Cancel ---------- */
  const handleCancel = () => {
    setTempRange(range);
    setIsOpen(false);
  };

  /* ---------- Close on outside click ---------- */
  useEffect(() => {
    const handler = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setIsOpen(false);
        setTempRange(range);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [range]);

  /* ---------- Normalize API Data ---------- */
  const chartData = useMemo(() => {
    return Array.isArray(userUsageCost?.data)
      ? userUsageCost.data.map((item) => ({
        date: item.date,
        cost_usd: Number(item.cost_usd || 0),
        input_tokens: Number(item.input_tokens || 0),
        output_tokens: Number(item.output_tokens || 0),
      }))
      : [];
  }, [userUsageCost]);


  const totalCost = useMemo(() => {
    if (!chartData.length) return 0;
    return chartData.reduce((sum, item) => sum + item.cost_usd, 0);
  }, [chartData]);

  /* ---------- Render ---------- */
  return (
    <div className="usage-graph-wrapper w-full">
      {/* Header / Date Picker */}
      <div className="relative flex items-center gap-2 mb-4" ref={pickerRef}>
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-md bg-white hover:bg-gray-50 transition-colors"
        >
          <FiCalendar className="text-gray-500" />
          <span className="text-xs font-medium text-gray-700">
            {range[0].startDate && range[0].endDate
              ? `${formatForBackend(range[0].startDate)} → ${formatForBackend(
                range[0].endDate
              )}`
              : "Select date range"}
          </span>
        </button>

        <button
          onClick={handleReset}
          title="Reset"
          className="p-2 border border-gray-200 rounded-md bg-white hover:bg-gray-50 transition-colors text-gray-500"
        >
          <GrPowerReset />
        </button>

        {isOpen && (
          <div className="absolute z-50 top-full left-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden">
            <DateRange
              ranges={tempRange}
              onChange={(r) => setTempRange([r.selection])}
              moveRangeOnFirstSelection={false}
              rangeColors={["#5C61F2"]}
              maxDate={new Date()}
            />
            <div className="flex justify-end gap-2 p-3 border-t border-gray-100 bg-gray-50">
              <button
                onClick={handleCancel}
                className="px-4 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleApply}
                className="px-4 py-1.5 text-sm font-medium text-white bg-[#5C61F2] rounded-lg hover:bg-[#4a4ecf]"
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </div>

      {loading && (
        <Skeleton
          height={320}
          borderRadius={12}
          baseColor="#f3f4f6"
          highlightColor="#e5e7eb"
        />
      )}

      {!loading && chartData.length === 0 && (
        <div className="flex items-center justify-center h-[320px] bg-gray-50 rounded-xl border border-dashed border-gray-300">
          <p className="text-gray-400 font-medium">No usage data available</p>
        </div>
      )}

      {/* Chart Container */}
      <div className="relative">
        {/* KPI Card */}
        {!loading && chartData.length > 0 && (
          <div className="absolute top-0 right-0 z-10 bg-white/90 backdrop-blur-sm border border-gray-100 rounded-lg px-4 py-2 shadow-sm pointer-events-none">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
              Total Cost
            </p>
            <p className="text-lg font-bold text-gray-900">
              ${totalCost.toFixed(2)}
            </p>
          </div>
        )}

        {!loading && chartData.length > 0 && (
          <div className="w-full h-[320px] bg-white rounded-xl">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 20, right: 10, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#5C61F2" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#5C61F2" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#f0f0f0"
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={30}
                  dy={10}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `$${value}`}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#5C61F2', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Area
                  type="monotone"
                  dataKey="cost_usd"
                  stroke="#5C61F2"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorCost)"
                  animationDuration={1500}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};

export default UsageLineGraph;
