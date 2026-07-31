import { useState } from "react";
import { GoTriangleDown, GoTriangleUp } from "react-icons/go";

import fb from "../../assets/Social/fb.png";
import Instagram from "../../assets/Social/Instagram.png";

const PLATFORM_ICONS = { facebook: fb, instagram: Instagram };

const fmtNum = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US"));

// The API sends 'YYYY-MM-DD' / 'YYYY-MM-DD HH:mm:ss' strings; split by hand rather than going
// through `new Date()` so the displayed day can never drift by a timezone.
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

const HEAD_CELL =
  "!px-[18px] !py-[18px] text-[15px] font-[400] bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent";

const AiMetaStatsTable = ({ networks, loading }) => {
  // Per-day breakdown is collapsed by default; a platform is drilled into on demand.
  const [expanded, setExpanded] = useState({});
  const toggle = (network) => setExpanded((prev) => ({ ...prev, [network]: !prev[network] }));

  const rows = networks || [];

  return (
    <div className="w-full flex flex-col">
      <div className="w-full rounded-xl border border-[#e8e8e8] bg-white shadow-sm mt-[24px]">
        <div className="pt-[17px] pb-[19px] pl-[24px] pr-[14px]">
          <p className="text-[17px] font-[600] text-[#1E1B39]">
            Platform Wise AI-Meta Processing
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
                <th className={HEAD_CELL}>Updated Count</th>
                <th className={HEAD_CELL}>Last Updated</th>
              </tr>
            </thead>
            <tbody className="text-[14px] font-[400] text-[#1F1F1F]">
              {loading ? (
                Array.from({ length: 2 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    {Array.from({ length: 3 }).map((__, j) => (
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
                            <img src={PLATFORM_ICONS[row.network]} alt="" className="w-[20px] h-[20px]" />
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
                        {fmtNum(row.totals?.updated)}
                      </td>
                      <td className="!px-[18px] !py-[18px] whitespace-nowrap">
                        {formatTimestamp(row.totals?.last_updated)}
                      </td>
                    </tr>,

                    isOpen ? (
                      <tr key={`${row.network}-daily`} className="border-b border-gray-100">
                        <td colSpan="3" className="!p-0 bg-[#fbfbff]">
                          {daily.length > 0 ? (
                            <table className="min-w-full table-fixed">
                              <thead>
                                <tr className="text-center text-[13px] text-[#7a83a8] border-b border-gray-100">
                                  <th className="!px-[18px] !py-[10px] text-left font-[500]">Date</th>
                                  <th className="!px-[18px] !py-[10px] font-[500]">Updated Count</th>
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
                                    <td className="!px-[18px] !py-[10px] text-left">{formatDay(d.date)}</td>
                                    <td className="!px-[18px] !py-[10px]">{fmtNum(d.updated_count)}</td>
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
                                : "No ads were processed for this platform in the selected range."}
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null,
                  ];
                })
              ) : (
                <tr>
                  <td colSpan="3" className="h-[280px] rounded-b-2xl bg-gray-50">
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

export default AiMetaStatsTable;
