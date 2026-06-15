import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { FaAngleDoubleLeft, FaAngleDoubleRight, FaAngleUp,FaAngleDown, FaChevronLeft, FaChevronRight } from "react-icons/fa";
import { BiSolidDownArrow, BiSolidUpArrow } from "react-icons/bi";
import {
  useReactTable,
  getCoreRowModel,
  createColumnHelper,
  flexRender,
  getPaginationRowModel,
  getFilteredRowModel,
} from "@tanstack/react-table";
import { CiFilter, CiSearch } from "react-icons/ci";
import SparklineChart from "../../components/Pas/Chart/SparklineChart";
import fb from "../../assets/Social/fb.png";
import insta from "../../assets/Social/Instagram.png";
import ModalSystemInfo from "./ModalSystemInfo";
import SimpleDateRangePicker from "../../components/SimpleDatepicker";
import CpuLineChart from "../../components/Pas/Chart/CpuLineChart";
import { fetchDomaninProcessDetails, fetchStatusAccountInfo, fetchStatusSystemInfo, fetchSystemInfo, fetchSystemInsites } from "../../store/actions/powerAdsPyActionsApi";
import { useDispatch, useSelector } from "react-redux";
import Facebook from "../../assets/Social/fb.png";
import Google from "../../assets/Social/Google.png";
import Instagram from "../../assets/Social/Instagram.png";
import Native from "../../assets/Social/Native.png";
import Gdn from "../../assets/Social/Google-ads.png";
import Youtube from "../../assets/Social/Youtube.png";
import Linkedin from "../../assets/Social/Linkedin.png";
import Pinterest from "../../assets/Social/Pinterest.png";
import Quora from "../../assets/Social/Quora.png";
import Reddit from "../../assets/Social/Reddit.png";
import Tiktok from "../../assets/Social/Tiktok.png";
import Slider from "react-slick";
// import { BiSolidDownArrow } from "react-icons/bi";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import SystemPerformanceTable from "./SystemPerformanceTable";
import AccountPerformanceTable from "./AccountPerformanceTable";
import { FaArrowUp, FaArrowDown, FaArrowsAltV } from 'react-icons/fa';
import { Tooltip } from 'react-tooltip';
import { useOutletContext } from "react-router-dom";
import StageChart from "./ModalSystemStatusInfo";
import TimeChart from "./ModalSystemStatusInfo";
import ModalAccountStatusInfo from "./ModalAccountStatusInfo";
import DomainProcessCountTable from "./DomainProcessTable";
import ScreenCast from "./screenCasting";
import { RiRemoteControlLine } from 'react-icons/ri';

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


const SystemInfo = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isApply, setIsApply] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isAccountStatusModalOpen, setIsAccountStatusModalOpen] = useState(false);
  const [modalData, setModalData] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const [network, setNetwork] = useState("");
  const { isMonitoring } = useOutletContext();
  const [monitoringStatus, setMonitoringStatus] = useState({});
  const [isModalOpenScreen, setIsModalOpenScreen] = useState(false);
  const scrollRef = useRef(null);
  const pickerRef = useRef(null);

  const [dateRange1, setDateRange1] = useState(loadSelectedDates());
  const [selectedSystem, setSelectedSystem] = useState(null);
  const [systemName, setSystemName] = useState(null);
  const [connectToRemoteSystem, setConnectToRemoteSystem] = useState(null);
  const [accountName, setAccountName] = useState(null);
  const [accountSystemName, setAccountSystemName] = useState(null);
  const [adsFilterPlatform, setAdsFilterPlatform] = useState({
    platform: [] // Now supports multiple network selection
  });
  const platFormOptions = [
    { value: '10', label: 'Scroll Plugin' },
    { value: '12', label: 'Python Crawler' },
  ];
  // const { loadingStatusSystemInfo, StatusSystemInfo } = useSelector((state) => state.poweradspy);
  const [showFilterModal, setShowFilterModal] = useState(false);
const {loadingSystemInfo,SystemInfo,SystemInsitesAdsCount,loadingStatusSystemInfo,loadingDomainsData,domainProcessData,StatusSystemInfo,loadingStatusAccountInfo,AccountInfo} =
  useSelector((state) => state.poweradspy);
  function calculateDaysInclusive(fromDate, toDate) {
    const date1 = new Date(fromDate);
    const date2 = new Date(toDate);
    date1.setHours(0, 0, 0, 0);
    date2.setHours(0, 0, 0, 0);
    return Math.abs(date2 - date1) / (1000 * 60 * 60 * 24) + 1;
  }
  const getNetworkIcon = (network) => {
    const networkIcons = {
      facebook: Facebook,
      gtext: Google,
      instagram: Instagram,
      native: Native,
      gdn: Gdn,
      linkedin:Linkedin,
      reddit :Reddit,
      quora:Quora,
      youtube:Youtube,
      pinterest:Pinterest,
      tiktok :Tiktok 
    };
  
    if (!network) return null;
    
    const normalizedNetwork = network.toLowerCase();
    return networkIcons[normalizedNetwork] || null;
  };

  const handleDateChange1 = (startDate, endDate) => {
    setDateRange1({ startDate, endDate });
  };
  const dispatch = useDispatch();
  // Modal handlers
  const openModal = useCallback((data) => {
    setModalData(data?.accounts);
    setIsModalOpen(true);
  }, []);

  const formatSystemDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setModalData(null);
  }, []);

  const closeStatusModal = useCallback(() => {
    setIsStatusModalOpen(false);
  }, []);
  const closeAccountStatusModal = useCallback(() => {
    setIsAccountStatusModalOpen(false);
  },[])
  const closeModalScreen = useCallback(() => {
    setIsModalOpenScreen(false);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedDown", handleClickOutside);
    };
  }, [isOpen, isApply]);
  


  function getHoursBetweenDates(startDate, endDate) {
    // Ensure both inputs are Date objects
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Calculate difference in milliseconds
    const diffInMs = Math.abs(end - start);
    
    // Convert milliseconds to hours
    const diffInHours = diffInMs / (1000 * 60 * 60);
    
    return diffInHours;
  }
  
  useEffect(() => {
    const fetchAllData = async () => {
      if(!systemName) return
      const playload = {
        "range": {
          "from": formatSystemDate(dateRange1?.startDate),
          "to": formatSystemDate(dateRange1?.endDate)
        },
        "systemName": systemName,
        "steps": calculateDaysInclusive(dateRange1?.startDate, dateRange1?.endDate)
      }
      try {
        await Promise.all([
          dispatch(fetchStatusSystemInfo(playload))
        ]);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };
    fetchAllData();
  }, [dispatch, dateRange1.endDate,systemName]);
  useEffect(() => {
    const fetchAllData = async () => {
      if(!accountName ) return
      const playload = {
        "range": {
          "from": formatSystemDate(dateRange1?.startDate),
          "to": formatSystemDate(dateRange1?.endDate)
        },
        "accountName": accountName,
        "systemName": accountSystemName,
        "steps": calculateDaysInclusive(dateRange1?.startDate, dateRange1?.endDate)
      }
      try {
        await Promise.all([
          dispatch(fetchStatusAccountInfo(playload))
        ]);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };
    fetchAllData();
  }, [dispatch, dateRange1.endDate,accountName,accountSystemName]);

  useEffect(() => {
    const fetchDomainProcessData = async () => {
      const playload = {
        "range": {
          "from": formatSystemDate(dateRange1?.startDate),
          "to": formatSystemDate(dateRange1?.endDate)
        }
      }
      try {
        await Promise.all([
          dispatch(fetchDomaninProcessDetails(playload))
        ]);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };
    fetchDomainProcessData();
  }, [dispatch, dateRange1.endDate]);

  useEffect(() => {
    const fetchAllData = async () => {
      const endDate = new Date(dateRange1.endDate);
      endDate.setDate(endDate.getDate() + 1);
      const totalAdsCount= {
        "range": {
          "from": formatSystemDate(dateRange1?.startDate),
          "to": formatSystemDate(dateRange1?.endDate)
        },
        "mode": "test",
        "steps":calculateDaysInclusive(dateRange1?.startDate, dateRange1?.endDate)
    }
      try {
    
        // if (network !== "tiktok") {
          await Promise.all([
            dispatch(fetchSystemInfo(totalAdsCount))
          ]);
        // }
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };
    fetchAllData();
  }, [dispatch,dateRange1.endDate,adsFilterPlatform]);

  // Columns definitions
  const topRef = useRef(null);
  const columns = useMemo(() => [
    {
      accessorKey: "account",
      enableSorting: true,
      header: ({ column }) => (
        <div className="flex items-center gap-1">
          <span>Accounts</span>
          <div className="flex flex-col">
            <FaAngleUp 
              className={`h-5 w-6 cursor-pointer mb-[-3px] ${column.getIsSorted() === "asc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(false)}
            />
            <FaAngleDown 
              className={`h-5 w-6 cursor-pointer mt-[-3px] ${column.getIsSorted() === "desc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(true)}
            />
          </div>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex items-center justify-between w-full">
        {/* Account name with truncation */}
        <span className="truncate pr-1 flex-1 min-w-0"  
         onClick={(e) => {
          e.stopPropagation();
          setSelectedSystem(prev => 
            prev === row?.original?.system ? null : row?.original?.system
          )
          row?.original?.account !==null&&setIsAccountStatusModalOpen(true);
            setAccountName(prev => 
              prev === row?.original?.account ? null : row?.original?.account
            );
            setAccountSystemName(prev => 
              prev === row?.original?.system ? null : row?.original?.system
            );
        }}
        >
          {row?.original?.account !== null ? row.original?.account : row?.original?.account_id ?? "---"}
        </span>
        
        {/* Status icon with tooltip */}
        <div className="flex-shrink-0 w-5 h-5 ml-1 relative group">
          {row?.original?.alert?.color=="yellow" ? 
            <>
              <svg 
               data-tooltip-id="Active-tooltip"
               data-tooltip-content="No ads fetched from the account"
                className="w-5 h-5 text-yellow-500 cursor-pointer" 
                fill="currentColor" 
                viewBox="0 0 20 20"
              >
                <path 
                  fillRule="evenodd" 
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" 
                  clipRule="evenodd" 
                />
              </svg>
            <Tooltip
            id="Active-tooltip"
            place="top"
            effect="solid"
            className="!z-9990 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 !py-0.75"
            delayShow={300}
          />
            </>
          : row?.original?.alert?.color=="red" ?
            <>
              <svg 
                data-tooltip-id="InActive-tooltip"
                data-tooltip-content="System/Chrome profile is inactive"
                className="w-5 h-5 text-red-500 cursor-pointer" 
                fill="currentColor" 
                viewBox="0 0 20 20"
              >
                <path 
                  fillRule="evenodd" 
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" 
                  clipRule="evenodd" 
                />
              </svg>
              <Tooltip
            id="InActive-tooltip"
            place="top"
            effect="solid"
            className="!z-9999 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 !py-0.75"
            delayShow={300}
          />
            </> : <></>
          }
        </div>
      </div>
      )
    },
    {
      accessorKey: "system",
      enableSorting: true,
      header: ({ column }) => (
        <div className="flex items-center gap-1">
          <span>Ran on system</span>
          <div className="flex flex-col">
            <FaAngleUp 
              className={`h-5 w-6 cursor-pointer mb-[-3px] ${column?.getIsSorted() === "asc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(false)}
            />
            <FaAngleDown 
              className={`h-5 w-6 cursor-pointer mt-[-3px] ${column?.getIsSorted() === "desc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(true)}
            />
          </div>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span
            data-tooltip-id="instagram-tooltip"
            data-tooltip-content="Click to check System Data"
            className="hover:underline cursor-pointer font-medium text-[15px] text-[#1f296a] px-2 py-1.5 w-fit rounded h-fit relative group"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedSystem(prev => 
                prev === row?.original?.system ? null : row?.original?.system
              )
                // row.original.system !==null&&setIsStatusModalOpen(true);
                // setSystemName(prev => 
                //   prev === row.original.system ? null : row.original.system
                // );
          
              topRef?.current?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            {row?.original?.system}
          </span>
          <Tooltip
            id="instagram-tooltip"
            place="top"
            effect="solid"
            className="z-50 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 py-1"
            delayShow={300}
          />
        </div>
      ),
    },
    {
      accessorKey: "unique_ads",
      enableSorting: true,
      header: ({ column }) => (
        <div className="flex items-center gap-1">
          <span>Unique Ads</span>
          <div className="flex flex-col">
            <FaAngleUp 
              className={`h-5 w-6 cursor-pointer mb-[-3px] ${column?.getIsSorted() === "asc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(false)}
            />
            <FaAngleDown 
              className={`h-5 w-6 cursor-pointer mt-[-3px] ${column?.getIsSorted() === "desc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(true)}
            />
          </div>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span>{row?.original?.unique_ads > 0 ? row?.original?.unique_ads : "---"}</span>
        </div>
      ),
    },
    {
      accessorKey: "ads",
      enableSorting: true,
      header: ({ column }) => (
        <div className="flex items-center gap-1">
          <span>Total Ads</span>
          <div className="flex flex-col">
            <FaAngleUp 
              className={`h-5 w-6 cursor-pointer mb-[-3px] ${column?.getIsSorted() === "asc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(false)}
            />
            <FaAngleDown 
              className={`h-5 w-6 cursor-pointer mt-[-3px] ${column?.getIsSorted() === "desc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(true)}
            />
          </div>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span>{row.original.ads > 0 ? row.original.ads : "---"}</span>
        </div>
      ),
    },
    {
      accessorKey: "updated_ads",
      enableSorting: true,
      header: ({ column }) => (
        <div className="flex items-center gap-1">
          <span>Updated Ads</span>
          <div className="flex flex-col">
            <FaAngleUp 
              className={`h-5 w-6 cursor-pointer mb-[-3px] ${column.getIsSorted() === "asc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(false)}
            />
            <FaAngleDown 
              className={`h-5 w-6 cursor-pointer mt-[-3px] ${column.getIsSorted() === "desc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(true)}
            />
          </div>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span>{row?.original?.updated_ads > 0 ? row?.original?.updated_ads : "---"}</span>
        </div>
      ),
    },
    {
      accessorKey: "network",
      enableSorting: true,
      header: ({ column }) => (
        <div className="flex items-center gap-1">
          <span>Network</span>
          <div className="flex flex-col">
            <FaAngleUp 
              className={`h-5 w-6 cursor-pointer mb-[-3px] ${column.getIsSorted() === "asc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(false)}
            />
            <FaAngleDown 
              className={`h-5 w-6 cursor-pointer mt-[-3px] ${column.getIsSorted() === "desc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(true)}
            />
          </div>
        </div>
      )
    },
    {
      accessorKey: "country",
      enableSorting: true,
      header: ({ column }) => (
        <div className="flex items-center gap-1">
          <span>Country</span>
          <div className="flex flex-col">
            <FaAngleUp
              className={`h-5 w-6 cursor-pointer mb-[-3px] ${column.getIsSorted() === "asc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(false)}
            />
            <FaAngleDown
              className={`h-5 w-6 cursor-pointer mt-[-3px] ${column.getIsSorted() === "desc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(true)}
            />
          </div>
        </div>
      ),
      cell: ({ row }) => (
        <span className="whitespace-nowrap">{row?.original?.country || "---"}</span>
      ),
    },
    // IP Address column — hidden until a populated data source is wired up.
    // The backend already returns `ip_address` per row (currently null for the
    // enabled networks); re-enable this block once real IPs are available.
    // {
    //   accessorKey: "ip_address",
    //   enableSorting: false,
    //   header: "IP Address",
    //   cell: ({ row }) => (
    //     <span className="tabular-nums whitespace-nowrap">{row?.original?.ip_address || "---"}</span>
    //   ),
    // },
    {
      header: "Performance",
      accessorKey: "performance",
      cell: ({ row }) => <SparklineChart data={row?.original?.performance} />,
      enableSorting: false
    }
       // ...(getHoursBetweenDates(dateRange1.startDate, new Date(dateRange1.endDate).setDate(new Date(dateRange1.endDate).getDate() + 1)) > 24 ? [
    //   {
    //     accessorKey: "adsByDay", 
    //     header: "Ads Per Day",
    //     cell: ({ row }) => <SparklineChart data={row.original.adsByDay} />,
    //     enableSorting: false
    //   }
    // ] : [])
  ], [dateRange1,isMonitoring]);
  const columns2 = useMemo(() => [
{ 
  accessorKey: "systemName", 
  enableSorting: true,
  header: ({ column }) => (
    <div className="flex items-center gap-1">
      <span>System Name</span>
      <div className="flex flex-col">
        <FaAngleUp 
          className={`h-5 w-6 cursor-pointer mb-[-3px] ${column.getIsSorted() === "asc" ? "text-[#1f296a]" : "text-gray-400"}`}
          onClick={() => column?.toggleSorting(false)}
        />
        <FaAngleDown 
          className={`h-5 w-6 cursor-pointer mt-[-3px] ${column.getIsSorted() === "desc" ? "text-[#1f296a]" : "text-gray-400"}`}
          onClick={() => column?.toggleSorting(true)}
        />
      </div>
    </div>
  ),
  cell: ({ row }) => (
    <div className="flex items-center gap-2 w-[120px]">
      {/* Remote Control Icon - Only show if systemName exists */}
      {row?.original?.systemName !== null && (
        <RiRemoteControlLine 
          className="text-[#6366f1] cursor-pointer hover:text-[#4f46e5] transition-colors h-5 w-5"
          data-tooltip-id="remote-control-tooltip"
          data-tooltip-content="Connect to remote system"
          onClick={(e) => {
            e.stopPropagation();
            if (row?.original?.systemName !== null) {
              // Here you would implement your remote connection logic
              // For example, open a modal or connect directly:
              setSystemName(row?.original?.systemName);
              setConnectToRemoteSystem(row?.original?.systemName);
              setIsModalOpenScreen(true)
            }
          }}
        />
      )}
      
      {/* System Name with Status Tooltip */}
      <span
        data-tooltip-id="status-tooltip"
        data-tooltip-content="Click to check System Status"
        className="cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          row?.original?.systemName !== null && setIsStatusModalOpen(true);
          setSystemName(row?.original?.systemName);
        }}
      >
        {row?.original?.systemName !== null ? row?.original?.systemName : "---"}
      </span>
      
      {/* Tooltip for remote control icon */}
      <Tooltip
        id="remote-control-tooltip"
        place="top"
        effect="solid"
        className="z-50 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 py-1"
        delayShow={300}
      />
    </div>
  ),
},
    {
      accessorKey: "facebook",
      enableSorting: true,
      header: ({ column }) => (
        <div className="flex items-center gap-1">
          <div className="flex flex-col items-center"><div>Facebook</div><div className="cursor-pointer" data-tooltip-id={`${SystemInsitesAdsCount?.facebook?.accounts&&SystemInsitesAdsCount?.facebook?.systems&&"facebook-tooltip-ads"}`}
          data-tooltip-content="accounts/systems" >({SystemInsitesAdsCount?.facebook?.accounts}/{SystemInsitesAdsCount?.facebook?.systems})</div>
          <Tooltip
        id="facebook-tooltip-ads"
        place="top"
        effect="solid"
        className="z-50 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 py-1"
        delayShow={300}
      />
          </div>
          <div className="flex flex-col">
            <FaAngleUp 
              className={`h-5 w-6 cursor-pointer mb-[-3px] ${column?.getIsSorted() === "asc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(false)}
            />
            <FaAngleDown 
              className={`h-5 w-6 cursor-pointer mt-[-3px] ${column?.getIsSorted() === "desc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(true)}
            />
          </div>
        </div>
      ),
      cell: ({ row }) => (
        
        <div className="flex flex-col gap-[12px] ">
         <span
          data-tooltip-id={`${row?.original?.facebook>0&&"facebook-tooltip"}`}
          data-tooltip-content="Click to check accounts"
        className={`${row?.original?.facebook>0&&"hover:underline cursor-pointer"} font-medium text-[15px] text-[#1f296a] px-2 py-1.5 w-fit rounded h-fit relative group`}
        onClick={(e) => {
          e.stopPropagation();
          row?.original?.facebook>0&&openModal(row?.original);
          setNetwork("Facebook");
        }}
      >
        {row?.original?.facebook>0 ?row?.original?.facebook:"---"}
      </span>
      {row?.original?.facebook>0&&
      <Tooltip
        id="facebook-tooltip"
        place="top"
        effect="solid"
        className="z-9999 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 py-1"
        delayShow={300}
      />
    }
        </div>
      ),
    },
    {
      accessorKey: "instagram",
      enableSorting: true,
      header: ({ column }) => (
        <div className="flex items-center gap-1">
          <div className="flex flex-col items-center"><div>Instagram</div>
          <div className="cursor-pointer" data-tooltip-id={`${SystemInsitesAdsCount?.instagram?.accounts&&SystemInsitesAdsCount?.instagram?.systems&&"facebook-tooltip-ads"}`}
          data-tooltip-content="accounts/systems">({SystemInsitesAdsCount?.instagram?.accounts}/{SystemInsitesAdsCount?.instagram?.systems})</div>
          <Tooltip
        id="facebook-tooltip-ads"
        place="top"
        effect="solid"
        className="z-50 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 py-1"
        delayShow={300}
      />
          </div>
          <div className="flex flex-col">
            <FaAngleUp 
              className={`h-5 w-6 cursor-pointer mb-[-3px] ${column?.getIsSorted() === "asc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(false)}
            />
            <FaAngleDown 
              className={`h-5 w-6 cursor-pointer mt-[-3px] ${column?.getIsSorted() === "desc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(true)}
            />
          </div>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span
            data-tooltip-id={`${row?.original?.instagram>0&&"instagram-tooltip"}`}
            data-tooltip-content="Click to check accounts"
          className={`${row?.original?.instagram>0&&"hover:underline cursor-pointer"} font-medium text-[15px] text-[#1f296a] px-2 py-1.5 w-fit rounded h-fit relative group`}
          onClick={(e) => {
            e.stopPropagation();
            row?.original?.instagram>0&&openModal(row?.original);
            setNetwork("Instagram");
          }}
          >{row?.original?.instagram>0?row?.original?.instagram:"---"}</span>
            <Tooltip
            id="instagram-tooltip"
            place="top"
            effect="solid"
            className="z-50 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 py-1"
            delayShow={300}
          />
        </div>
      ),
    },
    {
      accessorKey: "gtext",
      enableSorting: true,
      header: ({ column }) => (
        <div className="flex items-center gap-1">
          <div className="flex flex-col items-center"><div>Google</div>
          <div className="cursor-pointer" data-tooltip-id={`${SystemInsitesAdsCount?.gtext?.accounts||SystemInsitesAdsCount?.gtext?.systems&&"gtext-tooltip-ads"}`}
          data-tooltip-content="accounts/systems">({SystemInsitesAdsCount?.gtext?.accounts??0}/{SystemInsitesAdsCount?.gtext?.systems??0})</div>
              <Tooltip
            id="gtext-tooltip-ads"
            place="top"
            effect="solid"
            className="z-50 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 py-1"
            delayShow={300}
          />
          </div>
          <div className="flex flex-col">
            <FaAngleUp 
              className={`h-5 w-6 cursor-pointer mb-[-3px] ${column?.getIsSorted() === "asc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(false)}
            />
            <FaAngleDown 
              className={`h-5 w-6 cursor-pointer mt-[-3px] ${column?.getIsSorted() === "desc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(true)}
            />
          </div>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span
            data-tooltip-id={`${(row?.original?.gtext>0&&row?.original?.accounts?.length>0)&&"Google-tooltip"}`}
            data-tooltip-content="Click to check accounts"
            className={`${(row?.original?.gtext>0&&row?.original?.accounts?.length>0)&& "hover:underline cursor-pointer"}  font-medium text-[15px] text-[#1f296a] px-2 py-1.5 w-fit rounded h-fit relative group`}
            onClick={(e) => {
              e.stopPropagation();

              (row?.original?.gtext>0&&row?.original?.accounts?.length>0)&&openModal(row?.original);
              setNetwork("Google");
            }}
          >{row?.original?.gtext>0?row?.original?.gtext:"---"}</span>
          {(row?.original?.gtext>0&&row?.original?.accounts?.length>0)&&
            <Tooltip
            id="Google-tooltip"
            place="top"
            effect="solid"
            className="z-50 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 py-1"
            delayShow={300}
          />
        }
        </div>
      ),
    },
    {
      accessorKey: "youtube",
      enableSorting: true,
      header: ({ column }) => (
        <div className="flex items-center gap-1">
          <div className="flex flex-col items-center"><div>YouTube</div>
          <div className="cursor-pointer" data-tooltip-id={`${SystemInsitesAdsCount?.youtube?.accounts||SystemInsitesAdsCount?.youtube?.systems&&"youtube-tooltip-ads"}`}
              data-tooltip-content="accounts/systems">({SystemInsitesAdsCount?.youtube?.accounts??0}/{SystemInsitesAdsCount?.youtube?.systems??0})</div>
            <Tooltip
            id="youtube-tooltip-ads"
            place="top"
            effect="solid"
            className="z-50 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 py-1"
            delayShow={300}
            />
          </div>
          <div className="flex flex-col">
            <FaAngleUp 
              className={`h-5 w-6 cursor-pointer mb-[-3px] ${column.getIsSorted() === "asc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column.toggleSorting(false)}
            />
            <FaAngleDown 
              className={`h-5 w-6 cursor-pointer mt-[-3px] ${column.getIsSorted() === "desc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column.toggleSorting(true)}
            />
          </div>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span
            data-tooltip-id={`${(row.original.youtube>0&&row.original.accounts?.length>0)&&"Gdn-tooltip"}`}
            data-tooltip-content="Click to check accounts"
            className={`${(row.original.youtube>0&&row.original.accounts?.length>0)&&"hover:underline cursor-pointer"} font-medium text-[15px] text-[#1f296a] px-2 py-1.5 w-fit rounded h-fit relative group`}
            onClick={(e) => {
              e.stopPropagation();
              (row.original.youtube>0&&row.original.accounts?.length>0)&&openModal(row.original);
              setNetwork("youtube");
            }}
          > {row?.original?.youtube>0?row?.original?.youtube:"---"}</span>
          {(row?.original?.youtube>0&&row?.original?.accounts?.length>0)&&<Tooltip
            id="Gdn-tooltip"
            place="top"
            effect="solid"
            className="z-50 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 py-1"
            delayShow={300}
          />}
        </div>
      ),
    },
    {
      accessorKey: "quora",
      enableSorting: true,
      header: ({ column }) => (
        <div className="flex items-center gap-1">
          <div className="flex flex-col items-center"><div>Quora</div>
          <div className="cursor-pointer" data-tooltip-id={`${SystemInsitesAdsCount?.quora?.accounts||SystemInsitesAdsCount?.quora?.systems&&"quora-tooltip-ads"}`}
              data-tooltip-content="accounts/systems">({SystemInsitesAdsCount?.quora?.accounts??0}/{SystemInsitesAdsCount?.quora?.systems??0})</div>
            <Tooltip
            id="quora-tooltip-ads"
            place="top"
            effect="solid"
            className="z-50 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 py-1"
            delayShow={300}
            />
          </div>
          <div className="flex flex-col">
            <FaAngleUp 
              className={`h-5 w-6 cursor-pointer mb-[-3px] ${column?.getIsSorted() === "asc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(false)}
            />
            <FaAngleDown 
              className={`h-5 w-6 cursor-pointer mt-[-3px] ${column?.getIsSorted() === "desc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(true)}
            />
          </div>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span
            data-tooltip-id={`${(row?.original?.quora>0&&row?.original?.accounts?.length>0)&&"quora-tooltip"}`}
            data-tooltip-content="Click to check accounts"
            className={`${(row?.original?.quora>0&&row?.original?.accounts?.length>0)&&"hover:underline cursor-pointer"} font-medium text-[15px] text-[#1f296a] px-2 py-1?.5 w-fit rounded h-fit relative group`}
            onClick={(e) => {
              e.stopPropagation();
              (row?.original?.quora>0&&row?.original?.accounts?.length>0)&&openModal(row?.original);
              setNetwork("quora");
            }}
          > {row?.original?.quora>0?row?.original?.quora:"---"}</span>
          {(row?.original?.quora>0&&row?.original?.accounts?.length>0)&&
          <Tooltip
            id="quora-tooltip"
            place="top"
            effect="solid"
            className="z-50 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 py-1"
            delayShow={300}
          />}
        </div>
      ),
    },
    {
      accessorKey: "reddit",
      enableSorting: true,
      header: ({ column }) => (
        <div className="flex items-center gap-1">
          <div className="flex flex-col items-center"><div>Reddit</div>
          <div className="cursor-pointer" data-tooltip-id={`${SystemInsitesAdsCount?.reddit?.accounts||SystemInsitesAdsCount?.reddit?.systems&&"reddit-tooltip-ads"}`}
              data-tooltip-content="accounts/systems">({SystemInsitesAdsCount?.reddit?.accounts??0}/{SystemInsitesAdsCount?.reddit?.systems??0})</div>
            <Tooltip
            id="reddit-tooltip-ads"
            place="top"
            effect="solid"
            className="z-50 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 py-1"
            delayShow={300}
            />
          </div>
          <div className="flex flex-col">
            <FaAngleUp 
              className={`h-5 w-6 cursor-pointer mb-[-3px] ${column?.getIsSorted() === "asc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(false)}
            />
            <FaAngleDown 
              className={`h-5 w-6 cursor-pointer mt-[-3px] ${column?.getIsSorted() === "desc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(true)}
            />
          </div>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span
            data-tooltip-id={`${(row?.original?.reddit>0&&row?.original?.accounts?.length>0)&&"reddit-tooltip"}`}
            data-tooltip-content="Click to check accounts"
            className={`${(row?.original?.reddit>0&&row?.original?.accounts?.length>0)&&"hover:underline cursor-pointer"} font-medium text-[15px] text-[#1f296a] px-2 py-1?.5 w-fit rounded h-fit relative group`}
            onClick={(e) => {
              e.stopPropagation();
              (row?.original?.reddit>0&&row?.original?.accounts?.length>0)&&openModal(row?.original);
              setNetwork("reddit");
            }}
          > {row?.original?.reddit>0?row?.original?.reddit:"---"}</span>
          {(row?.original?.reddit>0&&row?.original?.accounts?.length>0)&&
          <Tooltip
            id="reddit-tooltip"
            place="top"
            effect="solid"
            className="z-50 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 py-1"
            delayShow={300}
          />}
        </div>
      ),
    },
    {
      accessorKey: "native",
      enableSorting: true,
      header: ({ column }) => (
        <div className="flex items-center gap-1">
          <div className="flex flex-col items-center"><div>Native</div>
          <div className="cursor-pointer" data-tooltip-id={`${SystemInsitesAdsCount?.native?.accounts||SystemInsitesAdsCount?.native?.systems&&"native-tooltip-ads"}`}
              data-tooltip-content="accounts/systems">({SystemInsitesAdsCount?.native?.accounts??0}/{SystemInsitesAdsCount?.native?.systems??0})</div>
            <Tooltip
            id="native-tooltip-ads"
            place="top"
            effect="solid"
            className="z-50 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 py-1"
            delayShow={300}
            />
          </div>
          <div className="flex flex-col">
            <FaAngleUp 
              className={`h-5 w-6 cursor-pointer mb-[-3px] ${column?.getIsSorted() === "asc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(false)}
            />
            <FaAngleDown 
              className={`h-5 w-6 cursor-pointer mt-[-3px] ${column?.getIsSorted() === "desc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(true)}
            />
          </div>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span
            data-tooltip-id={`${(row?.original?.native>0&&row?.original?.accounts?.length>0)&&"native-tooltip"}`}
            data-tooltip-content="Click to check accounts"
            className={`${(row?.original?.native>0&&row?.original?.accounts?.length>0)&&"hover:underline cursor-pointer"} font-medium text-[15px] text-[#1f296a] px-2 py-1?.5 w-fit rounded h-fit relative group`}
            onClick={(e) => {
              e.stopPropagation();
              (row?.original?.native>0&&row?.original?.accounts?.length>0)&&openModal(row?.original);
              setNetwork("native");
            }}
          > {row?.original?.native>0?row?.original?.native:"---"}</span>
          {(row?.original?.native>0&&row?.original?.accounts?.length>0)&&
          <Tooltip
            id="native-tooltip"
            place="top"
            effect="solid"
            className="z-50 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 py-1"
            delayShow={300}
          />}
        </div>
      ),
    },
    {
      accessorKey: "gdn",
      enableSorting: true,
      header: ({ column }) => (
        <div className="flex items-center gap-1">
          <div className="flex flex-col items-center"><div>Gdn</div>
          <div className="cursor-pointer" data-tooltip-id={`${SystemInsitesAdsCount?.gdn?.accounts||SystemInsitesAdsCount?.gdn?.systems&&"gdn-tooltip-ads"}`}
              data-tooltip-content="accounts/systems">({SystemInsitesAdsCount?.gdn?.accounts??0}/{SystemInsitesAdsCount?.gdn?.systems??0})</div>
            <Tooltip
            id="gdn-tooltip-ads"
            place="top"
            effect="solid"
            className="z-50 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 py-1"
            delayShow={300}
            />
          </div>
          <div className="flex flex-col">
            <FaAngleUp 
              className={`h-5 w-6 cursor-pointer mb-[-3px] ${column?.getIsSorted() === "asc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(false)}
            />
            <FaAngleDown 
              className={`h-5 w-6 cursor-pointer mt-[-3px] ${column?.getIsSorted() === "desc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(true)}
            />
          </div>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span
            data-tooltip-id={`${(row?.original?.gdn>0&&row?.original?.accounts?.length>0)&&"gdn-tooltip"}`}
            data-tooltip-content="Click to check accounts"
            className={`${(row?.original?.gdn>0&&row?.original?.accounts?.length>0)&&"hover:underline cursor-pointer"} font-medium text-[15px] text-[#1f296a] px-2 py-1.5 w-fit rounded h-fit relative group`}
            onClick={(e) => {
              e.stopPropagation();
              (row?.original?.gdn>0&&row?.original?.accounts?.length>0)&&openModal(row?.original);
              setNetwork("gdn");
            }}
          > {row?.original?.gdn>0?row?.original?.gdn:"---"}</span>
          {(row?.original?.gdn>0&&row?.original?.accounts?.length>0)&&
          <Tooltip
            id="gdn-tooltip"
            place="top"
            effect="solid"
            className="z-50 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 py-1"
            delayShow={300}
          />}
        </div>
      ),
    },
    {
      accessorKey: "linkedin",
      enableSorting: true,
      header: ({ column }) => (
        <div className="flex items-center gap-1">
          <div className="flex flex-col items-center"><div>LinkedIn</div>
          <div className="cursor-pointer" data-tooltip-id={`${(SystemInsitesAdsCount?.linkedin?.accounts||SystemInsitesAdsCount?.linkedin?.systems)&&"linkedin-tooltip-ads"}`}
              data-tooltip-content="accounts/systems">({SystemInsitesAdsCount?.linkedin?.accounts??0}/{SystemInsitesAdsCount?.linkedin?.systems??0})</div>
            <Tooltip
            id="linkedin-tooltip-ads"
            place="top"
            effect="solid"
            className="z-50 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 py-1"
            delayShow={300}
            />
          </div>
          <div className="flex flex-col">
            <FaAngleUp 
              className={`h-5 w-6 cursor-pointer mb-[-3px] ${column?.getIsSorted() === "asc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(false)}
            />
            <FaAngleDown 
              className={`h-5 w-6 cursor-pointer mt-[-3px] ${column.getIsSorted() === "desc" ? "text-[#1f296a]" : "text-gray-400"}`}
              onClick={() => column?.toggleSorting(true)}
            />
          </div>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span
            data-tooltip-id={`${(row?.original?.linkedin>0&&row?.original?.accounts?.length>0)&&"linkedin-tooltip"}`}
            data-tooltip-content="Click to check accounts"
            className={`${(row?.original?.linkedin>0&&row?.original?.accounts?.length>0)&&"hover:underline cursor-pointer"} font-medium text-[15px] text-[#1f296a] px-2 py-1.5 w-fit rounded h-fit relative group`}
            onClick={(e) => {
              e.stopPropagation();
              (row?.original?.linkedin>0&&row?.original?.accounts?.length>0)&&openModal(row?.original);
              setNetwork("linkedin");
            }}
          > {row?.original?.linkedin>0?row?.original?.linkedin:"---"}</span>
          {(row?.original?.linkedin>0&&row?.original?.accounts?.length>0)&&<Tooltip
            id="linkedin-tooltip"
            place="top"
            effect="solid"
            className="z-50 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 py-1"
            delayShow={300}
          />}
        </div>
      ),
    },
    { 
      accessorKey: "ram", 
      header: "RAM",
      cell: ({ row }) => <CpuLineChart data={row?.original?.ram} />,
      enableSorting: false
    },
    { 
      accessorKey: "cpu", 
      header: "CPU",
      cell: ({ row }) => <CpuLineChart data={row?.original?.cpu} />,
      enableSorting: false
    },
    { 
      accessorKey: "performance", 
      header: "Performance",
      cell: ({ row }) => <SparklineChart data={row?.original?.performance} />,
      enableSorting: false
    }
    // ...(getHoursBetweenDates(dateRange1.startDate, new Date(dateRange1.endDate).setDate(new Date(dateRange1.endDate).getDate() + 1)) > 24 ? [
    //   {
    //     accessorKey: "adsByDay", 
    //     header: "Ads Per Day",
    //     cell: ({ row }) => <SparklineChart data={row.original.adsByDay} />,
    //     enableSorting: false
    //   }
    // ] : [])
  ], [dateRange1,SystemInsitesAdsCount]);
  // Scroll handlers
  const scrollLeft = () => {
    if (scrollRef?.current) {
      scrollRef?.current?.scrollBy({ left: -340, behavior: "smooth" });
    }
  };

  const scrollRight = () => {
    if (scrollRef?.current) {
      scrollRef?.current?.scrollBy({ left: 340, behavior: "smooth" });
    }
  };

  // Create refs for both modal and filter button
  const modalRef = React.useRef(null);
  const filterButtonRef = React.useRef(null);

  // Close modal when clicking outside (excluding filter button)
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        showFilterModal && 
        modalRef?.current && 
        !modalRef?.current?.contains(event.target) &&
        !filterButtonRef?.current?.contains(event.target)  // Add this check
      ) {
        setShowFilterModal(false);
      }
    };

    if (showFilterModal) {
      document?.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document?.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showFilterModal]);
  // Save dates to localStorage
  useEffect(() => {
    sessionStorage?.setItem(
      "dateRange",
      JSON.stringify({
        startDate: dateRange1?.startDate?.toISOString(),
        endDate: dateRange1?.endDate?.toISOString(),
      })
    );
  }, [dateRange1]);
  const handleFilterReset = () => {
    setAdsFilterPlatform({
      platform:[]
    })
    setShowFilterModal(false);
  };

  const NextArrow = (props) => {
    const { className, style, onClick } = props;
    return (
      <div
        className={className}
        style={{ 
          ...style,
          right: '-10px',
          zIndex: 1,
          color: '#333',
          fontSize: '40px',
        }}
        onClick={onClick}
      >
        ›
      </div>
    );
  };
 
  
  const PrevArrow = (props) => {
    const { className, style, onClick } = props;
    return (
      <div
        className={className}
        style={{ 
          ...style,
          left: '-32px',
          zIndex: 1,
          color: '#333',
          fontSize: '40px',
        }}
        onClick={onClick}
      >
        ‹
      </div>
    );
  };
  
  const settings = {
    dots: false,
    infinite: false,
    speed: 500,
    slidesToShow: 2,
    slidesToScroll: 1,
    nextArrow: <NextArrow />,
    prevArrow: <PrevArrow />,
    responsive: [
      {
        breakpoint: 480,
        settings: {
          slidesToShow: 1,
          arrows: false, // Hide arrows on mobile if needed
        },
      },
    ],
  };

  function filterByNetwork(data, network) {
      return data?.filter(item => item?.network?.toLowerCase() === network?.toLowerCase());
    }

    const handlePlatFormChange = (e, option) => {
      // setNetworkDropdownOpen(false)
      const value = option?.value;

      setAdsFilterPlatform(prev => {
        if (prev?.platform?.includes(value)) {
          // Remove if already selected
          return {
            ...prev,
            platform: prev?.platform?.filter(net => net !== value)
          };
        } else {
          // Add to selection
          return {
            ...prev,
            platform: [...prev?.platform, value]
          };
        }
      });
    };

    const userDetails = { data: { u_id: '123' } }; // Your user data
    const hostToken = 'your-token-here'; // Your token
  return (
    <div ref={topRef} className="w-full flex flex-col gap-[18px] relative">
      {/* Header section */}
      <div className="flex items-center justify-between">
        <div className="flex gap-[18px] items-center">
          <span className="text-[30px] font-[600] text-[#264688]">
          Lowest Performing Systems
          </span>
          {/* <span className="text-[24px] font-[700] text-[#6d6d6d]">Last 24 H</span> */}
        </div>
        <div className="flex items-center gap-2">
        <button ref={filterButtonRef}
      onClick={() => setShowFilterModal(!showFilterModal)}
      className={`flex items-center justify-center !rounded-lg !border focus:!outline-0 !border-gray-300 !p-1.5 !w-10 
      ${
        (adsFilterPlatform?.platform?.length > 0) 
          ? "!bg-[#d2dfff]" 
          : "!bg-white"
      }
      `
    }
    >
      <CiFilter className="w-6 h-6 relative" />
    
    </button>
  {/* Filter Modal */}
  {showFilterModal && (
        <div ref={modalRef} className="absolute right-[5px] top-[50px] z-50 bg-white p-6 rounded-xl shadow-xl border border-[#e0e7ff] w-84">
          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">Platforms</label>
                <svg xmlns="http://www.w3.org/2000/svg" onClick={() => setShowFilterModal(false)} className="h-5 w-5 cursor-pointer" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </div>
              
              <div className="flex flex-wrap gap-2">  
                {platFormOptions?.map(option => (
                  <div 
                    key={option?.value}
                    className={`px-3 py-1 rounded-full text-sm border cursor-pointer ${
                      adsFilterPlatform?.platform?.includes(option?.value) 
                        ? 'bg-blue-100 border-blue-500 text-blue-700' 
                        : 'bg-gray-100 border-gray-300 text-gray-700'
                    }`}
                    onClick={(e) =>{ handlePlatFormChange(e, option)}}
                  >
                    {option?.label}
                  </div>
                ))}
              </div>
              </div>
            <div className="flex justify-end gap-3 pt-2">
              <button 
                onClick={handleFilterReset}
                className="!px-4 !py-2 !text-sm !font-medium !text-[#1f296a] !border !border-[#d1d5db] !bg-gray-200 !rounded-lg hover:!bg-gray-50 !transition-colors !focus:outline-none !focus:ring-2 !focus:ring-offset-2 focus:!ring-[#1f296a]"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
        <SimpleDateRangePicker  initialStartDate={dateRange1?.startDate}
          initialEndDate={dateRange1?.endDate}
          onDateChange={handleDateChange1}
          setSelectedSystem={setSelectedSystem}
          setShowFilterModal={setShowFilterModal}
          />
          </div>
      </div>

      {/* Platforms scroll section */}

      {
        loadingSystemInfo ?
        <div className="w-full relative flex gap-[18px] items-center">
      {/* Left arrow button - shimmer */}
      <div className="relative w-[32px] h-[32px] rounded-[32px] bg-gray-200 animate-pulse"></div>
      
      {/* Cards container */}
      <div className="py-4 pr-6 gap-[24px] overflow-x-auto hide-scrollbar w-full flex">
        {/* Create 3 shimmer cards (typical loading amount) */}
        {[1, 2, 3,4,5]?.map((_, index) => (
          <div
            key={index}
            className="flex flex-col pl-[18px] pr-[24px] py-[14px] rounded-[10px] border border-[#f0f0f0] bg-white gap-2 min-w-[318px] h-[98px] animate-pulse"
          >
            {/* System name shimmer */}
            <div className="h-4 w-3/4 bg-gray-200 rounded"></div>
            
            {/* Network info shimmer */}

            <div className="w-full flex gap-[9px] items-center">
              <div className="w-[38px] h-[38px] rounded-[25px] bg-gray-200"></div>
              <div className="w-[48px] h-[20px] rounded-[5px] bg-gray-200"></div>
            </div>
          </div>
        ))}
      </div>

      {/* Right arrow button - shimmer */}
      <div className="relative w-[32px] h-[32px] rounded-[32px] bg-gray-200 animate-pulse"></div>
    </div> : 
 <div className="w-full relative flex gap-[18px] items-center">
 <button
   onClick={()=>{scrollLeft()}}
   className="relative !w-[32px] !h-[32px] !rounded-[32px] !text-[#282828] !border !border-[#282828] flex justify-center items-center !p-0"
 >
   <FaChevronLeft className="text-gray-600 text-xl" />
 </button>
 <div
   ref={scrollRef}
   className="py-4 pr-6 gap-[24px] overflow-x-auto hide-scrollbar w-full flex"
 >
   {SystemInfo?.map((platform, ind) => (
      <div
      className={`flex flex-col pl-[18px] pr-[24px] py-[14px] rounded-[10px] border border-[#cbcbcb] ${
        selectedSystem === platform?.systemName ? 'bg-blue-50 p-2 rounded-lg' : '!bg-white'
      } gap-2 !min-w-[318px] h-[98px]`}
      key={ind}
      onClick={() => setSelectedSystem(prev => 
        prev === platform?.systemName ? null : platform?.systemName
      )}
    
    >
      <span>{platform?.systemName}</span>
      <div className={`w-full ${platform?.network?.length === 1 ? "flex justify-start" : ""}`}>
      {platform?.network?.length > 1 ? (
        <Slider {...settings}>
          {platform?.network?.map((item, index) => (
            <div key={index} className="px-1">
              <div className="flex gap-[9px] items-center ">
                <div className="w-[38px] h-[38px] border border-[#cbcbcb] rounded-[25px] py-[7px] px-[7px]">
                  <img
                    src={getNetworkIcon(item?.network?.toLocaleLowerCase())}
                    alt=""
                    className="w-full h-full"
                  />
                </div>
                {item?.change=="increase" ?
                  <div className="w-[fit] h-[20px] rounded-[5px] bg-[#feeceb] text-[#16960c] flex justify-between items-center px-[3px]">
                  <BiSolidUpArrow className="text-[10px]" />
                  <span className="font-[600] text-[10px]">
                    {item?.percentage}%
                  </span>
                </div>
                :
                item?.change=="decrease" ?<div className="w-[fit] h-[20px] rounded-[5px] bg-[#feeceb] text-[#d01717] flex justify-between items-center px-[3px]">
                  <BiSolidDownArrow className="text-[10px]" />
                  <span className="font-[600] text-[10px]">
                    {item?.percentage}%
                  </span>
                </div> : 
                item?.change=="no_change"&&<div className="w-[54px] h-[20px] rounded-[5px] bg-[#feeceb] text-[#5b501a] flex justify-center items-center px-[3px]">
                {/* <BiSolidArrow className="text-[10px]" /> */}
                <span className="font-[600] text-[10px]">
                  {"---"}
                </span>
              </div> 
                
                }
              
                
              </div>
            </div>
          ))}
        </Slider>) : 
         (<div className="flex justify-center">
           <div className="px-1">
             {/* Same single slide content here */}
             <div className="flex gap-[9px] items-center">
                <div className="w-[38px] h-[38px] border border-[#cbcbcb] rounded-[25px] py-[7px] px-[7px]">
                  <img
                    src={getNetworkIcon(platform?.network[0]?.network)}
                    alt=""
                    className="w-full h-full"
                  />
                </div>
                {/*<div className="w-[48px] h-[20px] rounded-[5px] bg-[#feeceb] text-[#d01717] flex justify-between items-center px-[3px]">
                  <BiSolidDownArrow className="text-[10px]" />
                  <span className="font-[600] text-[10px]">
                    {platform?.network[0]?.percentage}%
                  </span>
                </div>*/}

                {platform?.network[0]?.change=="increase" ?
                  <div className="w-[fit] h-[20px] rounded-[5px] bg-[#feeceb] text-[#16960c] flex justify-between items-center px-[3px]">
                  <BiSolidUpArrow className="text-[10px]" />
                  <span className="font-[600] text-[10px]">
                    {platform?.network[0]?.percentage}%
                  </span>
                </div>
                :
                platform?.network[0]?.change=="decrease" ?<div className="w-[fit] h-[20px] rounded-[5px] bg-[#feeceb] text-[#d01717] flex justify-between items-center px-[3px]">
                  <BiSolidDownArrow className="text-[10px]" />
                  <span className="font-[600] text-[10px]">
                    {platform?.network[0]?.percentage}%
                  </span>
                </div> : 
                platform?.network[0]?.change=="no_change"&&<div className="w-[54px] h-[20px] rounded-[5px] bg-[#feeceb] text-[#5b501a] flex justify-center items-center px-[3px]">
                {/* <BiSolidArrow className="text-[10px]" /> */}
                <span className="font-[600] text-[10px]">
                  {"---"}
                </span>
              </div> 
                
                }
              </div>
             </div>
           </div>
         )}
       </div>
    </div>
   ))}
 </div>

 <button
   onClick={()=>{scrollRight()}}
   className="relative !w-[32px] !h-[32px] !rounded-[32px] !text-[#282828] !border !border-[#282828] flex justify-center items-center !p-0"
 >
   <FaChevronRight className="text-gray-600 text-xl" />
 </button>
</div>
      }
     

      {/* Main table section */}
      <SystemPerformanceTable 
        columns={columns2} 
        dateRange1={dateRange1}
        systemName={selectedSystem}
        adsFilterPlatform={adsFilterPlatform}
      />
      {/* Account performance table */}
      <AccountPerformanceTable 
        columns={columns} 
        dateRange1={dateRange1}
        adsFilterPlatform={adsFilterPlatform}
        setIsStatusModalOpen={setIsStatusModalOpen}
        setAccountName={setAccountName}
        // setSystemName={setSystemName}
        setIsAccountStatusModalOpen={setIsAccountStatusModalOpen}
        setAccountSystemName={setAccountSystemName}
      />
      {isModalOpenScreen  && (
       <div 
       className="fixed inset-0 bg-black/50 backdrop-blur-none z-50 flex items-center justify-center transition-all duration-300"
       onClick={closeModalScreen}
       >
       <div 
         className="bg-white backdrop-blur-lg pt-[58px] pb-[34px] !rounded-[20px] max-w-[70%] w-full max-h-[90vh] overflow-auto border border-white/20 shadow-xl"
         onClick={(e) => e.stopPropagation()}
       >
      <ScreenCast  userDetails={userDetails} connectToRemoteSystem={connectToRemoteSystem}
        hostToken={hostToken}/>
        </div>
        </div>
      )}

       {/* Modal */}
       {isStatusModalOpen && (
      <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center transition-all duration-300"
      onClick={closeStatusModal}
    >
      <div 
        className="bg-white backdrop-blur-lg rounded-[20px] w-full max-w-7xl h-[400px] flex items-center justify-center overflow-auto border border-white/20 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <TimeChart 
          StatusSystemInfo={StatusSystemInfo}
          loadingStatusSystemInfo={loadingStatusSystemInfo}
          dateRange1={dateRange1}
          onClose={closeStatusModal} 
          onStageClick={(stageName) => {
            // Add your logic here for what happens when a stage is clicked
          }}
        />
      </div>
    </div>
      )}
       {isAccountStatusModalOpen && (
      <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center transition-all duration-300"
      onClick={closeStatusModal}
    >
      <div 
        className="bg-white backdrop-blur-lg rounded-[20px] w-full max-w-7xl h-[400px] flex items-center justify-center overflow-auto border border-white/20 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <ModalAccountStatusInfo 
          AccountInfo={AccountInfo}
          loadingStatusAccountInfo={loadingStatusAccountInfo}
          dateRange1={dateRange1}
          onClose={closeAccountStatusModal} 
          onStageClick={(stageName) => {
            // Add your logic here for what happens when a stage is clicked
          }}
        />
      </div>
    </div>
      )}

      {/* Modal */}
      {isModalOpen && (
       <div 
       className="fixed inset-0 bg-black/50 backdrop-blur-none z-50 flex items-center justify-center transition-all duration-300"
       onClick={closeModal}
       >
       <div 
         className="bg-white backdrop-blur-lg pt-[58px] pb-[34px] !rounded-[20px] max-w-[70%] w-full max-h-[90vh] overflow-auto border border-white/20 shadow-xl"
         onClick={(e) => e.stopPropagation()}
       >
         <ModalSystemInfo data={filterByNetwork(modalData,network==="Google"?"gtext":network)} onClose={closeModal} network={network}/>
       </div>
     </div>
      )}
        <Tooltip
            id="status-tooltip"
            place="top"
            effect="solid"
            className="z-50 !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px]"
            delayShow={300}
          />
      <DomainProcessCountTable domains={domainProcessData} loading={loadingDomainsData}/>
    </div>
  );
};

export default SystemInfo;