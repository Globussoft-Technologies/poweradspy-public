import React, { useRef } from "react";
import { useEffect, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  createColumnHelper,
  getPaginationRowModel,
} from "@tanstack/react-table";
import DateRangePickerCustom from "./DateRangePickerCustom";
import { CiSearch } from "react-icons/ci";
import { postApiCallWithBody } from "./ApiResponse";
import Loader from "./Loader";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import PaginationOtherSearches from "../Pagination/PaginationOtherSearches";
import { useNavigate } from "react-router-dom";

const columnHelper = createColumnHelper();

const TYPE_LABELS = {
  project_click:          { label: "Project Click",          bg: "bg-blue-100",   text: "text-blue-700"   },
  competitor_comparison:  { label: "Competitor Comparison",  bg: "bg-pink-100",   text: "text-pink-700"   },
  dashboard:              { label: "Dashboard",              bg: "bg-green-100",  text: "text-green-700"  },
  other:                  { label: "Other",                  bg: "bg-gray-100",   text: "text-gray-700"   },
};

const ProjectSearches = () => {
  const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; });
  const [endDate, setEndDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; });
  const [projectsData, setProjectsData] = useState([]);
  const [totalCount, settotalCount] = useState();
  const [loading, setLoading] = useState(false);
  const [searchAfterHistory, setSearchAfterHistory] = useState([]);
  const [searchAfter, setSearchAfter] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const navigate = useNavigate();

  async function getProjectsData(overrideSearchAfter = searchAfter) {
    setLoading(true);
    const body = {
      user_id: localStorage.getItem("userId"),
      size: pageSize,
    };

    if (startDate) {
      const fromObj = new Date(startDate);
      const fy = fromObj.getFullYear();
      const fm = String(fromObj.getMonth() + 1).padStart(2, "0");
      const fd = String(fromObj.getDate()).padStart(2, "0");
      body.from_date = `${fy}-${fm}-${fd} 00:00:00`;
      const toObj = new Date(endDate || startDate);
      const ty = toObj.getFullYear();
      const tm = String(toObj.getMonth() + 1).padStart(2, "0");
      const td = String(toObj.getDate()).padStart(2, "0");
      body.to_date = `${ty}-${tm}-${td} 23:59:59`;
    }

    if (overrideSearchAfter) {
      body.search_after = overrideSearchAfter;
    }

    const apiUrl = `${import.meta.env.VITE_NODE_USER_ACTIVITY_API}get-projects`;
    let result = await postApiCallWithBody(apiUrl, body);

    if (result.code == 200) {
      if (result.search_after) {
        setSearchAfter(result.search_after);
        setSearchAfterHistory((prev) => [...prev, result.search_after]);
      }
      setProjectsData(result.data);
      settotalCount(result.totalCount);
    } else if (result.code == 401) {
      navigate("/");
      return;
    } else if (result.code == 404) {
      setProjectsData([]);
    }
    setLoading(false);
  }

  const isFirstRun = useRef(true);
  const prevDateRef = useRef(startDate);

  useEffect(() => {
    const dateChanged = prevDateRef.current !== startDate;
    prevDateRef.current = startDate;

    if (!isFirstRun.current && dateChanged) {
      setSearchAfter(null);
      setSearchAfterHistory([]);
      if (pageIndex !== 0) {
        setPageIndex(0);
      } else {
        getProjectsData(null);
      }
      return;
    }
    isFirstRun.current = false;
    getProjectsData();
  }, [pageIndex, pageSize, startDate]);

  const handleNextPage = () => {
    if (searchAfter && searchAfterHistory?.length > pageIndex) {
      setPageIndex((prev) => prev + 1);
      setSearchAfter(searchAfterHistory[pageIndex + 1] || searchAfter);
    }
  };

  const handlePrevPage = () => {
    if (pageIndex > 1) {
      setPageIndex((prev) => prev - 1);
      setSearchAfter(searchAfterHistory[pageIndex - 1] || null);
    } else if (pageIndex == 1) {
      setPageIndex(0);
      setSearchAfter(null);
      setSearchAfterHistory([]);
    }
  };

  const columns = [
    columnHelper.accessor("project_type", {
      id: "project_type",
      header: "Type",
      cell: (info) => {
        const type = info.getValue();
        const config = TYPE_LABELS[type] || TYPE_LABELS.other;
        return (
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
            {config.label}
          </span>
        );
      },
    }),
    columnHelper.accessor("project_name", {
      id: "project_name",
      header: "Project Name",
      cell: (info) => (
        <span className="text-[#343A40] capitalize">{info.getValue() || "—"}</span>
      ),
    }),
    columnHelper.accessor("competitors", {
      id: "competitors",
      header: "Competitors",
      cell: (info) => {
        const val = info.getValue();
        if (!val || val === "NA") return <span className="text-gray-400">—</span>;
        const list = Array.isArray(val) ? val : [val];
        return (
          <div className="flex flex-wrap gap-1 max-w-[220px]">
            {list.map((c, i) => (
              <span key={i} className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full capitalize">{c}</span>
            ))}
          </div>
        );
      },
    }),
    columnHelper.accessor("brand", {
      id: "brand",
      header: "Brand",
      cell: (info) => (
        <span className="text-[#343A40] capitalize">{info.getValue() || "—"}</span>
      ),
    }),
    columnHelper.accessor("advertiser", {
      id: "advertiser",
      header: "Advertiser",
      cell: (info) => (
        <span className="text-[#343A40] capitalize">{info.getValue() || "—"}</span>
      ),
    }),
    columnHelper.accessor("dashboard_Advertisers", {
      id: "dashboard_Advertisers",
      header: "Dashboard Advertisers",
      cell: (info) => {
        const val = info.getValue();
        if (!val || val === "NA") return <span className="text-gray-400">—</span>;
        const list = Array.isArray(val) ? val : [val];
        return (
          <div className="flex flex-wrap gap-1 max-w-[220px]">
            {list.map((a, i) => (
              <span key={i} className="bg-green-50 text-green-700 text-xs px-2 py-0.5 rounded-full capitalize">{a}</span>
            ))}
          </div>
        );
      },
    }),
    columnHelper.accessor("network", {
      id: "network",
      header: "Network",
      cell: (info) => (
        <span className="text-[#343A40]">{info.getValue() || "N/A"}</span>
      ),
    }),
    columnHelper.accessor("date", {
      id: "date",
      header: "Date",
      cell: (info) => (
        <span className="text-[#343A40] whitespace-nowrap">{info.getValue() || "N/A"}</span>
      ),
    }),
  ];

  const tableRef = useRef(null);
  const table = useReactTable({
    data: projectsData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: true,
  });

  return (
    <div className="bg-white rounded-[10px] w-full py-[18px]">
      <div className="pl-[30px] pr-[24px] flex justify-between items-center mb-4">
        <p className="text-[#1f296a] font-[600] text-[24px]">Project Searches</p>
        <div className="flex gap-[16px] items-center">
          <div className="flex items-center">
            <DateRangePickerCustom
              startDate={startDate}
              endDate={endDate}
              onChange={(start, end) => { setStartDate(start); setEndDate(end); }}
            />
          </div>
        </div>
      </div>

      <div className={`overflow-auto w-full pl-[30px] ${projectsData.length > 0 ? 'h-[365px]' : 'min-h-[200px]'}`} ref={tableRef}>
        <table className="min-w-full border-collapse">
          <thead className="bg-[#f9f9fb] rounded-[12px] sticky top-0">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="table_header_class !px-4 !py-3 h-[53px] font-[400] text-left text-[16px] text-[#343A40] cursor-pointer"
                  >
                    <span className="inline table_heading">
                      {header.isPlaceholder
                        ? null
                        : typeof header.column.columnDef.header === "function"
                        ? header.column.columnDef.header()
                        : header.column.columnDef.header}
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={table.getAllColumns().length}>
                  <Loader />
                </td>
              </tr>
            ) : table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row, index) => (
                <tr
                  key={row.id}
                  className={`h-12 border-b border-[#dddddd] hover:bg-table-row-hover-primary font-[400] text-[14px]
                    ${index % 2 === 0 ? "bg-[#fff] text-gray-700" : "bg-white"}`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="!px-5 !py-3 text-13 text-left font-normal text-[#343A40] h-[42px]"
                    >
                      {cell.column.columnDef.cell(cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={table.getAllColumns().length}
                  className="text-center"
                >
                  <div className="flex flex-col items-center justify-center gap-2 h-[160px]">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17H7A5 5 0 017 7h1m6 10h2a5 5 0 000-10h-1M9 12h6" />
                    </svg>
                    <p className="text-[15px] font-[500] text-[#9ca3af]">No data found</p>
                    <p className="text-[12px] text-[#c4c4c4]">Try adjusting the date filter</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pr-[48px]">
        <PaginationOtherSearches
          totalCount={totalCount}
          pageSize={pageSize}
          setPageSize={setPageSize}
          pageIndex={pageIndex}
          setPageIndex={setPageIndex}
          handleNextPage={handleNextPage}
          handlePrevPage={handlePrevPage}
        />
      </div>
      <ToastContainer />
    </div>
  );
};

export default ProjectSearches;
