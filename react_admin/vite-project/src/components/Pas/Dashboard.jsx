import React, { useContext, useEffect, useRef, useState } from "react";
import { FaArrowUp, FaArrowDown,FaRegCopy } from "react-icons/fa";
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
import {
  useReactTable,
  getCoreRowModel,
  createColumnHelper,
  getPaginationRowModel,
} from "@tanstack/react-table";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { CiFilter, CiSearch } from "react-icons/ci";
import { useNavigate } from "react-router-dom";
import KeywordSearches from "./KeywordSearches";
import AdvertiserSearches from "./AdvertiserSearches";
import DomainSearches from "./DomainSearches";
import OtherSearches from "./OtherSearches";
import ProjectSearches from "./ProjectSearches";
import AdminContext from "../../Context/Context";
import { postApiCallWithBody } from "./ApiResponse";
const columnHelper = createColumnHelper();

const teamsData = [
  { userName: "Lorem Inpsum", adsInDB: "GPT-14", userId: "GPT-14" },
  { userName: "Jane Doe", adsInDB: "GPT-14", userId: "GPT-14" },
  { userName: "Alice Smith", adsInDB: "GPT-14", userId: "GPT-14" },
  { userName: "Bob Johnson", adsInDB: "GPT-14", userId: "GPT-14" },
  { userName: "Charlie Brown", adsInDB: "GPT-14", userId: "GPT-14" },
  { userName: "David Wilson", adsInDB: "GPT-14", userId: "GPT-14" },
];

const Dashboard = () => {
  const { searchdataFilterTable,
    setsearchdataFilterTable}  = useContext(AdminContext)
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
      title: "Keyword Searched",
      value: "$5,56,656",
      color: "text-[#ff8800]",
      borderColor: "border-[#ff8800]",
      bg: "bg-[#fff6d9]",
      icon: "https://i.ibb.co/kVRWY7Dq/Group-12104.png",
      trend: "14.6%",
      trendBg: "bg-green-100",
      trendText: "text-green-600",
      datas: data,
      datafill: "#154014",
      colorShadow: "#ffdf78",
       id:'AdvertiserSearcD'
    },
    {
      title: "Advertiser Searched",
      value: "84%",
      color: "text-[#fe2386]",
      borderColor: "border-[#fe2386]",
      bg: "bg-[#ffe5fd]",
      icon: "https://i.ibb.co/NgwPtMQs/Group-12105.png",
      trend: "14.6%",
      trendBg: "bg-green-100",
      trendText: "text-green-600",
      datas: data1,
      datafill: "#e04e8e",
      colorShadow: "#ffa7f8",
      id:'AdvertiserSearchesID'
    },
    {
      title: "Domain Searched",
      value: "584",
      color: "text-[#3f6d10]",
      borderColor: "border-[#3f6d10]",
      bg: "bg-[#edffdb]",
      icon: "https://i.ibb.co/Ng291g23/Group-12106.png",
      trend: "14.6%",
      trendBg: "bg-red-100",
      trendText: "text-red-600",
      datas: data2,
      datafill: "#311884",
      colorShadow: "#a9e56c",
       id:'AdvertisearchesID'
    },
    {
      title: "Competitor Searched",
      value: "0",
      color: "text-[#1565c0]",
      borderColor: "border-[#1565c0]",
      bg: "bg-[#e3f2fd]",
      icon: "https://i.ibb.co/Ng291g23/Group-12106.png",
      trend: "14.6%",
      trendBg: "bg-blue-100",
      trendText: "text-blue-600",
      datas: data3,
      datafill: "#1565c0",
      colorShadow: "#90caf9",
      id: "CompetitorSearchesID"
    },
  ];
  // const [searchdataFilterTable,setsearchdataFilterTable] = useState(3)
  const [statics,setStatis]=useState(null)
  const [keywordStatics,setKeywordStatis]=useState(null)
  const [domainStatics,setDoaminStatis]=useState(null)
  const navigate = useNavigate();
  const handleUserDetails = () => {
    const data = { id: 123, name: "Example Data" };
    navigate("/adsgpt/userdetails", { state: data });
  };
  const [searchCounts, setSearchCounts] = useState(null);

  useEffect(() => {
    async function fetchSearchCounts() {
      const apiUrl = `${import.meta.env.VITE_NODE_USER_ACTIVITY_API}get-search-counts`;
      const result = await postApiCallWithBody(apiUrl, { user_id: localStorage.getItem("userId") });
      if (result.code == 200) {
        setSearchCounts(result);
      } else if (result.code == 401) {
        navigate("/");
      }
    }
    fetchSearchCounts();
  }, []);

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      console.log("Copied:", text);
    });
  };

  return (
    <div className="flex flex-col gap-4">

      {/* User info header */}
      <div className="bg-white rounded-[10px] px-[30px] py-[18px] flex flex-wrap justify-between items-center gap-3">
        <div className="flex flex-col gap-[4px]">
          <p className="text-[#1f296a] font-[600] text-[22px] flex items-center gap-2">
            {localStorage.getItem("userNameS") || "—"}
            <FaRegCopy
              size={13}
              onClick={() => copyToClipboard(localStorage.getItem("userNameS"))}
              className="cursor-pointer text-[#673ab7] hover:text-blue-500"
            />
          </p>
          <p className="text-[13px] text-[#6c757d] flex items-center gap-2">
            User ID:
            <span className="text-[#673ab7] font-[500] flex items-center gap-1">
              {localStorage.getItem("userId")}
              <FaRegCopy
                size={12}
                onClick={() => copyToClipboard(localStorage.getItem("userId"))}
                className="cursor-pointer hover:text-blue-500"
              />
            </span>
          </p>
        </div>
        <button
          onClick={() => setsearchdataFilterTable(3)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#dee2e6] bg-white text-[#1f296a] text-[13px] font-[400] hover:bg-gray-50 transition"
        >
          <CiFilter className="w-4 h-4" />
          Clear Filter
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((item, index) => {
          const count =
            item.title === "Keyword Searched"    ? searchCounts?.keywordCount :
            item.title === "Advertiser Searched" ? searchCounts?.advertiserCount :
            item.title === "Domain Searched"     ? searchCounts?.domainCount :
            item.title === "Competitor Searched" ? searchCounts?.competitorCount :
            null;
          return (
            <div key={index} className={`${item.bg} rounded-xl p-4 flex flex-col gap-3`}>
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center rounded-full bg-white w-[34px] h-[34px] shrink-0 shadow-sm">
                  <img src={item.icon} alt="" className="w-[18px] h-[18px] object-contain" />
                </div>
                <p className={`${item.color} text-[13px] font-[600] leading-tight`}>{item.title}</p>
              </div>
              <h2 className="text-[#1f1f1f] font-[700] text-[28px] leading-none">
                {count ?? 0}
              </h2>
              <button
                onClick={() => setsearchdataFilterTable(index)}
                className="w-full h-[34px] rounded-lg text-white font-[500] text-[12px] bg-[#1f296a] hover:bg-[#2c3a8c] transition"
              >
                View Details
              </button>
            </div>
          );
        })}
      </div>

      {/* Search sections */}
      <div className="flex flex-col gap-[12px]">
        <KeywordSearches />
        <AdvertiserSearches />
        <DomainSearches />
        <ProjectSearches />
        <OtherSearches />
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
    if (data.length > 0) {
      setHeighestindex((prev) => {
        const updatedIndexes = [...prev]; // Copy previous state
        const maxIdx = data.reduce(
          (maxIdx, item, idx, arr) => (item.uv > arr[maxIdx].uv ? idx : maxIdx),
          0
        );

        updatedIndexes[index] = { activeind: maxIdx };
        return updatedIndexes;
      });
    }
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
