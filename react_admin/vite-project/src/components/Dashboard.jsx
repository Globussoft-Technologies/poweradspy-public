import React, { useEffect, useState,useMemo } from "react";
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
import {useDispatch, useSelector} from "react-redux"
import { fetchAllUsers , fetchUsersStats, fetchUserUsageCost} from "../store/actions/adsgptActions";
import HelmetExport from "react-helmet";
const columnHelper = createColumnHelper();

// const teamsData = [
//   { userName: "Lorem Inpsum", userId: "GPT-14" },
//   { userName: "Jane Doe", userId: "GPT-14" },
//   { userName: "Alice Smith", userId: "GPT-14" },
//   { userName: "Bob Johnson", userId: "GPT-14" },
//   { userName: "Charlie Brown", userId: "GPT-14" },
//   { userName: "David Wilson", userId: "GPT-14" },
// ];

const Dashboard = () => {

  const dispatch = useDispatch();
  const { users, userStats } = useSelector(state => state.adsgpt);
  const [searchTerm, setSearchTerm] = useState("");
  
  useEffect(() => {
    const fetchData = async () => {
      try {
        await Promise.all([
          dispatch(fetchAllUsers()),
          dispatch(fetchUsersStats())
        ]);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };
  
    fetchData();
  }, [dispatch]);
  
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
  const data3 = [
    { name: "Page A", uv: 700 },
    { name: "Page B", uv: 800 },
    { name: "Page C", uv: 600 },
    { name: "Page D", uv: 500 },
    { name: "Page E", uv: 400 },
  ];

  const stats = [
    {
      title: "Total User",
      value: userStats?.totalUsers || 0,
      color: "text-[#1540a4]",
      bg: "bg-blue-100",
      icon: <FaSortUp className="text-green-500 w-[16px] h-[16px] mt-[6px]" />,
      trend: "14.6%",
      trendBg: "bg-green-100",
      trendText: "text-green-600",
      datas: data,
      datafill: "#154014",
    },
    {
      title: "Active User",
      value: userStats?.activeUsers || 0,
      color: "text-[#e04e8e]",
      bg: "bg-pink-100",
      icon: <FaSortUp className="text-green-500 w-[16px] h-[16px] mt-[6px]" />,
      trend: "14.6%",
      trendBg: "bg-green-100",
      trendText: "text-green-600",
      datas: data1,
      datafill: "#e04e8e",
    },
    {
      title: "Expired User",
      value: userStats?.expiredUsers || 0,
      color: "text-green-600",
      bg: "bg-green-100",
      icon: <FaSortUp className="text-green-500 w-[16px] h-[16px] mt-[6px]" />,
      trend: "14.6%",
      trendBg: "bg-green-100",
      trendText: "text-green-600",
      datas: data1,
      datafill: "#e04e8e",
    },
    {
      title: "Total Interactions",
      value: users.length || 0,
      color: "text-yellow-600",
      bg: "bg-yellow-100",
      icon: <FaSortUp className="text-green-500 w-[16px] h-[16px] mt-[6px]" />,
      trend: "14.6%",
      trendBg: "bg-green-100",
      trendText: "text-green-600",
      datas: data1,
      datafill: "#e04e8e",
    }
   
  ];
  const navigate = useNavigate();
  const handleUserDetails = (userId) => {
    const data = { id: 123, name: "Example Data" }; // Data to send
    dispatch(fetchUserUsageCost(userId))
    navigate(`/adsgpt/userdetails/${userId}`, { state: data });
  };

  const tableLabelsColors = [
    { bg: "#E57373", color: "#FFFFFF" }, // Red
    { bg: "#81C784", color: "#FFFFFF" }, // Green
    { bg: "#64B5F6", color: "#FFFFFF" }, // Blue
    { bg: "#FFD54F", color: "#000000" }, // Yellow
    { bg: "#BA68C8", color: "#FFFFFF" }, // Purple
  ];

  const filteredUsers = useMemo(() => {
    return users?.filter((user) => {
      const term = searchTerm.toLowerCase();
      return (
        user.user_name?.toLowerCase().includes(term) ||
        user.user_id?.toLowerCase().includes(term)||
        user.user_email?.toLowerCase().includes(term)
      );
    });
  }, [searchTerm, users]);

  const columns = [
    columnHelper.accessor("user_name", {
      id: "user_name",
      header: "User Name",
      cell: (info) => {
        const rowIndex = info.row.index;
        const user = info.getValue();
        return (
          <div className="flex items-center space-x-2">
            <span
              className="w-[42px] h-[42px] flex items-center justify-center rounded-[5px] text-white text-sm"
              style={{
                backgroundColor:
                  tableLabelsColors[rowIndex % tableLabelsColors.length]?.bg,
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
      cell: (info) => {
        const userId = info.row.original.user_id;
        return (<button
          className="!bg-[#Eaf0fe] !text-[#1f296a] px-3 py-1 rounded-md text-sm"
          onClick={() => handleUserDetails(userId)}
        >
          View Details
        </button>)
      },
    }),
  ];

  const table = useReactTable({
    data: filteredUsers,
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
  return (
    <>
    <HelmetExport>
        <title>AdsGpt Admin Panel</title>
      </HelmetExport>
    <div className="">
      <div className="">
        <p className="text-[30px] font-[600] text-[#1f296a]">
          Welcome Back,
          <span className="text-[#673ab7] ml-[12px]">Admin</span>
        </p>
        <p className="text-[16px] text-[#575757] font-[400]">
          AdsGpt user interaction data  
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 py-4">
        {stats.map((item, index) => (
          <div
            key={index}
            className={`p-4 rounded-xl shadow-md ${item.bg} flex flex-col justify-between`}
          >
            <p className="text-[#1f1f1f] text-[16px] font-[400]">
              {item.title}
            </p>
            <p className={`text-[30px] font-[600] ${item.color} !mb-0`}>
              {item.value}
            </p>

            {/* Trend Indicator */}
            <div className="flex items-center gap-1 mt-2 justify-between">
              {/* <p
                className={`px-2 py-1 text-xs font-semibold rounded-full bg-white ${item.trendText} w-[58px] h-[24px] flex justify-between items-center`}
              >
                <span className="pt-[-6px]">{item.icon}</span>
                <span>{item.trend}</span>
              </p> */}

              {/* <CustomBarChart
                data={item.datas}
                color={item.datafill}
                index={index}
              /> */}
            </div>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-[10px] w-full py-[18px] ">
        <div className="pl-[30px] pr-[24px] flex justify-between items-center mb-[24px]">
          <p className="text-[#1f296a] font-[600] text-[24px]">
            Interaction Data
          </p>
          <div className="flex gap-[16px]">
    <div className="w-[20vw] relative h-[42px]">
          <CiSearch className="absolute left-3 top-2.5 w-5 h-5 text-[#575757]" />
          <input
            type="text"
            placeholder="Search by Name or ID or Email ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-3 py-2 border border-[#dee2e6] rounded-lg w-full focus:outline-[#157496] text-sm text-black"
          />
        </div> </div>
        </div>
        <div className="h-[420px]">
        <div className="overflow-auto w-full pl-[30px] h-full">
          <table className="min-w-full border-collapse ">
            <thead className="bg-[#f9f9fb] rounded-[12px] sticky top-0">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className={`table_header_class px-4 py-3 h-[53px]  text-left text-13 font-medium text-[#343A40]  hover:text-gray-500  whitespace-nowrap transition-all duration-100 ease-in cursor-pointer`}
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
              {table.getRowModel().rows.length > 0 ? (
                table.getRowModel().rows.map((row, index) => (
                  <tr
                    key={row.id}
                    className={`h-12 border-b border-border_primary border-[#dddddd] font-[400] text-[14px] !text-[#1f1f1f] hover:bg-table-row-hover-primary cursor-pointer  
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
        </div>
      </div>
    </div>
    </>
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

export default Dashboard;
