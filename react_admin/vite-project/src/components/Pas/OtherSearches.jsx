import React, { useContext, useRef } from "react";
import { useEffect, useState } from "react";
import { FaArrowUp, FaArrowDown } from "react-icons/fa";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useNavigate } from "react-router-dom";
import {
  useReactTable,
  getCoreRowModel,
  createColumnHelper,
  getPaginationRowModel,
} from "@tanstack/react-table";
import DateRangePickerCustom from "./DateRangePickerCustom";
import { CiSearch } from "react-icons/ci";
import Pagination from "../Pagination/Pagination";
import AdminContext from "../../Context/Context";

import PaginationOtherSearches from "../Pagination/PaginationOtherSearches";
import Loader from "./Loader";
import { postApiCallWithBody } from "./ApiResponse";
const columnHelper = createColumnHelper();


const OtherSearches = () => {
  const [fromDate, setFromDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; });
  const [toDate, setToDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; });

  const navigate = useNavigate();
  const [teamsData, setTeamsData] =useState([]);
  const [filterData ,setFilterData] =useState("");
  const [totalCount ,settotalCount] = useState();
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10); 
  const [loading, setLoading] = useState(false);

  // cursors[i] = search_after cursor needed to fetch page i (null for page 0)
  const cursorsRef = useRef([null]);

  const totalPages = Math.ceil((totalCount || 0) / pageSize) || 1;

  const fetchPage = async (index, pageSizeVal, fromDateVal, toDateVal) => {
    setLoading(true);
    const body = {
      user_id: localStorage.getItem("userId"),
      size: pageSizeVal,
    };
    const cursor = cursorsRef.current[index] ?? null;
    if (cursor) {
      body.search_after = cursor;
    }
    if (fromDateVal) {
      const fromObj = new Date(fromDateVal);
      const fy = fromObj.getFullYear();
      const fm = String(fromObj.getMonth() + 1).padStart(2, '0');
      const fd = String(fromObj.getDate()).padStart(2, '0');
      body.from_date = `${fy}-${fm}-${fd} 00:00:00`;
      const toObj = new Date(toDateVal || fromDateVal);
      const ty = toObj.getFullYear();
      const tm = String(toObj.getMonth() + 1).padStart(2, '0');
      const td = String(toObj.getDate()).padStart(2, '0');
      body.to_date = `${ty}-${tm}-${td} 23:59:59`;
    }

    const apiUrl = `${import.meta.env.VITE_NODE_USER_ACTIVITY_API}get-all-searches`;
    const response = await postApiCallWithBody(apiUrl, body);

    if (response.code === 200) {
      if (response.search_after) {
        cursorsRef.current[index + 1] = response.search_after;
      }
      const transformedData = [];
      response.data.forEach((item) => {
        let keyword = null;
        let advertiser = null;
        let domain = null;
        let combinedSearchTypes = [];
        let combinedSearchedValues = [];

        Object.entries(item).forEach(([key, value]) => {
          if (key !== "network" && key !== "adsCount" && key !== "date" && key !== "adsCountOnSerach" && key !== "search.keyword" && key !== "search.advertiser" && key !== "search.domain" && key !== "filterType" && key !== "_id") {
            const searchType = key;
            if (value == "newest_sort") value = null;
            const displayValue = (value === null || value === "null" || value === "") ? "-" : Array.isArray(value) ? value.join(", ") : String(value);
            combinedSearchTypes.push(searchType);
            combinedSearchedValues.push(displayValue);
          }
          if (key === "search.keyword") {
            keyword = value;
          } else if (key === "search.advertiser") {
            advertiser = value;
          } else if (key === "search.domain") {
            domain = value;
          }
        });
        const date = item.date || "N/A";
        let adsCount = item.adsCount;
        if (combinedSearchTypes.length > 0 && combinedSearchTypes.includes("show_analytics.ad_id")) {
          adsCount = 1;
        }
        if (combinedSearchTypes.length > 0) {
          transformedData.push({
            keyword,
            advertiser,
            domain,
            searchType: combinedSearchTypes.join(", "),
            searchedValue: combinedSearchedValues.join(", "),
            network: item.network || "N/A",
            adsCount: adsCount,
            adsCountOnSerach: item.adsCountOnSerach,
            date: date,
          });
        }
      });
      setTeamsData(transformedData);
      settotalCount(response.totalCount);
    } else if (response.code === 404) {
      setTeamsData([]);
    } else if (response.code === 401) {
      navigate("/");
      return;
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchPage(pageIndex, pageSize, fromDate, toDate);
  }, [pageIndex, pageSize, fromDate, toDate]);

  const handleNextPage = () => {
    if (pageIndex < totalPages - 1) {
      setPageIndex((prev) => prev + 1);
    }
  };

  const handlePrevPage = () => {
    if (pageIndex > 0) {
      setPageIndex((prev) => prev - 1);
    }
  };

  

  
  // const filteredData = teamsData?.filter((dat) => {
    
  //   const rowDate = new Date(dat.date);
  
  //   if (startDate) {
  //     const startOfDay = new Date(startDate);
  //     startOfDay.setHours(0, 0, 0, 0); // Setting to 00:00:00

  //     const endOfDay = new Date(startDate);
  //     endOfDay.setHours(23, 59, 59, 999); // Setting to 23:59:59
      
  //     const dateMatches = rowDate >= startOfDay && rowDate <= endOfDay;
  
  //     return (
  //       (dat.searchType.toLowerCase().includes(filterData.toLowerCase()) || dat.searchedValue.toLowerCase().includes(filterData.toLowerCase()) ||
  //         dat.network.toLowerCase().includes(filterData.toLowerCase())) &&
  //       dateMatches
  //     );
  //   }
  
  //   return (
  //     dat.searchType.toLowerCase().includes(filterData.toLowerCase()) || dat.searchedValue.toLowerCase().includes(filterData.toLowerCase()) ||
  //     dat.network.toLowerCase().includes(filterData.toLowerCase())
  //   );
  // });
  const columns = [
    columnHelper.accessor("searchType", {
      id: "searchType",
      header: "Search Type",
      cell: (info) => {
        const rowIndex = info.row.index;
        const user = info.getValue();
        return (
          <div className="flex items-center space-x-2 break-words">
            <span className="text-[#343A40]  capitalize">
              {user || "N/A"}
            </span>
          </div>
        );
      },
    }),
    columnHelper.accessor("searchedValue", {
      id: "searchedValue",
      header: "Searched Value",
      cell: (info) => (
        <span className="text-[#343A40]   break-words">
          {info.getValue() || "-"}
        </span>
      ),
    }),
      columnHelper.accessor("searchedValue", {
      id: "keyAdvDomain",
      header: "Key/Adv/Domain",
      cell: ({ row }) => {
        const data = row.original;

        let type = null;
        let value = null;
        let badge = null;

        if (data["keyword"]) {
          type = "keyword";
          value = data["keyword"];
          badge = "K";
        } else if (data["advertiser"]) {
          type = "advertiser";
          value = data["advertiser"];
          badge = "A";
        } else if (data["domain"]) {
          type = "domain";
          value = data["domain"];
          badge = "D";
        }

        const badgeColor = {
          keyword: "bg-blue-500",
          advertiser: "bg-green-500",
          domain: "bg-purple-500",
        }[type] || "bg-gray-400";

        return (
          <div className="flex items-center gap-2 text-[#343A40]    w-full">
            {badge && (
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-semibold ${badgeColor}`}
                title={type}
              >
                {badge}
              </span>
            )}
          <span className="break-all w-[calc(100%_-_32px)]">{value || "-"}</span>
          </div>
        );
      },
    }),

    columnHelper.accessor("network", {
      id: "network",
      header: "Network",
      cell: (info) => (
        <span className="text-[#343A40]   break-words">
          {info.getValue() || "N/A"}
        </span>
      ),
    }),
    columnHelper.accessor("adsCount", {
      id: "adsCount",
      header: "No. of Ads in DB",
      cell: (info) => (
        <span className="text-[#343A40]   break-words">
          {info.getValue() || 0} 
        </span>
      )
    }),
    columnHelper.accessor("adsCountOnSerach", {
      id: "adsCountOnSerach",
      header: "Searched Ad Count",
      cell: (info) => (
        <span className="text-[#343A40]   break-words">
          {info.getValue() || 0}
        </span>
    ),
    }),
  ];

  const table = useReactTable({
    data: teamsData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // pageCount: Math.ceil(totalCount / pageSize), // Define page count
    manualPagination: true, // Enable manual pagination
    // state: {
    //   pagination: {
    //     pageIndex,
    //     pageSize,
    //   },
    // },
    // onPaginationChange: ({ pageIndex, pageSize }) => {
    //   setPageIndex(pageIndex);
    //   setPageSize(pageSize);
    // },
  });

  const tableLabelsColors = [
    { bg: "#E57373", color: "#FFFFFF" }, // Red
    { bg: "#81C784", color: "#FFFFFF" }, // Green
    { bg: "#64B5F6", color: "#FFFFFF" }, // Blue
    { bg: "#FFD54F", color: "#000000" }, // Yellow
    { bg: "#BA68C8", color: "#FFFFFF" }, // Purple
  ];
 
  //  const [pageIndex, setPageIndex] = useState(1);
  //   const [pageSize, setPageSize] = useState(10); 
    // const { searchdataFilterTable,
    //   setsearchdataFilterTable}  = useContext(AdminContext)
  return (
  <div className="bg-white rounded-[10px] w-full py-[18px] ">    
    <div className="pl-[30px] pr-[24px] flex justify-between items-center mb-4">
        <p className="text-[#1f296a] font-[600] text-[24px] ">
          Other Searches
        </p>
        <div className="flex gap-[16px] items-center">
   
          <div className="w-[20vw] relative h-[42px]">
            <CiSearch className="lucide lucide-search h-[20px] w-[20px] text-[#575757] absolute left-3 top-2" />
            <input
              type="text" onChange={(e)=>{setFilterData(e.target.value)}}
              className="flex px-3 py-2  text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus:outline-[#157496] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm border border-[#dee2e6] bg-[#ffffff] pl-9 h-10 focus:outline-none w-full rounded-lg"
            />
          </div>
       <div className="flex items-center">
                   <DateRangePickerCustom
                     startDate={fromDate}
                     endDate={toDate}
                     onChange={(start, end) => { cursorsRef.current = [null]; setPageIndex(0); setFromDate(start); setToDate(end); }}
                   />
                 </div>
        </div>
      </div>
      <div className={`overflow-auto w-full pl-[30px] ${teamsData.length > 0 ? 'h-[365px]' : 'min-h-[200px]'}`}>
        <table className="min-w-full border-collapse ">
          <thead className="bg-[#f9f9fb] rounded-[12px] sticky top-0">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className={`table_header_class !px-4 !py-3 h-[53px]  text-left text-13 font-medium text-[#343A40]  hover:text-gray-500  transition-all duration-100 ease-in cursor-pointer`}
                  >
                    <span className="inline table_heading">
                      {header.isPlaceholder
                        ? null
                        : typeof header.column.columnDef.header === "function"
                        ? header.column.columnDef.header()
                        : header.column.columnDef.header}
                    </span>
                    {/* {header.id !== "action" &&
                       header.id !== "userDetails.userName" && (
                         <span onClick={() => handleSort(header.id)}>
                        
                            
                      
                         </span>
                       )} */}
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
              ) : 
            table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row, index) => (
                <tr
                  key={row.id}
                  className={`h-12 border-b border-border_primary border-[#dddddd] hover:bg-table-row-hover-primary  
                                   ${
                                     index % 2 === 0
                                       ? "bg-[#fff] text-gray-700 "
                                       : "bg-white"
                                   }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="!px-5 !py-3 text-13 text-left font-normal text-[#343A40] max-w-[20vw] "
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
      {/* <Pagination
        totalCount={totalCount}
  pageSize={10}
  setPageSize={setPageSize}
  pageIndex={pageIndex}
  setPageIndex={setPageIndex}/> */}
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
    </div>
  );
};

export default OtherSearches;
