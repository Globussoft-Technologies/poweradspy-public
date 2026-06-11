import React, { useEffect, useState } from "react";
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
import { CiSearch } from "react-icons/ci";
import { getApiCall } from "./ApiResponse";
const columnHelper = createColumnHelper();
import Pagination from "../Pagination/Pagination";
import Loader from "./Loader";
import axios from "axios";
import Cookies from 'js-cookie';
import { useRef } from "react";
import { IoIosArrowDown } from "react-icons/io";

const UserDetailsPas = () => {
  const [teamsData , setTeamsData] = useState([]);
  const [totalCount ,settotalCount] = useState();
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(20); 
  const [loading, setLoading] = useState(false);
  const [tableLoading, setTableLoading] = useState(false);
  const [usersCount, setUsersCount] = useState(0);
  const [filterData ,setFilterData] =useState("");
  const [userCategory, setUserCategory] = useState("Active Users");

  const navigate = useNavigate();


  const getUserDetails = async (pageIndex, userCategory) => {
    setTableLoading(true);
    let page = pageIndex + 1;
    let result;

    if (userCategory === "Active Users") {
      result = await getActiveUserDetails(page);
    } else if(userCategory === "Expired Users"){
      result = await getAllUserDetails(page);
    } else{
      result = await getPendingUserDetails(page);
    }

    if (result.code === 401) {
      navigate("/");
      return;
    }else if(result.code==400){
      setTeamsData([]);
      settotalCount(0);
      setTableLoading(false);
      return;
    }
    setTeamsData(result.data);
    settotalCount(result.totalCount);
    setTableLoading(false);
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

  const getActiveUserDetails = async (page) => {
    const api = import.meta.env.VITE_NODE_USER_ACTIVITY_API;
    const token = Cookies.get('token');
    let url = `${api}get-active-users?page=${page}&size=${pageSize}`;
    
      if (filterData) {
        url += `&user_id=${filterData}`;
      }
      
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    return response.data;
  };

  const getAllUserDetails = async (page) => {
    const api = import.meta.env.VITE_NODE_USER_ACTIVITY_API;
    const token = Cookies.get('token');
    let url = `${api}get-expired-users?page=${page}&size=${pageSize}`;
    if (filterData) {
      url += `&user_id=${filterData}`;
    }
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    return response.data;
  };

  const getPendingUserDetails = async (page) => {
    const api = import.meta.env.VITE_NODE_USER_ACTIVITY_API;
    const token = Cookies.get('token');
    let url =`${api}get-pending-users?page=${page}&size=${pageSize}`
    if (filterData) {
      url += `&user_id=${filterData}`;
    }
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    
    return response.data;
  };
  useEffect(() => {
    getUserDetails(pageIndex, userCategory);
  }, [pageIndex, userCategory]);

  const isFirstRun = useRef(true);
   useEffect(() => {
      if (isFirstRun.current) {
        isFirstRun.current = false;
        return; 
      }
      getUserDetails(pageIndex, userCategory);
    }, [debouncedFilter]);

  const data = [
    { name: "Page A", uv: 400 },
    { name: "Page B", uv: 600 },
    { name: "Page C", uv: 800 },
    { name: "Page D", uv: 500 },
    { name: "Page E", uv: 700 },
  ];
  const data1 = [
    { name: "Page A", uv: 400 },
    { name: "Page B", uv: 500 },
    { name: "Page C", uv: 600 },
    { name: "Page D", uv: 700 },
    { name: "Page E", uv: 800 },
  ];
  const data2 = [
    { name: "Page A", uv: 800 },
    { name: "Page B", uv: 700 },
    { name: "Page C", uv: 600 },
    { name: "Page D", uv: 500 },
    { name: "Page E", uv: 400 },
  ];
  const stats = [
    {
      title: "Active Users",
      value: usersCount?.activeUsersCount||0,
      color: "text-[#1540a4]",
      bg: "bg-blue-100",
      icon: <FaSortUp className="text-green-500 w-[16px] h-[16px] mt-[6px]" />,
      trendBg: "bg-green-100",
      trendText: "text-green-600",
      datas: data,
      datafill: "#154014",
    },
    {
      title: "Expired Users",
      value: usersCount?.expireUsersCount||0,
      color: "text-[#e04e8e]",
      bg: "bg-pink-100",
      icon: <FaSortUp className="text-green-500 w-[16px] h-[16px] mt-[6px]" />,
      trendBg: "bg-green-100",
      trendText: "text-green-600",
      datas: data1,
      datafill: "#e04e8e",
    },
    {
      title: "Pending Users",
      value: usersCount?.pendingUserCount||0,
      color: "text-[#311884]",
      bg: "bg-purple-100",
      icon: <FaSortDown className="text-red-500 w-[16px] h-[16px] mt-[-6px]" />,
      trend: "14.6%",
      trendBg: "bg-red-100",
      trendText: "text-red-600",
      datas: data2,
      datafill: "#311884",
    },
    {
      title: "Overall User Activity",
      value: usersCount?.totalActivitiesCount||0,
      color: "text-[#0f766e]",
      bg: "bg-teal-100",
      icon: <FaSortUp className="text-teal-500 w-[16px] h-[16px] mt-[6px]" />,
      trendBg: "bg-teal-100",
      trendText: "text-teal-600",
      datas: data,
      datafill: "#0f766e",
    },
    {
      title: "Overall Top Users",
      value: usersCount?.topUsersCount||0,
      color: "text-[#b45309]",
      bg: "bg-amber-100",
      icon: <FaSortUp className="text-amber-500 w-[16px] h-[16px] mt-[6px]" />,
      trendBg: "bg-amber-100",
      trendText: "text-amber-600",
      datas: data1,
      datafill: "#b45309",
    },
  ];

  useEffect(()=>{
    async function getUsersCount() {
      setLoading(true);
      const api = import.meta.env.VITE_NODE_USER_ACTIVITY_API;
      const token = Cookies.get('token');
      let result = await axios.get(`${api}get-users-count`,{
        headers: {
          'Authorization': `Bearer ${token}`,
      },
      });

      if(result?.data?.code == 200){
        setUsersCount(result?.data);  
        setLoading(false);
      } 

      if(result.code === 401){
        navigate("/");
        return;
      }
    }
    getUsersCount();

  },[])

  const handleUserDetails = (rowData) => {
    localStorage.setItem("userId",rowData.user_id);
    localStorage.setItem("userNameS",rowData.name);
    localStorage.setItem("emailF",rowData.email);
    navigate("/pas");
  };

  const tableLabelsColors = [
    { bg: "#E57373", color: "#FFFFFF" }, // Red
    { bg: "#81C784", color: "#FFFFFF" }, // Green
    { bg: "#64B5F6", color: "#FFFFFF" }, // Blue
    { bg: "#FFD54F", color: "#000000" }, // Yellow
    { bg: "#BA68C8", color: "#FFFFFF" }, // Purple
  ];

  const columns = [
    columnHelper.accessor("name", {
      id: "name",
      header: "User Name",
      cell: (info) => {
        const rowIndex = info.row.index;
        const user = info.getValue();
        return (
          <div className="flex items-center space-x-2">
            <span
              className="w-[32px] h-[32px] flex items-center justify-center rounded-[5px] text-white text-sm"
              style={{
                backgroundColor:
                  tableLabelsColors[rowIndex % tableLabelsColors?.length]?.bg,
              }}
            >
              <img
                src="https://i.ibb.co/m5RNgKsj/iconamoon-profile-fill.png"
                alt=""
              />
            </span>
            <span className="text-[#343A40]  capitalize">
              {user || "N/A"}
            </span>
          </div>
        );
      },
    }),
    columnHelper.accessor("user_id", {
      id: "user_id",
      header: "User ID",
      cell: (info) => (
        <span className="text-[#343A40]  whitespace-nowrap">
          {info.getValue() || "N/A"}
        </span>
      ),
    }),
    columnHelper.accessor("action", {
      id: "action",
      header: "Action",
      cell: ({row}) => (
        <button
          className="bg-[#eaf0fe] text-[#1f296a] px-4 py-1.5 rounded-lg text-sm font-[500] border border-[#c5d5fc] hover:bg-[#d6e4ff] transition whitespace-nowrap"
          onClick={() => handleUserDetails(row.original)}
        >
          View Details
        </button>
      ),
    }),
  ];

  const table = useReactTable({
    data: teamsData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: true,
  });

   const [isOpen, setIsOpen] = useState(false);
      const dropdownRef = useRef(null);
    
      const toggleDropdown = () => {
        setIsOpen((prev) => !prev);
      };
    
      useEffect(() => {
        const handleClickOutside = (event) => {
          if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
            setIsOpen(false);
          }
        };
    
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
          document.removeEventListener("mousedown", handleClickOutside);
        };
      }, []);
      
      const handleMenuClick = (menuItem) => {
        setUserCategory(menuItem);
        setPageIndex(0);
        setIsOpen(false);
      };
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 py-4">
        {stats?.map((item, index) => (
          <div
            key={index}
            className={`p-4 rounded-xl shadow-sm ${item.bg} flex flex-col justify-between min-h-[90px]`}
          >
            <p className="text-[#1f1f1f] text-[14px] font-[400]">
              {item.title}
            </p>
            <h2 className={`text-[28px] font-[600] ${item.color} mt-1`}>
              {loading ? "..." : (item?.value || 0)}
            </h2>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-[10px] w-full py-[18px]">
        <div className="pl-[30px] pr-[24px] flex flex-wrap justify-between items-center gap-3">
          <p className="text-[#1f296a] font-[600] text-[24px]">
            Users Data
          </p>
          <div className="flex gap-[12px] items-center flex-wrap">
            <div className="relative h-[42px] w-[220px]">
              <CiSearch className="h-[20px] w-[20px] text-[#575757] absolute left-3 top-[11px]" />
              <input
                onChange={(e) => setFilterData(e.target.value)}
                type="text"
                placeholder="Search by user ID..."
                className="border border-[#dee2e6] bg-white pl-9 h-10 focus:outline-none w-full rounded-lg text-sm"
              />
            </div>
            <div className="relative inline-block" ref={dropdownRef}>
              <button
                onClick={toggleDropdown}
                className="h-[42px] px-4 py-2 bg-white border border-[#dee2e6] text-[#343A40] text-sm rounded-lg flex items-center gap-2 hover:bg-gray-50 transition min-w-[140px]"
              >
                {userCategory}
                <IoIosArrowDown className="text-[#343A40] text-base ml-auto" />
              </button>
              {isOpen && (
                <div className="absolute right-0 mt-1 w-48 bg-white border border-[#dee2e6] shadow-lg rounded-lg z-20">
                  <ul className="py-1">
                    {["Active Users", "Expired Users", "Pending Users"].map((item) => (
                      <li
                        key={item}
                        onClick={() => handleMenuClick(item)}
                        className="px-4 py-2 text-sm text-[#343A40] hover:bg-gray-100 cursor-pointer"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto w-full pl-[30px]">
          <table className="min-w-full border-collapse mt-3">
            <thead className="bg-[#f9f9fb] rounded-[12px]">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className={`table_header_class px-4 py-3 h-[53px]  text-left text-13 font-medium text-[#343A40] hover:text-gray-500  whitespace-nowrap transition-all duration-100 ease-in cursor-pointer`}
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
              {tableLoading ? (
                <tr>
                  <td colSpan={table.getAllColumns()?.length}>
                    <Loader />
                  </td>
                </tr>
              ) : 
              table.getRowModel().rows.length > 0 ? (
                table.getRowModel().rows.map((row, index) => (
                  <tr
                    key={row.id}
                    className={`h-12 border-b border-border_primary border-[#dddddd] font-[400] text-[14px] !text-[#1f1f1f] hover:bg-table-row-hover-primary  
                                  ${
                                    index % 2 === 0
                                      ? "bg-[#fff] text-gray-700 "
                                      : "bg-white"
                                  }`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="px-5 py-2.5 text-13 text-left font-normal text-[#343A40] "
                      >
                        {cell.column.columnDef.cell(cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={table.getAllColumns()?.length}
                    className="px-4 py-2.5 text-sm text-center font-normal text-[#A0A0A0]"
                  >
                    No teams available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="pr-[48px]">
          <Pagination
          totalCount={totalCount}
          pageSize={20}
          setPageSize={setPageSize}
          pageIndex={pageIndex}
          setPageIndex={setPageIndex}/>
      </div>
    </div>
  );
};

export const CustomBarChart = ({ data, color, index }) => {
  const [heighestindex, setHeighestindex] = useState(
    Array(4)
      .fill()
      .map(() => ({ activeind: 0 }))
  );

  // Function to update the highest index dynamically
  useEffect(() => {
    setHeighestindex((prev) =>
      prev.map((item, i) =>
        i === index
          ? {
              activeind: data.reduce(
                (maxIdx, item, idx, arr) =>
                  item.uv > arr[maxIdx].uv ? idx : maxIdx,
                0
              ),
            }
          : item
      )
    );
  }, [data, index]);

  return (
    <div className="w-[56px] h-[40px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <Tooltip wrapperStyle={{ backgroundColor: "#ccc" }} />
          <Bar dataKey="uv" barSize={30}>
            {data.map((entry, idx) => (
              <Cell
                key={`cell-${idx}`}
                cursor="pointer"
                fill={
                  idx === heighestindex[index]?.activeind ? color : `${color}33`
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default UserDetailsPas;
