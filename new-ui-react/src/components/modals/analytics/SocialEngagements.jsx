import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useId,
  useMemo,
} from "react";
import {
  ThumbsUp,
  Share2,
  MessageCircle,
  Zap,
  TrendingUp,
  LayoutGrid,
  BarChart2,
  Eye,
} from "lucide-react";
import * as am5 from "@amcharts/amcharts5";
import * as am5xy from "@amcharts/amcharts5/xy";
import am5themes_Dark from "@amcharts/amcharts5/themes/Dark";
import { useTheme } from "../../../hooks/useTheme";
import DateRangePicker from './DateRangePicker';
import { getAdvertiserInsightsByDateRange } from '../../../services/api';
/**
 * Transform ad-level LCS API data into chart-friendly format.
 * Handles field name differences across networks:
 *   - Facebook/Instagram: { likes, share, comment, engagement_rate }
 *   - YouTube:  { likes, dislike, comment, view } — date is Unix timestamp (seconds)
 *   - LinkedIn: { likes, comments, followers, date } — date is "YYYY-MM-DD" string
 */
function transformAdLcs(rawData, network) {
  if (!rawData || !Array.isArray(rawData) || rawData.length === 0) return null;
  const isYoutube = network === 'youtube';
  const isLinkedin = network === 'linkedin';
  const isUnixSeconds = ['youtube', 'reddit'].includes(network);

  const getDate = (row) => {
    if (isUnixSeconds) return new Date(row.date * 1000).getTime();
    return new Date(row.date).getTime();
  };
  const getShares = (row) => {
    if (isYoutube) return Number(row.view) || Number(row.views) || 0;
    if (isLinkedin) return Number(row.followers) || 0;
    return Number(row.shares) || Number(row.share) || 0;
  };
  const getComments = (row) => {
    return Number(row.comments) || Number(row.comment) || 0;
  };

  const engagement = rawData.map((row) => {
    const likes = Number(row.likes) || 0;
    const shares = getShares(row);
    const comments = getComments(row);
    return { date: getDate(row), likes, shares, comments, total: likes + shares + comments };
  });

  const rate = rawData.map((row) => {
    const likes = Number(row.likes) || 0;
    const shares = getShares(row);
    const comments = getComments(row);
    return {
      date: getDate(row),
      rate: Number(row.engagement_rate) || 0,
      likes, shares, comments,
      total: likes + shares + comments,
    };
  });

  return { engagement, rate };
}

const MONTH_NAMES = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/**
 * Transform advertiser-level LCS API data (object keyed by "mon_year")
 * into chart-friendly format.
 * Handles field name differences across networks:
 *   - Facebook/Instagram: { likes, shares, comments }
 *   - YouTube:  { likes, dislikes, comments, views }
 *   - LinkedIn: { likes, comments } — no shares field
 */
function transformAdvertiserLcs(rawData, network) {
  if (!rawData || typeof rawData !== 'object') return null;
  const keys = Object.keys(rawData).filter(k => k.includes('_'));
  if (keys.length === 0) return null;

  const isYoutube = network === 'youtube';
  const isLinkedin = network === 'linkedin';

  const getShares = (d) => {
    if (isYoutube) return d.views || d.view || 0;
    if (isLinkedin) return d.followers || 0;
    return d.shares || 0;
  };

  const sorted = keys.sort((a, b) => {
    const [mA, yA] = a.split('_');
    const [mB, yB] = b.split('_');
    return (Number(yA) - Number(yB)) || (MONTH_NAMES.indexOf(mA) - MONTH_NAMES.indexOf(mB));
  });

  const engagement = sorted.map((key) => {
    const [mon, year] = key.split("_");
    const monthIdx = MONTH_NAMES.indexOf(mon);
    const d = rawData[key];
    const sharesVal = getShares(d);
    return {
      date: new Date(Number(year), monthIdx, 1).getTime(),
      likes: d.likes || 0,
      shares: sharesVal,
      comments: d.comments || 0,
      total: (d.likes || 0) + sharesVal + (d.comments || 0),
      totalAds: d.total_ads || d.ad_count || 0,
    };
  });

  const rate = sorted.map((key) => {
    const [mon, year] = key.split("_");
    const monthIdx = MONTH_NAMES.indexOf(mon);
    const d = rawData[key];
    const sharesVal = getShares(d);
    const total = (d.likes || 0) + sharesVal + (d.comments || 0);
    return {
      date: new Date(Number(year), monthIdx, 1).getTime(),
      rate: d.engagement_rate || 0,
      likes: d.likes || 0,
      shares: sharesVal,
      comments: d.comments || 0,
      total,
      totalAds: d.total_ads || d.ad_count || 0,
    };
  });

  return { engagement, rate };
}

const SocialEngagements = ({ adId, adLcs, advertiserLcs, postOwnerId, availableYears, network = 'facebook' }) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const hideToggle = false;
  const [level, setLevel] = useState('advertiser');
  const [filteredLcs, setFilteredLcs] = useState(null);
  const [isFiltering, setIsFiltering] = useState(false);

  // Reset state only when navigating to a different ad
  useEffect(() => {
    setLevel('advertiser');
    setFilteredLcs(null);
    setIsFiltering(false);
  }, [adId]);
  const lineRootRef = useRef(null);
  const barRootRef = useRef(null);
  const uniqueId = useId();
  const lineId = `line-chart-${uniqueId.replace(/:/g, "")}`;
  const barId = `bar-chart-${uniqueId.replace(/:/g, "")}`;

  const adChartData = useMemo(() => transformAdLcs(adLcs, network), [adLcs, network]);
  const advertiserChartData = useMemo(() => transformAdvertiserLcs(filteredLcs || advertiserLcs, network), [advertiserLcs, filteredLcs, network]);

  const handleDateRangeApply = async (range) => {
    if (!range) {
      setFilteredLcs(null);
      return;
    }
    setIsFiltering(true);
    try {
      const res = await getAdvertiserInsightsByDateRange({
        post_owner_id: postOwnerId || (advertiserLcs?.post_owner_id),
        from_date: range.fromDate,
        to_date: range.toDate,
        type: 'lcs',
        network,
      });
      if (res.code === 200) {
        setFilteredLcs(res.data);
      } else {
        setFilteredLcs({});
      }
    } catch (err) {
      console.error('LCS Date Range Fetch Error:', err);
    } finally {
      setIsFiltering(false);
    }
  };

  const currentData = level === "ad" ? adChartData : advertiserChartData;
  const isDaily = level === "ad"; // ad-level data is daily, advertiser is monthly
  const engagementData = useMemo(() => currentData?.engagement || [], [currentData]);
  const rateData = useMemo(() => currentData?.rate || [], [currentData]);
  const avgRate =
    rateData.length > 0
      ? (rateData.reduce((s, d) => s + d.rate, 0) / rateData.length).toFixed(1)
      : "0.0";

  const noData = engagementData.length === 0;

  // Compute totals from the last data point (cumulative) for ad-level,
  // or sum all months for advertiser-level
  const totals = useMemo(() => {
    if (engagementData.length === 0)
      return {
        likes: 0,
        shares: 0,
        comments: 0,
        total: 0,
        totalAds: 0,
        dataPoints: 0,
      };
    if (isDaily) {
      const last = engagementData[engagementData.length - 1];
      return {
        likes: last.likes,
        shares: last.shares,
        comments: last.comments,
        total: last.total,
        totalAds: 0,
        dataPoints: engagementData.length,
      };
    }
    const sum = engagementData.reduce(
      (acc, d) => ({
        likes: acc.likes + d.likes,
        shares: acc.shares + d.shares,
        comments: acc.comments + d.comments,
        total: acc.total + d.total,
        totalAds: acc.totalAds + (d.totalAds || 0),
      }),
      { likes: 0, shares: 0, comments: 0, total: 0, totalAds: 0 },
    );
    sum.dataPoints = engagementData.length;
    return sum;
  }, [engagementData, isDaily]);

  const fmt = (n) => {
    if (n >= 1_000_000)
      return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  };

  // Shared tooltip style
  const styleTooltip = (tooltip) => {
    tooltip.get("background").setAll({
      fill: am5.color(0x000000),
      fillOpacity: 0.95,
      stroke: am5.color(0xffffff),
      strokeOpacity: 0.15,
      strokeWidth: 1,
      cornerRadius: 6,
      shadowColor: am5.color(0x000000),
      shadowBlur: 16,
      shadowOffsetY: 4,
      shadowOpacity: 0.5,
    });
    tooltip.label.setAll({
      fill: am5.color(0xffffff),
      fontSize: 12,
      fontFamily: "inherit",
      paddingTop: 2,
      paddingBottom: 2,
      paddingLeft: 4,
      paddingRight: 4,
    });
  };

  // Line chart
  useLayoutEffect(() => {
    if (lineRootRef.current) { lineRootRef.current.dispose(); lineRootRef.current = null; }
    if (noData) return;


    const root = am5.Root.new(lineId);
    lineRootRef.current = root;

    if (!isLight) root.setThemes([am5themes_Dark.new(root)]);
    root._logo.dispose();
    if (!isLight) root.interfaceColors.set("background", am5.color(0x000000));

    const chart = root.container.children.push(
      am5xy.XYChart.new(root, {
        panX: false,
        panY: false,
        paddingLeft: 8,
        paddingRight: 12,
        paddingTop: 10,
        paddingBottom: 0,
      }),
    );

    const xAxis = chart.xAxes.push(
      am5xy.DateAxis.new(root, {
        baseInterval: isDaily
          ? { timeUnit: "day", count: 1 }
          : { timeUnit: "month", count: 1 },
        renderer: am5xy.AxisRendererX.new(root, {
          minGridDistance: 60,
          strokeOpacity: 0,
        }),
        dateFormats: isDaily ? { day: "MMM dd" } : { month: "MMM" },
        tooltipDateFormat: isDaily ? "MMM dd, yyyy" : "MMM dd, yyyy",
      }),
    );
    xAxis.get("renderer").labels.template.setAll({
      fill: am5.color(isLight ? 0x999999 : 0x666666),
      fontSize: 10,
      paddingTop: 4,
    });
    xAxis.get("renderer").grid.template.setAll({ strokeOpacity: 0 });

    const yAxis = chart.yAxes.push(
      am5xy.ValueAxis.new(root, {
        renderer: am5xy.AxisRendererY.new(root, { strokeOpacity: 0 }),
      }),
    );
    yAxis.get("renderer").labels.template.setAll({
      fill: am5.color(isLight ? 0x999999 : 0x555555),
      fontSize: 10,
    });
    yAxis.get("renderer").grid.template.setAll({
      stroke: am5.color(isLight ? 0x000000 : 0xffffff),
      strokeOpacity: isLight ? 0.06 : 0.04,
      strokeDasharray: [2, 2],
    });

    const seriesConfig = [
      { field: "likes", label: "Likes", color: 0x818cf8, width: 2.5 },
      { field: "shares", label: "Shares", color: 0x10b981, width: 2 },
      {
        field: "comments",
        label: "Comments",
        color: 0x64748b,
        width: 1.5,
        dash: [4, 2],
      },
    ];

    // Shared cursor tooltip on the first series
    const dateFmt = isDaily ? "MMM dd, yyyy" : "MMM dd, yyyy";
    const sharedTooltipText =
      `[bold fontSize:11px #ffffff]{valueX.formatDate('${dateFmt}')}[/]\n` +
      `[fontSize:10px #ffffff50]─────────────────[/]\n` +
      `[fontSize:11px #818cf8]\u25CF[/] [fontSize:11px #ffffffcc]Likes[/]        [bold fontSize:12px #ffffff]{likes}[/]\n` +
      (network !== 'linkedin' ? `[fontSize:11px #10b981]\u25CF[/] [fontSize:11px #ffffffcc]${network === 'youtube' ? 'Views' : 'Shares'}[/]      [bold fontSize:12px #ffffff]{shares}[/]\n` : '') +
      `[fontSize:11px #64748b]\u25CF[/] [fontSize:11px #ffffffcc]Comments[/]  [bold fontSize:12px #ffffff]{comments}[/]` +
      (!isDaily
        ? `\n[fontSize:10px #ffffff50]─────────────────[/]\n[fontSize:10px #38bdf8]●[/] [fontSize:10px #ffffffaa]Total Ads[/]   [bold fontSize:11px #ffffff]{totalAds}[/]`
        : "");

    seriesConfig.forEach(({ field, label, color, width, dash }, idx) => {
      const series = chart.series.push(
        am5xy.LineSeries.new(root, {
          xAxis,
          yAxis,
          valueYField: field,
          valueXField: "date",
          stroke: am5.color(color),
          connect: true,
          tooltip:
            idx === 0
              ? am5.Tooltip.new(root, {
                  pointerOrientation: "horizontal",
                  labelText: sharedTooltipText,
                })
              : undefined,
        }),
      );

      if (idx === 0) {
        styleTooltip(series.get("tooltip"));
      }

      series.strokes.template.setAll({
        strokeWidth: width,
        ...(dash ? { strokeDasharray: dash } : {}),
      });

      // Always show bullet dots on each data point so all lines are visible even at 0
      series.bullets.push(() => {
        return am5.Bullet.new(root, {
          sprite: am5.Circle.new(root, {
            radius: 3,
            fill: am5.color(color),
            stroke: am5.color(isLight ? 0xffffff : 0x0e0e0e),
            strokeWidth: 1.5,
            interactive: true,
          }),
        });
      });

      series.data.setAll(engagementData);
    });

    const cursor = chart.set(
      "cursor",
      am5xy.XYCursor.new(root, {
        behavior: "none",
        xAxis,
        snapToSeries: chart.series.values,
      }),
    );
    cursor.lineX.setAll({
      stroke: am5.color(isLight ? 0x000000 : 0xffffff),
      strokeOpacity: 0.08,
      strokeDasharray: [3, 3],
    });
    cursor.lineY.set("visible", false);

    return () => root.dispose();
  }, [level, isDaily, lineId, theme, engagementData, noData]);

  // Bar chart
  useLayoutEffect(() => {
    if (barRootRef.current) { barRootRef.current.dispose(); barRootRef.current = null; }
    if (noData || network !== 'facebook') return;


    const root = am5.Root.new(barId);
    barRootRef.current = root;

    if (!isLight) root.setThemes([am5themes_Dark.new(root)]);
    root._logo.dispose();
    if (!isLight) root.interfaceColors.set("background", am5.color(0x000000));

    const chart = root.container.children.push(
      am5xy.XYChart.new(root, {
        panX: false,
        panY: false,
        paddingLeft: 8,
        paddingRight: 12,
        paddingTop: 10,
        paddingBottom: 0,
      }),
    );

    const xAxis = chart.xAxes.push(
      am5xy.DateAxis.new(root, {
        baseInterval: isDaily
          ? { timeUnit: "day", count: 1 }
          : { timeUnit: "month", count: 1 },
        renderer: am5xy.AxisRendererX.new(root, {
          minGridDistance: 60,
          cellStartLocation: 0.15,
          cellEndLocation: 0.85,
          strokeOpacity: 0,
        }),
        dateFormats: isDaily ? { day: "MMM dd" } : { month: "MMM" },
        tooltipDateFormat: isDaily ? "MMM dd, yyyy" : "MMM dd, yyyy",
      }),
    );
    xAxis.get("renderer").labels.template.setAll({
      fill: am5.color(isLight ? 0x999999 : 0x666666),
      fontSize: 10,
      paddingTop: 4,
    });
    xAxis.get("renderer").grid.template.setAll({ strokeOpacity: 0 });

    const yAxis = chart.yAxes.push(
      am5xy.ValueAxis.new(root, {
        min: 0,
        renderer: am5xy.AxisRendererY.new(root, { strokeOpacity: 0 }),
        numberFormat: "#'%'",
      }),
    );
    yAxis.get("renderer").labels.template.setAll({
      fill: am5.color(isLight ? 0x999999 : 0x555555),
      fontSize: 10,
    });
    yAxis.get("renderer").grid.template.setAll({
      stroke: am5.color(isLight ? 0x000000 : 0xffffff),
      strokeOpacity: isLight ? 0.06 : 0.04,
      strokeDasharray: [2, 2],
    });

    const barDateFmt = isDaily ? "MMM dd, yyyy" : "MMM dd, yyyy";
    const barTooltipText =
      `[bold fontSize:11px #ffffff]{valueX.formatDate('${barDateFmt}')}[/]\n` +
      `[fontSize:10px #ffffff50]─────────────────[/]\n` +
      `[fontSize:11px #ffffffcc]Eng. Rate[/]     [bold fontSize:14px #ffffff]{valueY}%[/]` +
      (!isDaily
        ? `\n[fontSize:10px #ffffff50]─────────────────[/]\n[fontSize:10px #38bdf8]●[/] [fontSize:10px #ffffffaa]Total Ads[/]   [bold fontSize:11px #ffffff]{totalAds}[/]`
        : "");

    const seriesTooltip = am5.Tooltip.new(root, {
      pointerOrientation: "horizontal",
      labelText: barTooltipText,
    });
    styleTooltip(seriesTooltip);

    const series = chart.series.push(
      am5xy.LineSeries.new(root, {
        xAxis,
        yAxis,
        valueYField: "rate",
        valueXField: "date",
        tooltip: seriesTooltip,
        connect: true,
        stroke: am5.color(0x818cf8),
      }),
    );

    series.strokes.template.setAll({ strokeWidth: 2 });

    // Bullet dots at each data point
    series.bullets.push(() => {
      return am5.Bullet.new(root, {
        sprite: am5.Circle.new(root, {
          radius: 5,
          fill: am5.color(0x818cf8),
          stroke: am5.color(isLight ? 0xffffff : 0x0e0e0e),
          strokeWidth: 1.5,
          interactive: true,
          cursorOverStyle: "pointer",
        }),
      });
    });

    series.data.setAll(rateData);

    const barCursor = chart.set(
      "cursor",
      am5xy.XYCursor.new(root, {
        behavior: "none",
        xAxis,
        snapToSeries: [series],
      }),
    );
    barCursor.lineX.setAll({
      stroke: am5.color(isLight ? 0x000000 : 0xffffff),
      strokeOpacity: 0.08,
      strokeDasharray: [3, 3],
    });
    barCursor.lineY.set("visible", false);

    return () => root.dispose();
  }, [level, isDaily, barId, theme, rateData, noData, avgRate]);

  return (
    <div className="px-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="flex items-center gap-2 text-[18px] font-bold tracking-wider text-white/90">
          <BarChart2 size={16} className="opacity-60" />
          Social Engagements
        </h3>
        <div className="flex items-center gap-3">
          <div className={level === 'advertiser' ? 'block' : 'hidden'}>
            <DateRangePicker
              availableYears={availableYears || advertiserLcs?.available_years || []}
              onApply={handleDateRangeApply}
              isLight={isLight}
            />
          </div>

          {!hideToggle && (
            <div className={`flex p-0.5 rounded-lg border ${isLight ? 'bg-gray-100 border-gray-200' : 'bg-black/40 border-white/5'}`}>
              <button
                onClick={() => setLevel('ad')}
                className={`px-3 py-1 rounded-md text-[10px] font-bold tracking-wider transition-all ${level === 'ad' ? 'bg-indigo-500/15 text-white/90 border border-indigo-500/20' : 'text-[#9f9f9f] hover:text-white/70 border border-transparent'}`}
              >
                AD LEVEL
              </button>
              <button
                onClick={() => setLevel('advertiser')}
                className={`px-3 py-1 rounded-md text-[10px] font-bold tracking-wider transition-all ${level === 'advertiser' ? 'bg-indigo-500/15 text-white/90 border border-indigo-500/20' : 'text-[#9f9f9f] hover:text-white/70 border border-transparent'}`}
              >
                ADVERTISER LEVEL
              </button>
            </div>
          )}
        </div>
      </div>

      {noData ? (
        <div className={`rounded-xl border py-12 flex items-center justify-center ${isLight ? 'bg-gray-50 border-gray-200' : 'bg-white/[0.02] border-white/5'}`}>
          <span className={`text-sm ${isLight ? 'text-gray-400' : 'text-white/30'}`}>
            {isFiltering ? 'Fetching analytics...' : (level === 'ad' ? adLcs : advertiserLcs) === null ? 'Loading...' : 'No data found for this range'}
          </span>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Summary Stats - Compact Icons */}
          <div className="flex items-center gap-2 flex-wrap">
            {[
              {
                label: "Likes",
                value: fmt(totals.likes),
                icon: ThumbsUp,
                color: "text-[#6b99ff]",
                bg: isLight ? "bg-indigo-50 border-indigo-100" : "bg-[#3762c1]/10 border-[#3759a3]/15",
              },
              network !== 'linkedin' && {
                label: network === 'youtube' ? "Views" : "Shares",
                value: fmt(totals.shares),
                icon: network === 'youtube' ? Eye : Share2,
                color: "text-emerald-400",
                bg: isLight ? "bg-emerald-50 border-emerald-100" : "bg-emerald-500/10 border-emerald-500/15",
              },
              {
                label: "Comments",
                value: fmt(totals.comments),
                icon: MessageCircle,
                color: "text-slate-400",
                bg: isLight ? "bg-slate-50 border-slate-200" : "bg-slate-500/10 border-slate-500/15",
              },
              network === 'facebook' && {
                label: "Eng. Rate",
                value: `${avgRate}%`,
                icon: TrendingUp,
                color: "text-pink-400",
                bg: isLight ? "bg-pink-50 border-pink-100" : "bg-pink-500/10 border-pink-500/15",
              },
              ...(level === "advertiser" && totals.totalAds > 0
                ? [
                    {
                      label: "Total Ads",
                      value: fmt(totals.totalAds),
                      icon: LayoutGrid,
                      color: "text-sky-400",
                      bg: isLight
                        ? "bg-sky-50 border-sky-100"
                        : "bg-sky-500/10 border-sky-500/15",
                    },
                  ]
                : []),
            ].filter(Boolean).map((s) => (
              <div
                key={s.label}
                className={`group/pill relative flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 cursor-pointer ${s.bg}`}
              >
                <s.icon size={13} className={s.color} />
                <span className={`text-xs font-bold tabular-nums ${s.color}`}>
                  {s.value}
                </span>
                <div
                  className={`absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap opacity-0 group-hover/pill:opacity-100 transition-opacity pointer-events-none z-20 shadow-lg ${isLight ? "bg-gray-800 text-white" : "bg-white text-gray-900"}`}
                >
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          <div className={`grid grid-cols-1 gap-4 ${network === 'facebook' ? 'lg:grid-cols-2' : ''}`}>
            {/* Line Chart - Growth */}
            <div className={`rounded-xl overflow-hidden border ${isLight ? 'bg-white shadow-sm border-gray-200' : 'bg-white/[0.02] border-white/5'}`}>
              <div className={`flex items-center justify-between px-3.5 py-2 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}`}>
                <span className={`text-xs font-semibold uppercase text-[#9f9f9f]`}>Growth Overview</span>
                <div className="flex gap-3">
                  {[
                    { label: 'Likes', color: 'bg-indigo-400' },
                    network !== 'linkedin' && { label: network === 'youtube' ? 'Views' : 'Shares', color: 'bg-emerald-400' },
                    { label: 'Comments', color: 'bg-slate-400', dashed: true },
                  ].filter(Boolean).map(l => (
                    <div key={l.label} className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${l.color} ${l.dashed ? 'opacity-50' : ''}`} />
                      <span className={`text-[10px] ${isLight ? 'text-gray-400' : 'text-white/30'}`}>{l.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div id={lineId} className="w-full h-48" />
            </div>

            {/* Bar Chart - Engagement Rate — Facebook only */}
            {network === 'facebook' && (
            <div className={`rounded-xl overflow-hidden border ${isLight ? 'bg-white shadow-sm border-gray-200' : 'bg-white/[0.02] border-white/5'}`}>
              <div className={`flex items-center justify-between px-3.5 py-2 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}`}>
                <span className={`text-xs font-semibold uppercase text-[#9f9f9f]`}>Engagement Rate %</span>
                <div className="text-sm font-bold text-indigo-400">
                  {avgRate}%
                </div>
              </div>
              <div id={barId} className="w-full h-48" />
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SocialEngagements;
