import React, { use, useContext, useRef } from "react";
import { useEffect, useState } from "react";
import { FaArrowUp, FaArrowDown } from "react-icons/fa";
import { FaSortUp, FaSortDown } from "react-icons/fa";
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
import DatePicker from "react-datepicker";
import CompetitiveDetailsDatePicker from "../CompetitiveDetailsDatePicker";

import "react-datepicker/dist/react-datepicker.css";
import { CiFilter, CiSearch } from "react-icons/ci";
import Pagination from "../Pagination/Pagination";
import AdminContext from "../../Context/Context";
import { postApiCall, storeApiCall } from "./ApiResponse";
import axios from "axios";
import Loader from "./Loader";
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import PaginationCompetitor from "../Pagination/PaginationCompetitor";

const columnHelper = createColumnHelper();

const loadSelectedDates = () => {
  try {
    const savedDates = sessionStorage.getItem("dateRange");
    if (savedDates) {
      const parsedDates = JSON.parse(savedDates);
      return {
        startDate: new Date(parsedDates.startDate),
        endDate: new Date(parsedDates.endDate),
      };
    }
  } catch (error) {
    console.error("Failed to parse saved dates", error);
  }
  return {
    startDate: new Date(),
    endDate: new Date(),
  };
};

const CompetitorDetails = ({setKeywordStatis}) => {
  const [startDate, setStartDate] = useState(null);
//   const [keywordsData, setKeywordsData] = useState([]);
  const [competitorsData, setCompetitorsData] = useState([]);
  const [selectedSystem, setSelectedSystem] = useState(null);
  const [showFilterModal, setShowFilterModal] = useState(false);

  const [filterData ,setFilterData] =useState("");
  const [totalCount ,settotalCount] = useState();
  const [pageIndex, setPageIndex] = useState(0);
 const [pageSize, setPageSize] = useState(5); 
 const [loading, setLoading] = useState(false);
  const [searchAfterHistory, setSearchAfterHistory] = useState([]);
  const [searchAfter, setSearchAfter] = useState(null);
  const [originalData, setOriginalData] = useState([]);
  const [activeTab, setActiveTab] = useState("active");
const [dateRange1, setDateRange1] = useState({startDate:null,endDate:null});
  const [compUsersCount, setCompUsersCount] = useState(0);
  const navigate = useNavigate();
const handleDateChange1 = (startDate, endDate) => {
    setDateRange1({ startDate, endDate });
  };
async function getCompetitorsData() {
  setLoading(true);
  const isNumeric = /^\d+$/.test(filterData.trim());
  const filterKey = isNumeric ? "user_id" : "userName";
  const filterValue = filterData.trim();

  let endpoint = activeTab === "inactive" ? "get-inactive-details" : "get-active-details";
  let apiUrl = `${import.meta.env.VITE_COMPETITORS_API}${endpoint}?page=${pageIndex + 1}&limit=${pageSize}`;

  if (filterValue) {
    apiUrl += `&${filterKey}=${encodeURIComponent(filterValue)}`;
  }

   if (dateRange1.startDate && dateRange1.endDate) {
    const dateF = dateRange1.startDate;
    const dateT = dateRange1.endDate;
    const from = `${dateF.getFullYear()}-${String(dateF.getMonth()+1).padStart(2, '0')}-${String(dateF.getDate()).padStart(2, '0')}`;
    const to = `${dateT.getFullYear()}-${String(dateT.getMonth()+1).padStart(2, '0')}-${String(dateT.getDate()).padStart(2, '0')}`;
    apiUrl += `&from=${from}&to=${to}`;
  }

  try {
    const result = await axios.get(apiUrl);
    handleCompetitorResponse(result);
  } catch (err) {
    toast.error("Failed to fetch competitor data");
  } finally {
    setLoading(false);
  }
}

const handleCompetitorResponse = (result) => {
  if (result.data.statusCode === 200) {
    const rawData = result.data.body.data.data;
    setOriginalData(rawData);
    setCompetitorsData(rawData);
    settotalCount(result.data.body.data.totalCount);

    enrichWithAdCounts(rawData).then((enrichedData) => {
      setOriginalData(enrichedData);
      setCompetitorsData(enrichedData);
    });
  } else {
    setCompetitorsData([]);
  }
};
  
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

  const debouncedFilter = useDebounce(filterData || "", 500);
    useEffect(() => {
          getCompetitorsData();
    }, [pageIndex, pageSize,debouncedFilter,activeTab,dateRange1]);

    useEffect(() => {
      setPageIndex(0);
    }, [debouncedFilter,activeTab]);


  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return; 
    }
    // getCompetitorsData();
  }, [debouncedFilter, startDate]);
  
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

  const enrichWithAdCounts = async (rawData) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const seen_btn_sort = [
    Math.floor(todayStart.getTime() / 1000),
    Math.floor(todayEnd.getTime() / 1000),
  ];

  return await Promise.all(
    rawData.map(async (row) => {
      const competitorNames = row.competitors?.map(c => c.competitor_name) || [];

      if (competitorNames.length === 0) return { ...row, fbMap: {}, igMap: {} };
      let fbapi =import.meta.env.VITE_FACEBOOK_API;
      let instaapi =import.meta.env.VITE_INSTAGRAM_API;
      const [facebookRes, instagramRes] = await Promise.all([
        fetch(fbapi+"count-competitor-adminPanel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            advertiser: competitorNames,
            seen_btn_sort,
          }),
        }).then(res => res.json()),

        fetch(instaapi+"count-competitor-adminPanel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            advertiser: competitorNames,
            seen_btn_sort,
          }),
        }).then(res => res.json()),
      ]);

      const toMap = (arr) => {
        const map = {};
        arr.forEach(({ owner, todays_count, competitor_count }) => {
          map[owner.toLowerCase()] = {
            today: todays_count,
            total: competitor_count,
          };
        });
        return map;
      };

      return {
        ...row,
        fbMap: toMap(facebookRes),
        igMap: toMap(instagramRes),
      };
    })
  );
};


  const columns = [
    columnHelper.accessor("search_keyword", {
    id: "search_keyword",
    header: "ID",
    cell: (info) => {
        const serialNumber = pageIndex * pageSize + info.row.index + 1;
        return (
        <div className="flex items-center space-x-2">
            <span className="text-[#343A40] ">
            {serialNumber}
            </span>
        </div>
        );
    },
    }),

    columnHelper.accessor("user_id", {
      id: "otherSearches",
      header: "UserId",
        cell: (info) => (
        <span className="text-[#343A40]  whitespace-nowrap">
          {info.getValue() || 0}
        </span>
      ),
    }),
    columnHelper.accessor("userName", {
      id: "UserName",
      header: "User Name",
      cell: (info) => (
        <span className="text-[#343A40]  whitespace-nowrap">
          {info.getValue() || 0}
        </span>
      ),
    }),
   columnHelper.accessor("advertiser", {
    id: "network",
    header: "Brand Name",
    cell: (info) => {
        const advertisers = info.getValue();
        const name = Array.isArray(advertisers) ? advertisers[0] : advertisers;
        return (
        <span className="text-[#343A40]  whitespace-nowrap">
            {name || "Not Interacted"}
        </span>
        );
    },
    }),

     columnHelper.accessor("competitors", {
    id: "adsCountOnSearch",
    header: "Competitors",
    cell: (info) => {
        const competitors = info.getValue();

        if (!Array.isArray(competitors) || competitors.length === 0) {
        return (
            <span className="text-[#343A40]  whitespace-nowrap">
            Not Interacted
            </span>
        );
        }

        return (
        <div className="flex flex-col text-[#343A40]  text-sm">
            {competitors.map((c, i) => (
            <div key={i}>
                {i + 1}. {c.competitor_name}
            </div>
            ))}
        </div>
        );
    },
    }),

   columnHelper.accessor("fbMap", {
  id: "facebookCount",
  header: (
    <>
      Facebook<br />Today's / Total
    </>
  ),
  cell: (info) => {
    const row = info.row.original;
    const competitors = row.competitors || [];
    const fbMap = row.fbMap || {};

    return (
      <div className="text-[#343A40]  text-sm space-y-1">
        {competitors.map((c, i) => {
          const name = c.competitor_name.toLowerCase();
          const fb = fbMap[name] || { today: 0, total: 0 };
          return (
            <div key={i}>
              {fb.today} / {fb.total}
            </div>
          );
        })}
      </div>
    );
  },
}),

   columnHelper.accessor("igMap", {
  id: "instagramCount",
  header: (
    <>
      Instagram<br />Today's / Total
    </>
  ),
  cell: (info) => {
    const row = info.row.original;
    const competitors = row.competitors || [];
    const igMap = row.igMap || {};

    return (
      <div className="text-[#343A40]  text-sm space-y-1">
        {competitors.map((c, i) => {
          const name = c.competitor_name.toLowerCase();
          const ig = igMap[name] || { today: 0, total: 0 };
          return (
            <div key={i}>
              {ig.today} / {ig.total}
            </div>
          );
        })}
      </div>
    );
  },
}),

  columnHelper.accessor("date", {
  id: "date_created",
  header: "Date Created",
  cell: (info) => {
    const dateStr = info.getValue();
    const formatted = dateStr ? new Date(dateStr).toLocaleDateString() : "Not Interacted";
    return (
      <span className="text-[#343A40]  whitespace-nowrap">
        {formatted}
      </span>
    );
  },
}),

  ];

  const table = useReactTable({
    data: competitorsData,
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
  
  const { searchdataFilterTable,
    setsearchdataFilterTable}  = useContext(AdminContext)


    useEffect(()=>{
      async function getCompUsersCount() {
        setLoading(true);
        const api = import.meta.env.VITE_COMPETITORS_API;
        let result = await axios.get(`${api}get-comp-users-count`);

        if(result?.data?.statusCode == 200){
          setCompUsersCount(result?.data.body.data);
          setLoading(false);
        } 

        if(result.code === 401){
          navigate("/");
          return;
        }
      }
      getCompUsersCount();
      
    },[])
  const stats = [
    {
      title: "Total Users",
      value:compUsersCount.totalUsers ||0,
      color: "text-[#1540a4]",
      bg: "bg-blue-100",
      icon: <FaSortUp className="text-green-500 w-[16px] h-[16px] mt-[6px]" />,
      trendBg: "bg-green-100",
      trendText: "text-green-600",
      // datas: data,
      datafill: "#154014",
    },
    {
      title: "Active Users",
      value: compUsersCount.activeUsers ||0,
      color: "text-[#e04e8e]",
      bg: "bg-pink-100",
      icon: <FaSortUp className="text-green-500 w-[16px] h-[16px] mt-[6px]" />,
      trendBg: "bg-green-100",
      trendText: "text-green-600",
      // datas: data1,
      datafill: "#e04e8e",
    },
    {
      title: "Inactive Users",
      value: compUsersCount.inActiveUsers ||0,
      color: "text-[#311884]",
      bg: "bg-purple-100",
      icon: <FaSortDown className="text-red-500 w-[16px] h-[16px] mt-[-6px]" />,
      trend: "14.6%",
      trendBg: "bg-red-100",
      trendText: "text-red-600",
      // datas: data2,
      datafill: "#311884",
    },
  ];

  return (
    <div className={`bg-white rounded-[10px] w-full py-[18px] h-[calc(100%-136px)] ${searchdataFilterTable === 3 || searchdataFilterTable === 0 ? 'opacity-[100%]' : 'opacity-50' }`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 py-4">
            {stats?.map((item, index) => (
          <div
            key={index}
            className={`p-4 rounded-xl shadow-md ${item.bg} flex flex-col justify-between`}
          >
            <p className="text-[#1f1f1f] text-[16px] font-[400]">
              {item.title}
            </p>
            <h2 className={`text-[30px] font-[600] ${item.color}`}>
              {loading ? "..." : (item?.value||0)}
            </h2>
          </div>
        ))}
        </div>
       <div className="pl-[30px] pr-[24px] flex justify-between items-center w-full pb-[18px]">
      <div className="flex gap-8 border-b border-gray-300">
        <p
          onClick={() => setActiveTab("active")}
          className={`text-[#1f296a] font-semibold text-[20px] cursor-pointer pb-2 ${
            activeTab === "active" ? "border-b-4 border-[#3f51b5]" : "border-b-4 border-transparent"
          }`}
        >
          Active Competitors
        </p>
        <p
          onClick={() => setActiveTab("inactive")}
          className={`text-[#1f296a] font-semibold text-[20px] cursor-pointer pb-2 ${
            activeTab === "inactive" ? "border-b-4 border-[#3f51b5]" : "border-b-4 border-transparent"
          }`}
        >
          Inactive Competitors
        </p>
      </div>
        <div className="flex gap-[16px] items-center">
               
            <CompetitiveDetailsDatePicker  initialStartDate={dateRange1.startDate}
                    initialEndDate={dateRange1.endDate}
                    onDateChange={handleDateChange1}
                    setSelectedSystem={setSelectedSystem}
                    setShowFilterModal={setShowFilterModal}
                  
                    />
          <div className="w-[20vw] relative h-[42px]">
              <CiSearch className="lucide lucide-search h-[20px] w-[20px] text-[#575757] absolute left-3 top-2" />
              <input
                type="text" onChange={(e)=>{setFilterData(e.target.value)}}
                className="flex  px-3 py-2  text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus:outline-[#157496] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm border border-[#dee2e6] bg-[#ffffff] pl-9 h-10 focus:outline-none w-full rounded-lg"
              />
          </div>
        </div>
      </div>
      <div className="overflow-auto w-full pl-[30px] ">
        <table className="min-w-full border-collapse ">
          <thead className="bg-[#f9f9fb] rounded-[12px] sticky top-0">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className={`table_header_class !px-4 !py-3 h-[53px]  text-left text-13 font-medium text-[#343A40]  whitespace-nowrap transition-all duration-100 ease-in cursor-pointer`}                  >
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
                    className={`h-12 border-b border-border_primary border-[#dddddd] font-[400] text-[14px]  
                      ${adsCount === 0 ? 'bg-red-500 text-white' : 
                        index % 2 === 0
                        ? 'bg-[#fff] text-gray-700 '
                        : 'bg-white'
                      }`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="!px-5 !py-4 text-13 text-left font-normal text-[#343A40] h-[42px]"
                      >
                        {cell.column.columnDef.cell(cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={table.getAllColumns().length}
                  className="px-4 py-2.5 text-sm text-center font-normal text-[#A0A0A0]"
                >
                  No teams available
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="pr-[48px]">
        <PaginationCompetitor
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

export default CompetitorDetails;
