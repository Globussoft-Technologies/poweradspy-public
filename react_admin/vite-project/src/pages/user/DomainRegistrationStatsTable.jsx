import { useState } from "react";
import { GoTriangleDown, GoTriangleUp } from "react-icons/go";

import fb from "../../assets/Social/fb.png";
import Instagram from "../../assets/Social/Instagram.png";
import Google from "../../assets/Social/Google.png";
import Youtube from "../../assets/Social/Youtube.png";
import Googleads from "../../assets/Social/Google-ads.png";
import Linkedin from "../../assets/Social/Linkedin.png";
import Reddit from "../../assets/Social/Reddit.png";
import Quora from "../../assets/Social/Quora.png";
import Pinterest from "../../assets/Social/Pinterest.png";
import Native from "../../assets/Social/Native.png";

// GDN has no logo of its own in assets/Social — it is Google's display network, so it reuses
// the Google Ads mark (same choice the Crawler Insights platform strip makes).
const PLATFORM_ICONS = {
  facebook: fb,
  instagram: Instagram,
  google: Google,
  youtube: Youtube,
  gdn: Googleads,
  linkedin: Linkedin,
  reddit: Reddit,
  quora: Quora,
  pinterest: Pinterest,
  native: Native,
};

const fmtNum = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US"));

// Backend sends 'YYYY-MM-DD' / 'YYYY-MM-DD HH:mm:ss' strings. They are split by hand rather
// than passed through `new Date()` so the displayed day can never drift by a timezone.
export const formatDay = (day) => {
  if (!day) return "—";
  const [y, m, d] = String(day).split("-");
  return y && m && d ? `${d}/${m}/${y}` : String(day);
};

export const formatTimestamp = (ts) => {
  if (!ts) return "—";
  const [day, time] = String(ts).split(" ");
  return time ? `${formatDay(day)} ${time}` : formatDay(day);
};

const successRate = (updated, processed) =>
  processed > 0 ? `${Math.round((updated / processed) * 100)}%` : "—";

const HEAD_CELL =
  "!px-[18px] !py-[18px] text-[15px] font-[400] bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent";

const DomainRegistrationStatsTable = ({ networks, loading }) => {
  // Which platforms have their per-day breakdown open. Collapsed by default so all ten
  // platforms stay visible at a glance; a platform is drilled into on demand.
  const [expanded, setExpanded] = useState({});

  const toggle = (network) =>
    setExpanded((prev) => ({ ...prev, [network]: !prev[network] }));

  const rows = networks || [];

  return (
    <div className="w-full flex flex-col">
      <div className="w-full rounded-xl border border-[#e8e8e8] bg-white shadow-sm mt-[24px]">
        <div className="pt-[17px] pb-[19px] pl-[24px] pr-[14px]">
          <p className="text-[17px] font-[600] text-[#1E1B39]">
            Platform Wise Domain Registration Date Processing
          </p>
          <p className="text-[13px] font-[400] text-[#7a83a8] mt-[4px]">
            Click a platform to see its day-by-day breakdown
          </p>
        </div>

        <div className="overflow-auto w-full">
          <table className="min-w-full table-fixed">
            <thead className="sticky top-0">
              <tr className="border-b border-gray-100 bg-[#F9F9FB] text-center">
                <th className={`${HEAD_CELL} text-left`}>Platform</th>
                <th className={HEAD_CELL}>Processed</th>
                <th className={HEAD_CELL}>Updated</th>
                <th className={HEAD_CELL}>Failed</th>
                <th className={HEAD_CELL}>Success Rate</th>
                {/* Pending is a whole-table figure, not a range one: a queued domain has never
                    been processed, so it has no processing date to filter by. Labelled so it is
                    not read as "pending within the selected range". */}
                <th
                  className={HEAD_CELL}
                  title="Domains still queued (status 0) right now — a whole-table count, not limited to the selected range"
                >
                  Pending (all time)
                </th>
                <th className={HEAD_CELL}>Last Updated</th>
              </tr>
            </thead>
            <tbody className="text-[14px] font-[400] text-[#1F1F1F]">
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j} className="!px-[18px] !py-[18px]">
                        <div className="h-4 bg-gray-200 rounded w-3/4 animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length > 0 ? (
                rows.map((row) => {
                  const isOpen = !!expanded[row.network];
                  const daily = row.daily || [];
                  return [
                    <tr
                      key={row.network}
                      onClick={() => toggle(row.network)}
                      className="border-b border-gray-100 text-center cursor-pointer hover:bg-[#f7f8ff]"
                      data-testid={`platform-row-${row.network}`}
                    >
                      <td className="!px-[18px] !py-[18px] text-left">
                        <div className="flex items-center gap-[10px]">
                          {isOpen ? (
                            <GoTriangleUp className="text-[#7a83a8]" />
                          ) : (
                            <GoTriangleDown className="text-[#7a83a8]" />
                          )}
                          {PLATFORM_ICONS[row.network] ? (
                            <img
                              src={PLATFORM_ICONS[row.network]}
                              alt=""
                              className="w-[20px] h-[20px]"
                            />
                          ) : null}
                          <span className="font-[500]">{row.label || row.network}</span>
                          {row.error ? (
                            <span
                              title={row.error}
                              className="text-[12px] text-[#b91c1c] bg-[#fee2e2] rounded-[6px] px-[6px] py-[2px]"
                            >
                              unavailable
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="!px-[18px] !py-[18px] font-[600] text-[#1f296a]">
                        {fmtNum(row.totals?.processed)}
                      </td>
                      <td className="!px-[18px] !py-[18px] text-[#16a34a]">
                        {fmtNum(row.totals?.updated)}
                      </td>
                      <td className="!px-[18px] !py-[18px] text-[#dc2626]">
                        {fmtNum(row.totals?.failed)}
                      </td>
                      <td className="!px-[18px] !py-[18px]">
                        {successRate(row.totals?.updated || 0, row.totals?.processed || 0)}
                      </td>
                      <td className="!px-[18px] !py-[18px] text-[#7a83a8]">
                        {row.backlog ? fmtNum(row.backlog.pending) : "—"}
                      </td>
                      <td className="!px-[18px] !py-[18px] whitespace-nowrap">
                        {formatTimestamp(row.totals?.last_updated)}
                      </td>
                    </tr>,

                    isOpen ? (
                      <tr key={`${row.network}-daily`} className="border-b border-gray-100">
                        <td colSpan="7" className="!p-0 bg-[#fbfbff]">
                          {daily.length > 0 ? (
                            <table className="min-w-full table-fixed">
                              <thead>
                                <tr className="text-center text-[13px] text-[#7a83a8] border-b border-gray-100">
                                  <th className="!px-[18px] !py-[10px] text-left font-[500]">
                                    Date
                                  </th>
                                  <th className="!px-[18px] !py-[10px] font-[500]">Processed</th>
                                  <th className="!px-[18px] !py-[10px] font-[500]">Updated</th>
                                  <th className="!px-[18px] !py-[10px] font-[500]">Failed</th>
                                  <th className="!px-[18px] !py-[10px] font-[500]">
                                    Last Updated (Timestamp)
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="text-[13px]">
                                {daily.map((d) => (
                                  <tr
                                    key={`${row.network}-${d.date}`}
                                    className="text-center border-b border-gray-50 last:border-0"
                                  >
                                    <td className="!px-[18px] !py-[10px] text-left">
                                      {formatDay(d.date)}
                                    </td>
                                    <td className="!px-[18px] !py-[10px]">
                                      {fmtNum(d.processed_count)}
                                    </td>
                                    <td className="!px-[18px] !py-[10px] text-[#16a34a]">
                                      {fmtNum(d.updated_count)}
                                    </td>
                                    <td className="!px-[18px] !py-[10px] text-[#dc2626]">
                                      {fmtNum(d.failed_count)}
                                    </td>
                                    <td className="!px-[18px] !py-[10px] whitespace-nowrap">
                                      {formatTimestamp(d.last_updated)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <div className="px-[24px] py-[18px] text-[13px] text-[#7a83a8]">
                              {row.error
                                ? `Could not read ${row.table || row.network}: ${row.error}`
                                : "No domains were processed for this platform in the selected range."}
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null,
                  ];
                })
              ) : (
                <tr>
                  <td colSpan="7" className="h-[280px] rounded-b-2xl bg-gray-50">
                    <div className="w-full h-full flex items-center justify-center text-[#7a83a8]">
                      No processing statistics found
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default DomainRegistrationStatsTable;
