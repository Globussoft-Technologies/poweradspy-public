import React, { useContext, useRef } from "react";
import { useEffect, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  createColumnHelper,
  getPaginationRowModel,
} from "@tanstack/react-table";
import DateRangePickerCustom from "./DateRangePickerCustom";
import { CiSearch } from "react-icons/ci";
import AdminContext from "../../Context/Context";
import { postApiCall } from "./ApiResponse";
import Loader from "./Loader";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import PaginationOtherSearches from "../Pagination/PaginationOtherSearches";
import { useNavigate } from "react-router-dom";

const columnHelper = createColumnHelper();

const CompetitorSearches = () => {
  const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; });
  const [endDate, setEndDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; });
  const [competitorsData, setCompetitorsData] = useState([]);
  const [filterData, setFilterData] = useState("");
  const [totalCount, settotalCount] = useState();
  const [loading, setLoading] = useState(false);
  const [searchAfterHistory, setSearchAfterHistory] = useState([]);
  const [searchAfter, setSearchAfter] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const navigate = useNavigate();
  const { searchdataFilterTable } = useContext(AdminContext);

  function useDebounce(value, delay = 500) {
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(() => {
      const timeout = setTimeout(() => setDebouncedValue(value), delay);
      return () => clearTimeout(timeout);
    }, [value, delay]);
    return debouncedValue;
  }

  const debouncedFilter = useDebounce(filterData || "", 500);

  async function getCompetitorsData(overrideSearchAfter = searchAfter) {
    setLoading(true);
    let requestData = {
      user_id: localStorage.getItem("userId"),
    };

    if (debouncedFilter.trim()) {
      requestData.search_term = debouncedFilter;
    }

    if (startDate) {
      const fromObj = new Date(startDate);
      const fy = fromObj.getFullYear();
      const fm = String(fromObj.getMonth() + 1).padStart(2, "0");
      const fd = String(fromObj.getDate()).padStart(2, "0");
      requestData.from_date = `${fy}-${fm}-${fd} 00:00:00`;
      const toObj = new Date(endDate || startDate);
      const ty = toObj.getFullYear();
      const tm = String(toObj.getMonth() + 1).padStart(2, "0");
      const td = String(toObj.getDate()).padStart(2, "0");
      requestData.to_date = `${ty}-${tm}-${td} 23:59:59`;
    }

    if (overrideSearchAfter) {
      requestData.search_after = overrideSearchAfter;
    }

    const apiUrl = `${import.meta.env.VITE_SEARCHES_API}get-competitors?size=${pageSize}`;
    let result = await postApiCall(apiUrl, requestData);

    if (result.code == 200) {
      if (result.search_after) {
        setSearchAfter(result.search_after);
        setSearchAfterHistory((prev) => [...prev, result.search_after]);
      }
      setCompetitorsData(result.data);
      settotalCount(result.totalCount);
    } else if (result.code == 401) {
      navigate("/");
      return;
    } else if (result.code == 404) {
      setCompetitorsData([]);
    }
    setLoading(false);
  }

  const isFirstRun = useRef(true);
  const prevFilterRef = useRef(debouncedFilter);
  const prevDateRef = useRef(startDate);

  useEffect(() => {
    const filterChanged = prevFilterRef.current !== debouncedFilter;
    const dateChanged = prevDateRef.current !== startDate;
    prevFilterRef.current = debouncedFilter;
    prevDateRef.current = startDate;

    if (!isFirstRun.current && (filterChanged || dateChanged)) {
      setSearchAfter(null);
      setSearchAfterHistory([]);
      if (pageIndex !== 0) {
        setPageIndex(0);
      } else {
        getCompetitorsData(null);
      }
      return;
    }
    isFirstRun.current = false;
    getCompetitorsData();
  }, [pageIndex, pageSize, debouncedFilter, startDate]);

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
      setPageIndex((prev) => prev - 1);
      setSearchAfter(null);
      setSearchAfterHistory([]);
    }
  };

  const columns = [
    columnHelper.accessor("competitors", {
      id: "competitors",
      header: "Competitors",
      cell: (info) => {
        const value = info.getValue();
        const display = Array.isArray(value) ? value.join(", ") : value;
        return (
          <div className="flex items-center space-x-2">
            <span className="text-[#343A40] capitalize">{display || "N/A"}</span>
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
      cell: (info) => {
        const val = info.getValue();
        const dateOnly = val ? val.split(" ")[0] : "N/A";
        return <span className="text-[#343A40]">{dateOnly}</span>;
      },
    }),
  ];

  const tableRef = useRef(null);

  const table = useReactTable({
    data: competitorsData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: true,
  });

  return (
    <div className="bg-white rounded-[10px] w-full py-[18px]">
      <div className="pl-[30px] pr-[24px] flex justify-between items-center mb-4">
        <p className="text-[#1f296a] font-[600] text-[24px]">Competitor Searches</p>
        <div className="flex gap-[16px] items-center">
          <div className="w-[20vw] relative h-[42px]">
            <CiSearch className="lucide lucide-search h-[20px] w-[20px] text-[#575757] absolute left-3 top-2" />
            <input
              type="text"
              onChange={(e) => setFilterData(e.target.value)}
              className="flex px-3 py-2 text-base border border-[#dee2e6] bg-[#ffffff] pl-9 h-10 focus:outline-none w-full rounded-lg"
            />
          </div>
          <div className="flex items-center">
            <DateRangePickerCustom
              startDate={startDate}
              endDate={endDate}
              onChange={(start, end) => { setStartDate(start); setEndDate(end); }}
            />
          </div>
        </div>
      </div>

      <div className="overflow-auto w-full pl-[30px] h-[365px]" ref={tableRef}>
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
                  className="px-4 py-2.5 text-sm text-center font-normal text-[#A0A0A0]"
                >
                  No data available
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

export default CompetitorSearches;
