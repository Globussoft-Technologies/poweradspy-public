import React, { use, useContext, useRef } from "react";
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
import { postApiCallWithBody, storeApiCall } from "./ApiResponse";
import axios from "axios";
import Loader from "./Loader";
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import PaginationOtherSearches from "../Pagination/PaginationOtherSearches";

const columnHelper = createColumnHelper();

const KeywordSearches = () => {
  const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; });
  const [endDate, setEndDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; });
  const [keywordsData, setKeywordsData] = useState([]);
  const [filterData ,setFilterData] =useState("");
  const [totalCount ,settotalCount] = useState();
  const [pageIndex, setPageIndex] = useState(0);
 const [pageSize, setPageSize] = useState(10); 
 const [loading, setLoading] = useState(false);
  const [searchAfterHistory, setSearchAfterHistory] = useState([]);
  const [searchAfter, setSearchAfter] = useState(null);

  const navigate = useNavigate();
  const handleUserDetails = async (rowData) => {
    const data = {type:0, keyword: rowData.search_keyword};
    const response = await storeApiCall(data);
   if(response.code==200){
    toast.success('Data stored/updated successfully!');
   }else if(response.code==401){
    navigate("/");
    return;
   }else if(response.code==400){
    toast.warning('Data alraedy exists!');
   }
    
  };

  async function getKeywordsData(overrideSearchAfter = searchAfter) {
    setLoading(true);
    const body = {
      user_id: localStorage.getItem("userId"),
      size: pageSize,
    };

    if (debouncedFilter.trim()) {
      body.search_term = debouncedFilter;
    }
    if (startDate) {
      const fromObj = new Date(startDate);
      const fy = fromObj.getFullYear();
      const fm = String(fromObj.getMonth() + 1).padStart(2, '0');
      const fd = String(fromObj.getDate()).padStart(2, '0');
      body.from_date = `${fy}-${fm}-${fd} 00:00:00`;
      const toObj = new Date(endDate || startDate);
      const ty = toObj.getFullYear();
      const tm = String(toObj.getMonth() + 1).padStart(2, '0');
      const td = String(toObj.getDate()).padStart(2, '0');
      body.to_date = `${ty}-${tm}-${td} 23:59:59`;
    }
    if (overrideSearchAfter) {
      body.search_after = overrideSearchAfter;
    }

    const apiUrl = `${import.meta.env.VITE_NODE_USER_ACTIVITY_API}get-keywords`;
    let result = await postApiCallWithBody(apiUrl, body);
  
    if (result.code == 200) {
      if (result.search_after) {
        setSearchAfter(result.search_after);
        setSearchAfterHistory((prev) => [...prev, result.search_after]);
      }
      setKeywordsData(result.data);
      settotalCount(result.totalCount);
    } else if (result.code == 401) {
      navigate("/");
      return;
    } else if(result.code ==404){
      setKeywordsData([]);
    }
    setLoading(false);
  }
  
  function useDebounce(value, delay = 500) {
    const [debouncedValue, setDebouncedValue] = useState(value);
  
    useEffect(() => {
      const timeout = setTimeout(() => {
        setDebouncedValue(value);
      }, delay);
  
      return () => clearTimeout(timeout);
    }, [value, delay]);
  
    return debouncedValue;
  }
const keywordSearchTableref = useRef(null);
  const debouncedFilter = useDebounce(filterData || "", 500);

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
        getKeywordsData(null);
      }
      return;
    }
    isFirstRun.current = false;
    getKeywordsData();
  }, [pageIndex, pageSize, debouncedFilter, startDate]);
  
  const handleNextPage = () => {
    if (searchAfter && searchAfterHistory.length > pageIndex) {
      setPageIndex((prev) => prev + 1);
      setSearchAfter(searchAfterHistory[pageIndex + 1] || searchAfter);
    }
  };
  
  function safeEncode(str) {
    return encodeURIComponent(str)
    .replace(/'/g, '%27')
    .replace(/"/g, '%22');
    }
  const handlePrevPage = () => {
    if (pageIndex > 1) {
      setPageIndex((prev) => prev - 1);
      setSearchAfter(searchAfterHistory[pageIndex - 1] || null);
    }else if(pageIndex ==1){
      setPageIndex((prev) => prev - 1);
      setSearchAfter(null);
      setSearchAfterHistory([]);
    }
  };

  const columns = [
    columnHelper.accessor("search_keyword", {
      id: "search_keyword",
      header: "Keywords",
      cell: (info) => {
        const rowIndex = info.row.index;
        const user = info.getValue();
        return (
          <div className="flex items-center space-x-2">
            <span className="text-[#343A40]  capitalize">
              {user || "N/A"}
            </span>
          </div>
        );
      },
    }),
    columnHelper.accessor("search_keyword", {
      id: "otherSearches",
      header: "otherSearches",
      cell: ({ row }) => {
        const data = row.original;
        const entries = [];

        for (const key in data) {
          if (key === "search_keyword") continue;

          if (
            key.startsWith("filter.") ||
            key.startsWith("search.") ||
            key.startsWith("search_by.") ||
            key.startsWith("lander.") || key =="dashboard.likes" || 
            key =="dashboard.comments"||key =="dashboard.shares" || 
            key =="dashboard.post_date" || key =="dashboard.ad_seen" || 
            key =="domain_date_btn_sort"
          ) {
            const label = key.split(".").pop();
            const value = Array.isArray(data[key]) ? data[key].join(", ") : data[key];
            if (value) {
              entries.push(`${label}: ${value}`);
            }
          }
        }

        const firstTwo = entries.slice(0, 2);
        const rest = entries.slice(2);

        return (
          <div className="text-[#343A40]  text-sm h-full overflow-y-auto mr-4">
            {/* Show first 2 normally */}
            {firstTwo.map((e, i) => (
              <div key={i}>{e}</div>
            ))}

            {/* Scrollable container for rest */}
            {rest.length > 0 && (
              <div
                className=" mt-1  "
                style={{
                  maxHeight: '3.5rem',
                  paddingRight: '0.25rem',
                }}
              >
                {rest.map((e, i) => (
                  <div key={i + 2} className="block ">{e}</div>
                ))}
              </div>
            )}
          </div>
        );
      },
    }),
    columnHelper.accessor("adsCount", {
      id: "adsCount",
      header: "No. of Ads in DB",
      cell: (info) => (
        <span className="text-[#343A40]  ">
          {info.getValue() || 0}
        </span>
      ),
    }),
    columnHelper.accessor("network", {
      id: "network",
      header: "Network",
      cell: (info) => (
        <span className="text-[#343A40]  ">
          {info.getValue() || "N/A"}
        </span>
      ),
    }),
     columnHelper.accessor("adsCountOnSerach", {
      id: "adsCountOnSerach",
      header: "Searched Ad Count",
      cell: (info) => (
        <span className="text-[#343A40]  ">
          {info.getValue() || 0}
        </span>
      ),
    }),
   columnHelper.accessor("action", {
    id: "action",
    header: "Action",
    cell: ({ row }) => {
      const network = row.original.network?.toLowerCase();
      const allowedNetworks = ["facebook", "instagram", "native", "google"];

      if (allowedNetworks.includes(network)) {
        return (
          <button
            className="!bg-[#Eaf0fe] !text-[#1f296a] px-3 py-1 rounded-md text-sm"
            onClick={() => handleUserDetails(row.original)}
          >
            Fetch Ad
          </button>
        );
      }

      return null; 
    },
  }),
    columnHelper.accessor("link", {
    id: "link",
    header: "URL",
    cell: ({ row }) => {
      const keyword = row.original.search_keyword || "unknown";
      const network = row.original.network || "default";
      const baseUrl = import.meta.env.VITE_APP_BASE_URL;

      const url = `${baseUrl}/${network.toLowerCase()}/landing/key/${safeEncode(keyword)}`;

      const copyToClipboard = async () => {
        try {
          await navigator.clipboard.writeText(url);
          toast.success("Link copied!");
        } catch (err) {
          toast.error("Failed to copy link");
        }
      };

        return (
          <img
            onClick={copyToClipboard}
            src="/copy.png"
            alt="Copy Link"
            title="Copy url"
            className="w-5 h-5 cursor-pointer"
          />
        );
    },
  }),
  ];

  const table = useReactTable({
    data: keywordsData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // pageCount: Math.ceil(totalCount / pageSize), // Define page count
    manualPagination: true, // Enable manual pagination
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
  const { searchdataFilterTable,
    setsearchdataFilterTable}  = useContext(AdminContext)

  useEffect(() => {
    if(searchdataFilterTable === 1 || searchdataFilterTable === 2) {
   
       const el = keywordSearchTableref.current;
  if (!el) return;

  const preventScroll = (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.scrollTop = 0; // force scroll to top (or any fixed position)
  };

  // Block scrolling via mouse wheel
  el.addEventListener("wheel", preventScroll, { passive: false });
  
  // Block scrolling via touch
  el.addEventListener("touchmove", preventScroll, { passive: false });

  return () => {
    el.removeEventListener("wheel", preventScroll);
    el.removeEventListener("touchmove", preventScroll);
  };

    }
 
}, [searchdataFilterTable]);




  return (
    <div className={`bg-white rounded-[10px] w-full py-[18px] ${searchdataFilterTable === 3 || searchdataFilterTable === 0 ? 'opacity-[100%]' : 'opacity-50' }`}>
      <div className="pl-[30px] pr-[24px] flex justify-between items-center mb-4">
        <p className="text-[#1f296a] font-[600] text-[24px] ">
          Keyword Searches
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
                startDate={startDate}
                endDate={endDate}
                onChange={(start, end) => { setStartDate(start); setEndDate(end); }}
              />
            </div>
        </div>
      </div>
      <div className={`overflow-auto w-full pl-[30px] ${keywordsData.length > 0 ? 'h-[365px]' : 'min-h-[200px]'}`} ref={keywordSearchTableref}>
        <table className="min-w-full border-collapse ">
          <thead className="bg-[#f9f9fb]  rounded-[12px] sticky top-0">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className={`table_header_class !px-4 !py-3 h-[53px] font-[400]  text-left text-13 !text-[16px] text-[#343A40]  hover:text-gray-500  transition-all duration-100 ease-in cursor-pointer`}
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
                    <Loader/>
                  </td>
                </tr>
              ) : 
            table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row, index) => {
                const adsCount = row.original.adsCount;
                return (
                  <tr
                    key={row.id}
                    data-disabled={searchdataFilterTable === 3 || searchdataFilterTable === 0 ? "false":"true"}
                    className={`h-12 border-b border-border_primary border-[#dddddd] font-[400] text-[14px] hover:bg-table-row-hover-primary  
                      ${adsCount === 0 ? 'bg-red-500 text-white' : 
                        index % 2 === 0
                        ? 'bg-[#fff] text-gray-700 '
                        : 'bg-white'
                      } ${searchdataFilterTable === 3 || searchdataFilterTable === 0 ? '' : 'pointer-events-none opacity-50'}`}
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
                );
              })
            ) : (
              <tr>
                <td colSpan={table.getAllColumns().length} className="text-center">
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

export default KeywordSearches;
