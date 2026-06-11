
import React, { use, useContext, useRef } from "react";
import { useEffect, useState } from "react";
import { FaArrowUp, FaArrowDown } from "react-icons/fa";
import { FaSortUp, FaSortDown } from "react-icons/fa";
import { FaCheck, FaTrash, FaStar,FaChevronDown,FaRegStar} from "react-icons/fa";
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
import Swal from 'sweetalert2';

const columnHelper = createColumnHelper();

const DailyKeywordDetails = ({setKeywordStatis}) => {
  const [startDate, setStartDate] = useState(null);
  const [competitorsData, setCompetitorsData] = useState([]);
  const [selectedSystem, setSelectedSystem] = useState(null);
  const [showFilterModal, setShowFilterModal] = useState(false);

  const [filterData ,setFilterData] =useState("");
  const [totalCount ,settotalCount] = useState();
  const [pageIndex, setPageIndex] = useState(0);
 const [pageSize, setPageSize] = useState(10); 
 const [loading, setLoading] = useState(false);
  const [searchAfterHistory, setSearchAfterHistory] = useState([]);
  const [searchAfter, setSearchAfter] = useState(null);
  const [originalData, setOriginalData] = useState([]);
const [dateRange1, setDateRange1] = useState({startDate:null,endDate:null});
  const [compUsersCount, setCompUsersCount] = useState(0);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showStatusDropdownInsta, setShowStatusDropdownInsta] = useState(false);

const [selectedFbStatus, setSelectedFbStatus] = useState("");
const [selectedInstaStatus, setSelectedInstaStatus] = useState("");
const [showModal, setShowModal] = useState(false);
const [formData, setFormData] = useState({
  keyword: "",
  user_id: ""
});

  const navigate = useNavigate();
const handleDateChange1 = (startDate, endDate) => {
    setDateRange1({ startDate, endDate });
  };
// Inside your component:
const dropdownFbRef = useRef(null);
const dropdownInstaRef = useRef(null);

// Close dropdowns on outside click
useEffect(() => {
  function handleClickOutside(event) {
    if (
      dropdownFbRef.current &&
      !dropdownFbRef.current.contains(event.target)
    ) {
      setShowStatusDropdown(false);
    }
    if (
      dropdownInstaRef.current &&
      !dropdownInstaRef.current.contains(event.target)
    ) {
      setShowStatusDropdownInsta(false);
    }
  }

  document.addEventListener("mousedown", handleClickOutside);
  return () => {
    document.removeEventListener("mousedown", handleClickOutside);
  };
}, []);

// Reset form whenever modal closes
useEffect(() => {
  if (!showModal) {
    setFormData({ user_id: "", keyword: "", type: "" });
  }
}, [showModal]);

async function getDailyKeywordData() {
  setLoading(true);
  const isNumeric = /^\d+$/.test(filterData.trim());
  const filterKey = isNumeric ? "user_id" : "keyword";
  const filterValue = filterData.trim();

  let apiUrl = `${import.meta.env.VITE_LINKEDIN_API}get-daily-keyword-data?page=${pageIndex + 1}&limit=${pageSize}`;

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
  if (selectedFbStatus!=="") {
    apiUrl += `&facebook_status=${encodeURIComponent(selectedFbStatus)}`;
  }

  if (selectedInstaStatus!=="") {
    apiUrl += `&instagram_status=${encodeURIComponent(selectedInstaStatus)}`;
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
    
  if (result.data.code === 200) {
    const rawData = result.data.data;
    setOriginalData(rawData);
    setCompetitorsData(rawData);
    settotalCount(result.data.totalCount);
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
      getDailyKeywordData();
    }, [pageIndex, pageSize, debouncedFilter, dateRange1, selectedFbStatus, selectedInstaStatus]);


    useEffect(() => {
      setPageIndex(0);
    }, [debouncedFilter]);
    useEffect(() => {
      getDailyKeywordData();
    }, []);

  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return; 
    }
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

const handlePriority = async (rowdata) => {
    const newStatus = rowdata.facebook_status === 9 ? 0 : 9;
    const payload = {
      keyword: rowdata.keyword,
      user_id: rowdata.user_id,
      type: rowdata.type,
      facebook_status: newStatus
    };

    const apiUrl = `${import.meta.env.VITE_LINKEDIN_API}update-status-admin`;
    let result = await postApiCall(apiUrl,payload);
    if (result.code === 200) {
      toast.success(newStatus === 9 ? "Marked as Priority" : "Priority Removed");
      getDailyKeywordData();
    }else{
      toast.warning("Failed to update the status");
    }
};

const handleDelete = async (rowdata)=>{
    const payload ={
        keyword : rowdata.keyword,
        user_id : rowdata.user_id,
        type : rowdata.type
    }
     const apiUrl = `${import.meta.env.VITE_LINKEDIN_API}delete-dailyKeyword-request`
     
    let result = await postApiCall(apiUrl,payload);
    if(result.code==200){
        toast.success("Request Deleted Successfully");
        getDailyKeywordData();
    }else{
        toast.warning("failed to delete");
    }
}

const handleFbStatusChange = (status) => {
  setShowStatusDropdown(false);
  setSelectedInstaStatus("");
  setSelectedFbStatus(status);
  setPageIndex(0); 
};

const handleInstaStatusChange = (status) => {
  setShowStatusDropdownInsta(false);
  setSelectedFbStatus("");
  setSelectedInstaStatus(status);
  setPageIndex(0);
};

const statuses = [
  { value: "All", label: "All"},
  { value: 0, label: "Not Processed"},
  { value: 1, label: "Processed from Adslibrary"},
  { value: 4, label: "Processed from AdsSpy"},
  { value: 9, label: "Priority" },
  { value: 2, label: "Ad Found" },
  { value: 3, label: "Ad Not Found" },
  { value: 9, label: "Priority" },
  { value: 5, label: "Processed from Both"},
];
const selectedStatusInsta = statuses.find(s => s.value === selectedInstaStatus);
const selectedStatus = statuses.find(s => s.value === selectedFbStatus);
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
      id: "user_id",
      header: "UserId",
        cell: (info) => (
        <span className="text-[#343A40]  whitespace-nowrap">
          {info.getValue() || 0}
        </span>
      ),
    }),
    columnHelper.accessor("keyword", {
      id: "keyword",
      header: "Keyword",
      cell: (info) => {
        const row = info.row.original; 
        const keyword = info.getValue();

        return (
        <span className="text-[#343A40] whitespace-nowrap flex items-center gap-1">
            {keyword || 0}
            {row.facebook_status === 9 && (
            <FaStar size={20} className="text-yellow-500" title="Priority" />
            )}
        </span>
        );
    },
    }),
    columnHelper.accessor("type", {
    id: "type",
    header: "Type",
    cell: (info) => (
        <span className="text-[#343A40] whitespace-nowrap">
        {info.getValue() === 0
            ? "Keyword"
            : info.getValue() === 1
            ? "Advertiser"
            : "Domain"}
        </span>
    ),
    }),
 columnHelper.accessor("facebook_status", {
    id: "facebook_status",
    header: () => (
      <div className="relative inline-block">
        <button
          type="button"
          onClick={() => setShowStatusDropdown((prev) => !prev)}
          className="flex items-center gap-1"
        >
          {selectedStatus ? (
            selectedStatus.value === "All" ? (
              "Facebook Status"
            ) : (
              <div>
              Facebook Status <br /> 
              <strong>{selectedStatus.label}</strong>
            </div>
            )
          ) : (
            "Facebook Status"
          )}
          <FaChevronDown className="text-gray-500" />
        </button>

        {/* Dropdown */}
        {showStatusDropdown && (
          <div
            ref={dropdownFbRef}
            className="absolute mt-2 w-50 bg-white border rounded-lg shadow-lg z-50"
          >
            {statuses.map((status) => (
              <div
                key={status.value}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer"
                onClick={() => handleFbStatusChange(status.value)}
              >
                {status.label}
              </div>
            ))}
          </div>
        )}

      </div>
    ),
    cell: (info) => (
      <span className="text-[#343A40] whitespace-nowrap">
        {info.getValue() || 0}
      </span>
    ),
  }),
      columnHelper.accessor("instagram_status", {
        id: "instagram_status",
        header: () => (
        <div className="relative inline-block">
            <button
            type="button"
            onClick={() => setShowStatusDropdownInsta((prev) => !prev)}
            className="flex items-center gap-1"
            >
            {selectedStatusInsta ? (
            selectedStatusInsta.value === "All" ? (
              "Instagram Status"
            ) : (
             <div>
              Instagram Status <br /> 
              <strong>{selectedStatusInsta.label}</strong>
            </div>
            )
          ) : (
            "Instagram Status"
          )}
            <FaChevronDown className="text-gray-500" />
            </button>

            {/* Dropdown */}
            {showStatusDropdownInsta && (
              <div
                ref={dropdownInstaRef}
                className="absolute mt-2 w-50 bg-white border rounded-lg shadow-lg z-50"
              >
                {statuses.map((status) => (
                  <div
                    key={status.value}
                    className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer"
                    onClick={() => handleInstaStatusChange(status.value)}
                  >
                    {status.label}
                  </div>
                ))}
              </div>
            )}

        </div>
        ),
        cell: (info) => (
        <span className="text-[#343A40] whitespace-nowrap">
            {info.getValue() || 0}
        </span>
        ),
    }),
      columnHelper.accessor("created_at", {
      id: "created_at",
      header: "Date",
      cell: (info) => (
        <span className="text-[#343A40]  whitespace-nowrap">
          {info.getValue() || 0}
        </span>
      ),
    }),
      columnHelper.accessor("updated_at", {
      id: "updated_at",
      header: "Last Synced",
      cell: (info) => (
        <span className="text-[#343A40]  whitespace-nowrap">
          {info.getValue() || 0}
        </span>
      ),
    }),

    columnHelper.accessor("userName", {
    id: "UserName",
    header: "Action",
    cell: (info) => {
        const row = info.row.original;

        return (
        <div className="flex items-center gap-3">
            {/* Priority Done */}
           <button
            type="button"
            className="p-2 rounded-full hover:bg-gray-100 text-black"
            title={row.facebook_status === 9 ? "Remove Priority" : "Mark as Priority"}
            onClick={() => handlePriority(row)}
          >
            {row.facebook_status === 9 ? (
              <FaStar size={18} className="text-black" />
            ) : (
              <FaRegStar size={18} className="text-black" />
            )}
          </button>

            {/* Delete */}
            <button
              type="button"
              className="p-2 rounded-full bg-red-100 text-red-600 hover:bg-red-200"
              title="Delete"
              onClick={() => {
                Swal.fire({
                  title: "Are you sure?",
                  text: `You are about to delete "${row.keyword}". This data cannot be retrieved back!`,
                  icon: "warning",
                  showCancelButton: true,
                  confirmButtonColor: "#d33",
                  cancelButtonColor: "#3085d6",
                  confirmButtonText: "Yes, delete it!",
                }).then((result) => {
                  if (result.isConfirmed) {
                    handleDelete(row);
                  }
                });
              }}
            >
              <FaTrash />
            </button>

        </div>
        );
    },
    })

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

  return (
    <div className={`bg-white rounded-[10px] w-full py-[18px] h-[calc(100%-136px)] ${searchdataFilterTable === 3 || searchdataFilterTable === 0 ? 'opacity-[100%]' : 'opacity-50' }`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 py-4">
          
        </div>
       <div className="pl-[30px] pr-[24px] flex justify-between items-center w-full pb-[18px]">
      <div className="flex gap-8 border-b border-gray-300">
        
      </div>
        <div className="flex gap-[16px] items-center">
              <button
                onClick={() => setShowModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                + Add Keyword
                </button>
 
            <CompetitiveDetailsDatePicker  initialStartDate={dateRange1.startDate}
                    initialEndDate={dateRange1.endDate}
                    onDateChange={handleDateChange1}
                    setSelectedSystem={setSelectedSystem}
                    setShowFilterModal={setShowFilterModal}
                  
                    />
          <div className="w-[20vw] relative h-[42px]">
              <CiSearch className="lucide lucide-search h-[20px] w-[20px] text-[#575757] absolute left-3 top-2" />
              <input
                type="text" onChange={(e)=>{setFilterData(e.target.value)}} placeholder="Search User_id or Keyword"
                className="flex  px-3 py-2  text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus:outline-[#157496] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm border border-[#dee2e6] bg-[#ffffff] pl-9 h-10 focus:outline-none w-full rounded-lg"
              />
          </div>
        </div>
      </div>
      <div className="overflow-auto w-full pl-[30px] h-[calc(100%-54px)] ">
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
{showModal && (
  <div className="fixed inset-0 flex items-center justify-center backdrop-blur-sm bg-white/30 z-50">
    <div className="bg-white p-6 rounded-xl w-[400px] shadow-lg">
      <h2 className="text-lg font-semibold mb-4">Add Keyword</h2>

      {/* User ID */}
      <div className="mb-3">
        <label className="block text-sm font-medium text-gray-700">User ID</label>
        <input
          type="text"
          value={formData.user_id}
          onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
          className="w-full border rounded-lg px-3 py-2 mt-1"
          placeholder="Enter User ID"
          required
        />
      </div>

      {/* Keyword */}
      <div className="mb-3">
        <label className="block text-sm font-medium text-gray-700">Keyword</label>
        <input
          type="text"
          value={formData.keyword}
          onChange={(e) => setFormData({ ...formData, keyword: e.target.value })}
          className="w-full border rounded-lg px-3 py-2 mt-1"
          placeholder="Enter Keyword"
          required
        />
      </div>

      {/* Type Dropdown */}
      <div className="mb-3">
        <label className="block text-sm font-medium text-gray-700">Type</label>
        <select
          value={formData.type}
          onChange={(e) => setFormData({ ...formData, type: e.target.value })}
          className="w-full border rounded-lg px-3 py-2 mt-1"
          required
        >
          <option value="">Select Type</option>
          <option value="Keyword">Keyword</option>
          <option value="Advertiser">Advertiser</option>
          <option value="Domain">Domain</option>
        </select>
      </div>

      {/* Buttons */}
      <div className="flex justify-end gap-3 mt-4">
     <button
        onClick={() => {
          setShowModal(false);
          setFormData({ user_id: "", keyword: "", type: "" });
        }}
        className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
      >
        Cancel
      </button>
        <button
          onClick={async () => {
            if (!formData.user_id || !formData.keyword || !formData.type) {
              toast.error("All fields are required");
              return;
            }
            let result = await postApiCall(
              `${import.meta.env.VITE_LINKEDIN_API}add-daily-keyword`,
              formData
            );
            
            if(result.code ==200){
              toast.success("Keyword added successfully");
              getDailyKeywordData();
            } 
            else {
              toast.error(`${result.message}`);
            }
            setShowModal(false);
            setFormData({ user_id: "", keyword: "", type: "" });

          }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Save
        </button>
      </div>
    </div>
  </div>
)}
  <ToastContainer />
    </div>
  );
};

export default DailyKeywordDetails;
