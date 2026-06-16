import { useCallback, useContext, useEffect, useState } from "react";
import AdTypeCrawlerChart from "../Chart/AdTypeCrawlerChart";
import AdPositionCrawlerChart from "../Chart/AdPositionCrawlerChart";
import CountryCrawlerChartMap from "../Chart/CountryCrawlerChartMap";
import AffiliateNetworksStackedChart from "../Chart/AffiliateNetworksStackedChart";
import FunnelAdsChart from "../Chart/AdsFunnelDistributedColumnChart";
import GraphCrawlerChart from "../Chart/GraphCrawlerChart";
import AdminContext from "../../../Context/Context";
import { Slider } from "@mui/material";
import { useDispatch, useSelector } from "react-redux";
import { GrNext } from "react-icons/gr";
import { GrPrevious } from "react-icons/gr";
import { Tooltip } from 'react-tooltip';
import { FaSearch } from 'react-icons/fa';
import Locationpng from '../../../assets/Location.png'
import {
  fetchAdsFromAffiliateplatforms,
  fetchAdsFromEcommerceplatforms,
  fetchAdsFromFunnel,
  fetchNetworksCountries,
  fetchNetworkTypesCount,
  fetchPerticularSystemAccountDetails,
  fetchPerticularSystemDetails,
  fetchSystemDetails,
  fetchTiktokAdsCountryCount,
} from "../../../store/actions/powerAdsPyActionsApi";
import {
  fetchAdPositionCount,
  fetchAdsCount,
  fetchAdsCountMeta,
  fetchAdsCountPython,
  fetchAdsCountScroll,
  fetchAdsGraphCount,
  fetchAdSourceCount,
  fetchRangeCounts,
  fetchTiktokAdsCount,
  fetchTiktokAdsGraphCount,
  fetchTotalAdsCount,
} from "../../../store/actions/adsgptActions";
import { updateCountData } from "../../../store/reducers/powerAdsPySlice";
import {
  updateSearchPositionCount,
  updateSearchSourceCount,
} from "../../../store/reducers/adsgpt";
import {useOutletContext } from "react-router-dom";
import CountLoder from "../../CountLoder/CountLoder";
import TabSlider from "./Scroller";
import AccountWiseAdsTable from "../AccountWiseAdsTable";
import Title from "./Title";
import SystemDetailsShimmer from "./SystemDetailsShimmer";

// Env-controlled visibility for the Crawler-Insights network-ad sections.
// HIDDEN by default — set the matching VITE_ flag to "true" to show a section.
// (Operator asked to hide these everywhere unless explicitly re-enabled.)
const SHOW_AFFILIATE_ADS = import.meta.env.VITE_SHOW_AFFILIATE_ADS === "true";
const SHOW_FUNNEL_ADS    = import.meta.env.VITE_SHOW_FUNNEL_ADS === "true";
const SHOW_ECOMMERCE_ADS = import.meta.env.VITE_SHOW_ECOMMERCE_ADS === "true";

const GlobalUiComponent = ({ network }) => {
  const [label,setLabel]=useState("Today`s Ads")
  const [dateRangeLabel,setDateRangeLabel]=useState("")
  const data = useOutletContext();
  const { selectedDates, isApply, setIsApply } = data || {};
  const formatDateObject = (dateObj) => {
    const formatDate = (date) => {
      const d = new Date(date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
  
    return {
      from: formatDate(dateObj.startDate),
      to: formatDate(dateObj.endDate),
    };
  };

  const formatSystemDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
   function getDateRangeLabel({ from, to }) {
    const now = new Date();
    const fromDate = new Date(from);
    const toDate = new Date(to);
  
    // Normalize all dates to midnight
    const normalize = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  
    const today = normalize(now);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const fromNorm = normalize(fromDate);
    const toNorm = normalize(toDate);

    if (fromNorm.getTime() === today.getTime() && toNorm.getTime() === today.getTime()) {
      return "Today`s Ads";
    }

    if (fromNorm.getTime() === yesterday.getTime() && toNorm.getTime() === yesterday.getTime()) {
      return "Yesterday`s Ads";
    }

    // For any other date / date-range, use a generic label. The actual
    // selected date or range is shown beneath the label in each card.
    return "Ads";
  }
 
  const { sidebarOpen } = useContext(AdminContext);
  const dispatch = useDispatch();
  const {
    searchResultCounts,
    searchResultCountsScroll,
    searchResultCountsPython,
    searchResultCountsMeta,
    searchResultTotalAdsCount,
    searchResultCountsTiktok,
    searchResultRangeCounts,
    searchSourceCount,
    searchPositionCount,
    searchAdsCountGraph,
  } = useSelector((state) => state.adsgpt);
  //Api Call
  const { loadingSystemData,loadingAccoutData,adsAffiliateData,adsEcommerceplatFormsData, countData, countryData, funnelData,nextCursorForAffiliateData,nextCursorForFunnel,nextCursorForEcommerce,cursorStackForEcommerce,cursorStackForFunnel,cursorStackForAffiliateData,systemDetails,perticularSystemDetails,systemAccountDetails } =
  useSelector((state) => state.poweradspy);

const [tabs, setTabs] = useState([]);
const [systemStatusFilter, setSystemStatusFilter] = useState('all'); // all | active | inactive (System Analytics tiles)
const [searchTerm, setSearchTerm] = useState('');
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

function calculateDaysInclusive(fromDate, toDate) {
  const date1 = new Date(fromDate);
  const date2 = new Date(toDate);
  date1.setHours(0, 0, 0, 0);
  date2.setHours(0, 0, 0, 0);
  return Math.abs(date2 - date1) / (1000 * 60 * 60 * 24) + 1;
}
  useEffect(() => {
    if (!network) return;
    const endDate = new Date(selectedDates.endDate);
    endDate.setDate(endDate.getDate() + 1);
    const body = { network, type: null, range:formatDateObject(selectedDates)??null, search_after: null };
    const playload = { network:network=="google"?"gtext":network, range:{
      "from": formatSystemDate(selectedDates?.startDate),
      "to": formatSystemDate(selectedDates?.endDate)
    }, mode: "test","steps": calculateDaysInclusive(selectedDates?.startDate, selectedDates?.endDate) };

    let promises = [];
    const fetchAllData = async () => {
      try {
        if (network !== "tiktok") {
          setLabel(getDateRangeLabel(formatDateObject(selectedDates)));
          setDateRangeLabel(formatDateObject(selectedDates));
          promises = [
            dispatch(fetchAdsFromEcommerceplatforms(body)),
            dispatch(fetchAdsFromAffiliateplatforms(body)),
            dispatch(fetchNetworkTypesCount(body)),
            dispatch(fetchNetworksCountries(body)),
            dispatch(fetchAdsFromFunnel(body)),
            dispatch(fetchSystemDetails(playload)),
          ];
          await Promise.all(promises);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      }
      finally {
        setIsApply(false); // reset flag
      }
    };
    fetchAllData();

    return () => {
      promises.forEach((p) => p.abort?.());
    };
  }, [dispatch, network, isApply, selectedDates, setIsApply]);

  useEffect(() => {
    if (!(network && systemDetails && systemDetails.data && tabs.length > 0)) return;
    const activeTab = tabs.find(item => item.isActive);
    if (!activeTab) return;
    const endDate = new Date(selectedDates.endDate);
    endDate.setDate(endDate.getDate() + 1);
    const systemPayload = {
      range: {
        "from": formatSystemDate(selectedDates?.startDate),
        "to": formatSystemDate(selectedDates?.endDate)
      },
      network: network=="google"?"gtext":network,
      system: activeTab.name, // Use active tab's name
      mode: "test",
      steps: calculateDaysInclusive(selectedDates?.startDate, selectedDates?.endDate)
    };

    let promises = [];
    const fetchAllData = async () => {
      try {
        if (network !== "tiktok") {
          promises = [
            dispatch(fetchPerticularSystemDetails(systemPayload)),
            dispatch(fetchPerticularSystemAccountDetails(systemPayload)),
          ];
          await Promise.all(promises);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setIsApply?.(false); // Safely reset flag
      }
    };
    fetchAllData();

    return () => {
      promises.forEach((p) => p.abort?.());
    };
  }, [dispatch, network, systemDetails, tabs, setIsApply, selectedDates]);

  useEffect(() => {
    if (!network) return;
    const totalAdsCount= {
      network: network,
      keyword: "",
      domain: "",
      advertiser: ""
    };

    let promises = [];
    const fetchAllData = async () => {
      try {
        if (network !== "tiktok") {
          promises = [dispatch(fetchTotalAdsCount(totalAdsCount))];
          await Promise.all(promises);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      }
      finally {
        setIsApply(false); // reset flag
      }
    };
    fetchAllData();

    return () => {
      promises.forEach((p) => p.abort?.());
    };
  }, [dispatch, network, isApply, setIsApply]);

  useEffect(() => {
    const isValidData = Array.isArray(searchResultCountsTiktok?.data) && searchResultCountsTiktok.data.length > 0;
  
    const fetchAllData = async () => {
      const rangeTotal = searchResultCountsTiktok.data.find(item => item?.platform === "range_total");
      if (!rangeTotal) return;
  
      const newCountData = {
        data: rangeTotal.total_ads===0 ?[]:[{ category: "VIDEO", value: rangeTotal.total_ads }],
        network: "tiktok",
      };
  
      const newPositionCount = {
        data: rangeTotal.total_ads===0 ?[]:[{ position: "FEED", count: rangeTotal.total_ads }],
        network: "tiktok",
      };
  
      const newSourceCount = {
        data:rangeTotal.total_ads===0 ?[]:[{ source: "firstSeenOnDesktop", count: rangeTotal.total_ads }],
        network: "tiktok",
      };
  
      try {
        if (network === "tiktok") {
          await Promise.all([
            dispatch(updateSearchSourceCount(newSourceCount)),
            dispatch(updateSearchPositionCount(newPositionCount)),
            dispatch(updateCountData(newCountData)),
          ]);
        }
      } catch (error) {
        console.error("Error dispatching counts:", error);
      } finally {
        setIsApply(false); // reset flag
      }
    };
    if (isValidData && network === "tiktok") {
      fetchAllData();
    }
  }, [searchResultCountsTiktok, isApply, network, dispatch, setIsApply]);
  

  const handleFetchAds = useCallback(() => {
    if (network == "tiktok") {
      const payload = {
        network: "tiktok",
        adSeen: "",
        range:formatDateObject(selectedDates)??""
      };
      const payloadGraph = {
        network: "tiktok",
        range: formatDateObject(selectedDates)??"",
      };
      setLabel(getDateRangeLabel(formatDateObject(selectedDates)));
      setDateRangeLabel(formatDateObject(selectedDates));
      const promises = [
        dispatch(fetchTiktokAdsCount(payload)),
        dispatch(fetchTiktokAdsGraphCount(payloadGraph)),
        dispatch(fetchTiktokAdsCountryCount(payloadGraph)),
      ];
      setIsApply(false);
      return promises;
    } else {
      const payload = {
        network: network,
        platform:"3",
        range:  formatDateObject(selectedDates)??"",
        search_after: null,
      };
      const scrollPayload = {
        network: network,
        platform:"10",
        range:  formatDateObject(selectedDates)??"",
        search_after: null,
      };
      const pythonPayload = {
        network: network,
        platform:"12",
        range:  formatDateObject(selectedDates)??"",
        search_after: null,
      };
      const sourcePayload = {
        network: network,
        source: "",
        range: formatDateObject(selectedDates)??"",
        search_after: null,
      };
      const metaPayload = {
        network: network,
        platform:"15",
        range:  formatDateObject(selectedDates)??"",
        search_after: null,
      };
      const rangeCountsPayload = {
        network: network,
        range: formatDateObject(selectedDates) ?? "",
      };
      const promises = [
        dispatch(fetchAdsCount(payload)),
        dispatch(fetchAdsCountScroll(scrollPayload)),
        dispatch(fetchAdsCountPython(pythonPayload)),
        dispatch(fetchAdsCountMeta(metaPayload)),
        dispatch(fetchAdSourceCount(sourcePayload)),
        dispatch(fetchAdPositionCount(sourcePayload)),
        dispatch(fetchAdsGraphCount(sourcePayload)),
        dispatch(fetchRangeCounts(rangeCountsPayload)),
      ];
      setIsApply(false);
      return promises;
    }
  }, [dispatch, network, selectedDates, setIsApply]);


  useEffect(() => {
    const promises = handleFetchAds();
    return () => {
      promises?.forEach((p) => p.abort?.());
    };
  }, [handleFetchAds, isApply]);

  const handleSearchSubmit = () => {
    const activeTab = tabs.find(tab => tab.isActive);
    const endDate = new Date(selectedDates.endDate);
    if (activeTab) {
      const systemplayload = {
        range: formatDateObject(selectedDates) ?? null,
        network: network,
        system: activeTab.name,
        mode: "test",
        steps: getHoursBetweenDates(selectedDates?.startDate, endDate) / 12 
      };
      dispatch(fetchPerticularSystemDetails(systemplayload));
    }
  };


  useEffect(()=>{
    const hostnames = systemDetails?.data?.hostnames || {};
    setSystemStatusFilter('all'); // reset tile filter whenever the system list reloads
    setTabs([
      // Handle active systems (with empty array fallback)
      ...(systemDetails?.data?.active_systems || []).map((name,index) => ({
        name,
        hostname: hostnames[name] || null,
        status:"Active",
        isActive: index===0
      })),
      // Handle inactive systems (with empty array fallback)
      ...(systemDetails?.data?.inactive_systems || []).map(name => ({
        name,
        hostname: hostnames[name] || null,
        status:"inActive",
        isActive: false
      }))
    ])
  },[systemDetails])

  const handleSetTabActive = clickedTab => {
    setTabs(prev =>
      prev.map(tab => ({
        ...tab,
        isActive: tab.name === clickedTab.name,
      }))
    );
  };

  // Total / Active / Inactive tiles → filter the system tab list and select the
  // first matching system so the detail panel below follows the selection.
  const applySystemFilter = (filter) => {
    setSystemStatusFilter(filter);
    setTabs(prev => {
      const matches = t => filter === 'all' || (filter === 'active' ? t.status === 'Active' : t.status === 'inActive');
      const firstVisible = prev.find(matches);
      return prev.map(t => ({ ...t, isActive: firstVisible ? t.name === firstVisible.name : false }));
    });
  };
  const visibleTabs = tabs.filter(t =>
    systemStatusFilter === 'all' || (systemStatusFilter === 'active' ? t.status === 'Active' : t.status === 'inActive')
  );


  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchTerm) {
        const searchTermLower = searchTerm.toLowerCase();
        setTabs(prev =>
          prev.map(tab => ({
            ...tab,
            isActive: tab.name.toLowerCase().includes(searchTermLower)
          }))
        );
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  const handleSetTabActiveBySearch = (e) => {
    setSearchTerm(e.target.value);
  };

  const handleNext = () => {
    if (nextCursorForFunnel) {
      dispatch(fetchAdsFromFunnel({
        network,
        type: null,
        range: formatDateObject(selectedDates) ?? null,
        cursor: nextCursorForFunnel,
        isPrev: false,
      }));
    }
  };
  const handlePrev = () => {
    if (cursorStackForFunnel.length > 0) {
      const prevCursor = cursorStackForFunnel[cursorStackForFunnel.length - 1]; // peek last
      dispatch(fetchAdsFromFunnel({
        network,
        type: null,
        range: formatDateObject(selectedDates) ?? null,
        cursor: cursorStackForFunnel.length<2? null:prevCursor,
        isPrev: true,
      }));
    }
  };
  const handleNextEcommerce = () => {
    if (nextCursorForEcommerce) {
      dispatch(fetchAdsFromEcommerceplatforms({
        network,
        type: null,
        range: formatDateObject(selectedDates) ?? null,
        cursor: nextCursorForEcommerce,
        isPrev: false,
      }));
    }
  };
  
  
  const handlePrevEcommerce = () => {
    if (cursorStackForEcommerce.length > 0) {
      const prevCursor = cursorStackForEcommerce[cursorStackForEcommerce.length - 1]; // peek last
      dispatch(fetchAdsFromEcommerceplatforms({
        network,
        type: null,
        range: formatDateObject(selectedDates) ?? null,
        cursor: cursorStackForEcommerce.length<2? null:prevCursor,
        isPrev: true,
      }));
    }
  };
  const handleNextAffiliateData = () => {
    if (nextCursorForAffiliateData) {
      dispatch(fetchAdsFromAffiliateplatforms({
        network,
        type: null,
        range: formatDateObject(selectedDates) ?? null,
        cursor: nextCursorForAffiliateData,
        isPrev: false,
      }));
    }
  };
  
  
  const handlePrevAffiliateData = () => {
    if (cursorStackForAffiliateData.length > 0) {
      const prevCursor = cursorStackForAffiliateData[cursorStackForAffiliateData.length - 1]; // peek last
      dispatch(fetchAdsFromAffiliateplatforms({
        network,
        type: null,
        range: formatDateObject(selectedDates) ?? null,
        cursor: cursorStackForAffiliateData.length<2? null:prevCursor,
        isPrev: true,
      }));
    }
  };


  const formatDateInfo = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };
  function tooltipTextData(title){
    const isSameDate = dateRangeLabel.from === dateRangeLabel.to;
    return isSameDate
      ? `Showing ${title} Count for ${formatDateInfo(dateRangeLabel.from)}`
      : `Showing ${title} Count from ${formatDateInfo(dateRangeLabel.from)} to ${formatDateInfo(dateRangeLabel.to)}`;
  }

  const formatDate = (dateString) => {
 
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  };

  function formatSecondsToHrsMin(seconds) {
    const hrs = Math.floor(seconds / 3600); // 1 hour = 3600 seconds
    const mins = Math.floor((seconds % 3600) / 60); // Remaining seconds → minutes
  
    // Pad with leading zeros (e.g., "9" → "09")
    const formattedHrs = String(hrs).padStart(2, '0');
    const formattedMins = String(mins).padStart(2, '0');
  
    return `${formattedHrs} Hrs ${formattedMins} Min`;
  }

  function formatUnixTimestamp(timestamp) {
    // Convert Unix timestamp (seconds) to milliseconds
    const date = new Date(timestamp * 1000);
  
    // Format to '10:40 AM' (12-hour format without seconds)
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  function convertPercentageToGB(percentage, totalRAM = 16) {
    return (percentage / 100) * totalRAM;
  }
  return (
    <div className="flex flex-col  mt-[18px]">
      {/* <div className="text-[30px] font-[600] text-[#264688] capitalize">{network}</div> */}
      <div className="flex flex-col gap-[25px] mt-[25px]">
        <div className="grid grid-cols-3 xl:gap-[12px] gap-[25px] xl:h-[372px]">
          <div className="xl:col-span-2 col-span-3 bg-[#fff]  rounded-[20px] pb-[42px] px-[12px] pt-[24px] flex flex-col justify-between">
            <div className="text-[30px] font-[700] text-[#264688] pl-[10px]">
              Total Ads
            </div>
            {network != "tiktok" ? (
              <p className="text-[52px] font-[700]  text-purple-600 pl-[10px] relative">
                {searchResultTotalAdsCount != null &&
                searchResultTotalAdsCount.network === network ? (
                  searchResultTotalAdsCount?.data
                ) : (
                  <CountLoder className="absolute left-0" />
                )}
              </p>
            ) : (
              <p className="text-[52px] font-[700]  text-purple-600 pl-[16px] relative">
                {Array.isArray(searchResultCountsTiktok?.data)&&
                searchResultCountsTiktok.network === network ? (
                  searchResultCountsTiktok?.data?.find(
                    (item) => item?.platform == "Total"
                  )?.total_ads
                ) : (
                  <CountLoder className="absolute left-0" />
                )}
              </p>
            )}

            <div className="grid grid-cols-6 gap-[12px] mt-4 sm:h-[136px] h-auto">
              {/* Today's Ads (Q2: new ads from main table, first_seen in range) */}
              {network != "tiktok" ? (
                searchResultRangeCounts?.data &&
                searchResultRangeCounts?.network === network ? (
                  <div className="bg-yellow-100 px-[8px] pt-[16px] pb-[28px] flex flex-col justify-between sm:col-span-1 col-span-2 rounded-xl text-center">
                    <div className="w-full flex justify-around items-center">
                      <p className="text-[14px] font-[500] text-[#ff8800]">
                        {label.replace(/Ads$/, "Unique Ads")}
                      </p>
                    </div>
                    <div className="w-full flex justify-around items-center">
                      <p className="text-[11px] font-[400] text-[#575757]">
                        {dateRangeLabel.from === dateRangeLabel.to
                          ? formatDate(dateRangeLabel.from)
                          : `${formatDate(dateRangeLabel.from)} ~ ${formatDate(
                              dateRangeLabel.to
                            )}`}
                      </p>
                    </div>

                    <p className="text-[36px] font-[700] text-yellow-600">
                      {Number(searchResultRangeCounts?.data?.newCount || 0)}
                    </p>
                  </div>
                ) : (
                  <div className="p-3 h-full w-full flex flex-col justify-center items-center relative animate-pulse bg-gray-200 rounded-lg"></div>
                )
              ) : Array.isArray(searchResultCountsTiktok?.data)&&
                searchResultCountsTiktok?.network === network ? (
                <div className="bg-yellow-100 px-[8px] pt-[16px] pb-[28px] flex flex-col justify-between sm:col-span-1 col-span-2 rounded-xl text-center">
                  <div className="w-full flex justify-around items-center">
                    <p className="text-[14px] font-[500] text-[#ff8800]">
                      {label.replace(/Ads$/, "Unique Ads")}
                    </p>
                  </div>
                  <div className="w-full flex justify-around items-center">
                    <p className="text-[11px] font-[400] text-[#575757]">
                      {dateRangeLabel.from === dateRangeLabel.to
                        ? formatDate(dateRangeLabel.from)
                        : `${formatDate(dateRangeLabel.from)} ~ ${formatDate(
                            dateRangeLabel.to
                          )}`}
                    </p>
                  </div>

                  <p className="text-[36px] font-[700] text-yellow-600">
                    {(Array.isArray(searchResultCountsTiktok?.data)&&
                      searchResultCountsTiktok.network === network &&
                      searchResultCountsTiktok?.data?.find(
                        (item) => item?.platform == "range_total"
                      )?.total_ads) ||
                      0}
                  </p>
                </div>
              ) : (
                <div className="p-3 h-full w-full flex flex-col justify-center items-center relative animate-pulse bg-gray-200 rounded-lg"></div>
              )}

              {/* User Plugin */}
              {network != "tiktok" ? (
                searchResultCounts.data &&
                searchResultCounts.network === network ? (
                  <>
                    <div className="bg-pink-100 px-[8px] pt-[16px] pb-[28px] flex flex-col justify-between sm:col-span-1 col-span-2 rounded-xl text-center relative">
                      <div className="w-full flex justify-around items-center">
                        <p className="text-sm text-gray-500">User Plugin</p>
                        {/* <span className="absolute top-2 right-2 bg-pink-500 text-white text-xs px-2 py-1 rounded-full">
                      3
                    </span> */}
                      </div>
                      <p className="text-[36px] font-[700] text-pink-600">
                        {(searchResultCounts.data &&
                          searchResultCounts.network === network &&
                          searchResultCounts?.data?.find(
                            (item) => item?.platform == "3"
                          )?.total_ads) ||
                          0}
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="p-3 h-full w-full flex flex-col justify-center items-center relative animate-pulse bg-gray-200 rounded-lg"></div>
                )
              ) : searchResultCountsTiktok.data &&
                searchResultCountsTiktok.network === network ? (
                <>
                  <div className="bg-pink-100 px-[8px] pt-[16px] pb-[28px] flex flex-col justify-between sm:col-span-1 col-span-2 rounded-xl text-center relative">
                    <div className="w-full flex justify-around items-center">
                      <p className="text-sm text-gray-500">User Plugin</p>
                      {/* <span className="absolute top-2 right-2 bg-pink-500 text-white text-xs px-2 py-1 rounded-full">
                        3
                      </span> */}
                    </div>
                    <p className="text-[36px] font-[700] text-pink-600">
                      {(Array.isArray(searchResultCountsTiktok?.data) &&
                        searchResultCountsTiktok.network === network &&
                        searchResultCountsTiktok?.data?.find(
                          (item) => item?.platform == "3"
                        )?.total_ads) ||
                        0}
                    </p>
                  </div>
                </>
              ) : (
                <div className="p-3 h-full w-full flex flex-col justify-center items-center relative animate-pulse bg-gray-200 rounded-lg"></div>
              )}

              {/* Scroll Plugin */}

              {network != "tiktok" ? (
                searchResultCountsScroll.data &&
                searchResultCountsScroll.network === network ? (
                  <div className="bg-green-100 px-[8px] pt-[16px] pb-[28px] flex flex-col justify-between sm:col-span-1 col-span-2 rounded-xl text-center relative">
                    <div className="w-full flex justify-around items-center">
                      <p className="text-sm text-gray-500">Scroll Plugin</p>
                      {/* <span className="absolute top-2 right-2 bg-green-500 text-white text-xs px-2 py-1 rounded-full">
                    10
                  </span> */}
                    </div>
                    <p className="text-[36px] font-[700] text-green-600">
                      {(searchResultCountsScroll.data &&
                        searchResultCountsScroll.network === network &&
                        searchResultCountsScroll?.data?.find(
                          (item) => item?.platform == "10"
                        )?.total_ads) ||
                        0}
                    </p>
                  </div>
                ) : (
                  <div className="p-3 h-full w-full flex flex-col justify-center items-center relative animate-pulse bg-gray-200 rounded-lg"></div>
                )
              ) : searchResultCountsTiktok.data &&
                searchResultCountsTiktok.network === network ? (
                <div className="bg-green-100 px-[8px] pt-[16px] pb-[28px] flex flex-col justify-between sm:col-span-1 col-span-2 rounded-xl text-center relative">
                  <div className="w-full flex justify-around items-center">
                    <p className="text-sm text-gray-500">Scroll Plugin</p>
                    {/* <span className="absolute top-2 right-2 bg-green-500 text-white text-xs px-2 py-1 rounded-full">
                      10
                    </span> */}
                  </div>
                  <p className="text-[36px] font-[700] text-green-600">
                    {(Array.isArray(searchResultCountsTiktok?.data) &&
                      searchResultCountsTiktok.network === network &&
                      searchResultCountsTiktok?.data?.find(
                        (item) => item?.platform == "10"
                      )?.total_ads) ||
                      0}
                  </p>
                </div>
              ) : (
                <div className="p-3 h-full w-full flex flex-col justify-center items-center relative animate-pulse bg-gray-200 rounded-lg"></div>
              )}

              {/* Python Crawler */}
              {network != "tiktok" ? (
                searchResultCountsPython.data &&
                searchResultCountsPython.network === network ? (
                  <div className="bg-red-100 px-[8px] pt-[16px] pb-[28px] flex flex-col justify-between sm:col-span-1 col-span-2 rounded-xl text-center relative">
                    <p className="text-sm text-gray-500">Python Crawler</p>
                    {/* <span className="absolute top-2 right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full">
                  12
                </span> */}
                    <p className="text-[36px] font-[700] text-red-600">
                      {(searchResultCountsPython.data &&
                        searchResultCountsPython.network === network &&
                        searchResultCountsPython?.data?.find(
                          (item) => item?.platform == "12"
                        )?.total_ads) ||
                        0}
                    </p>
                  </div>
                ) : (
                  <div className="p-3 h-full w-full flex flex-col justify-center items-center relative animate-pulse bg-gray-200 rounded-lg"></div>
                )
              ) : searchResultCountsTiktok.data &&
                searchResultCountsTiktok.network === network ? (
                <div className="bg-red-100 px-[8px] pt-[16px] pb-[28px] flex flex-col justify-between sm:col-span-1 col-span-2 rounded-xl text-center relative">
                  <p className="text-sm text-gray-500">Python Crawler</p>
                  {/* <span className="absolute top-2 right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full">
                    12
                  </span> */}
                  <p className="text-[36px] font-[700] text-red-600">
                    {(Array.isArray(searchResultCountsTiktok?.data)&&
                      searchResultCountsTiktok?.network === network &&
                      searchResultCountsTiktok?.data?.find(
                        (item) => item?.platform == "12"
                      )?.total_ads) ||
                      0}
                  </p>
                </div>
              ) : (
                <div className="p-3 h-full w-full flex flex-col justify-center items-center relative animate-pulse bg-gray-200 rounded-lg"></div>
              )}

              {/* Meta Plugin  */}
              {network != "tiktok" ? (
                searchResultCountsMeta.data &&
                searchResultCountsMeta.network === network ? (
                  <div className="bg-blue-100 px-[8px] pt-[16px] pb-[28px] flex flex-col justify-between sm:col-span-1 col-span-2 rounded-xl text-center relative">
                    <div className="w-full flex justify-around items-center">
                      <p className="text-sm text-gray-500">Meta Plugin</p>
                    </div>
                    <p className="text-[36px] font-[700] text-blue-600">
                      {(searchResultCountsMeta.data &&
                        searchResultCountsMeta.network === network &&
                        searchResultCountsMeta?.data?.find(
                          (item) => item?.platform == "15"
                        )?.total_ads) ||
                        0}
                    </p>
                  </div>
                ) : (
                  <div className="p-3 h-full w-full flex flex-col justify-center items-center relative animate-pulse bg-gray-200 rounded-lg"></div>
                )
              ) : searchResultCountsTiktok.data &&
                searchResultCountsTiktok.network === network ? (
                <div className="bg-blue-100 px-[8px] pt-[16px] pb-[28px] flex flex-col justify-between sm:col-span-1 col-span-2 rounded-xl text-center relative">
                  <div className="w-full flex justify-around items-center">
                    <p className="text-sm text-gray-500">Meta Plugin</p>
                  </div>
                  <p className="text-[36px] font-[700] text-blue-600">
                    {(Array.isArray(searchResultCountsTiktok?.data) &&
                      searchResultCountsTiktok.network === network &&
                      searchResultCountsTiktok?.data?.find(
                        (item) => item?.platform == "15"
                      )?.total_ads) ||
                      0}
                  </p>
                </div>
              ) : (
                <div className="p-3 h-full w-full flex flex-col justify-center items-center relative animate-pulse bg-gray-200 rounded-lg"></div>
              )}

              {/* <Label> Total Ads (Q3: ads still active in range — main table, last_seen) */}
              {network != "tiktok" ? (
                searchResultRangeCounts?.data &&
                searchResultRangeCounts?.network === network ? (
                  <div className="bg-purple-100 px-[8px] pt-[16px] pb-[28px] flex flex-col justify-between sm:col-span-1 col-span-2 rounded-xl text-center">
                    <div className="w-full flex justify-around items-center">
                      <p className="text-[14px] font-[500] text-purple-600">
                        {label.replace(/Ads$/, "Total Ads")}
                      </p>
                    </div>
                    <div className="w-full flex justify-around items-center">
                      <p className="text-[11px] font-[400] text-[#575757]">
                        {dateRangeLabel.from === dateRangeLabel.to
                          ? formatDate(dateRangeLabel.from)
                          : `${formatDate(dateRangeLabel.from)} ~ ${formatDate(
                              dateRangeLabel.to
                            )}`}
                      </p>
                    </div>
                    <p className="text-[36px] font-[700] text-purple-600">
                      {Number(searchResultRangeCounts?.data?.activeCount || 0)}
                    </p>
                  </div>
                ) : (
                  <div className="p-3 h-full w-full flex flex-col justify-center items-center relative animate-pulse bg-gray-200 rounded-lg"></div>
                )
              ) : (
                <div className="p-3 h-full w-full flex flex-col justify-center items-center relative animate-pulse bg-gray-200 rounded-lg"></div>
              )}
            </div>
          </div>
          <div className="xl:col-span-1 col-span-3 bg-white rounded-[20px]">
            <div className="border-b-[0.75px] border-[#e5e5ef] pl-[24px] pt-[18px] pb-[10px] text-[15px] font-[700] text-[#264688]">
              Graph
            </div>
            {searchAdsCountGraph?.data?.length !== 0 ? (
              searchAdsCountGraph.data &&
              searchAdsCountGraph.network === network ? (
                <GraphCrawlerChart graph={searchAdsCountGraph.data} />
              ) : (
                <div className="flex bg-white rounded-lg w-full shadow-none border-none">
                  <div className="p-3 xl:h-[307px] w-full flex flex-col justify-center items-center relative animate-pulse bg-gray-200 rounded-bl-[9px] rounded-br-[9px]"></div>
                </div>
              )
            ) : (
              <div className="flex  bg-white rounded-lg w-full shadow-none border-none">
                <div className="p-3 h-[240px] w-full flex flex-col justify-center items-center text-[#264688] relative bg-gray-200">
                  Data Not Found
                </div>
              </div>
            )}
          </div>
        </div>
        {
          (network==="facebook"||network==="instagram"||network==="google")&&
          <div className="w-full flex flex-col gap-[18px]">
          <p className="font-[600] text-[30px] text-[#264688]">
            System Analytics
          </p>
          <div className="flex xl:items-center xl:justify-between w-full xl:flex-row flex-col gap-[24px] xl:gap-0">
            <div className="flex gap-[14px] xl:w-[60%] sm:flex-row flex-col">
              <div
                onClick={() => applySystemFilter('all')}
                className={`h-[68px] w-[283px] xl:w-[calc(60%-7px)] bg-[#fff6d9] px-[24px] flex justify-between items-center !rounded-[10px] cursor-pointer transition-shadow ${systemStatusFilter === 'all' ? 'ring-2 ring-[#3F51B5]' : 'hover:shadow-md'}`}
              >

                <span className="font-[600] text-[17px] text-[#1e1b39]">
                  Total Systems
                </span>
                {
                loadingSystemData?<span className="bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent text-[26px] font-[700]">
                0
              </span>:<span className="bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent text-[26px] font-[700]">
                  {systemDetails?.data?.active_systems?.length + systemDetails?.data?.inactive_systems?.length}
                </span>
               }
                
              </div>
                <div
                  onClick={() => applySystemFilter('active')}
                  className={`h-[68px] w-[283px] xl:w-[calc(60%-7px)] bg-[#d6fdaf] px-[24px] flex justify-between items-center !rounded-[10px] cursor-pointer transition-shadow ${systemStatusFilter === 'active' ? 'ring-2 ring-[#3F51B5]' : 'hover:shadow-md'}`}
                >
                  <span className="font-[600] text-[17px] text-[#1e1b39]">
                    Active Systems
                  </span>
                  <span className="bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent text-[26px] font-[700]">
                    {systemDetails?.data?.active_systems?.length}
                  </span>
                </div>
                <div
                  onClick={() => applySystemFilter('inactive')}
                  className={`h-[68px] w-[283px] xl:w-[calc(60%-7px)] bg-[#feb999] px-[24px] flex justify-between items-center !rounded-[10px] cursor-pointer transition-shadow ${systemStatusFilter === 'inactive' ? 'ring-2 ring-[#3F51B5]' : 'hover:shadow-md'}`}
                >
                  <span className="font-[600] text-[17px] text-[#1e1b39]">
                    Inactive Systems
                  </span>
                  <span className="bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent text-[26px] font-[700]">
                    {systemDetails?.data?.inactive_systems?.length}
                  </span>
                </div>
              {/* <div className="h-[68px] w-[283px] xl:w-[calc(50%-7px)] bg-[#e7efff] px-[24px] flex justify-between items-center !rounded-[10px]">
                <span className="font-[600] text-[17px] text-[#1e1b39]">
                  Total Ads
                </span>
                <span className="bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent text-[26px] font-[700]">
                  24,37,800
                </span>
              </div> */}
            </div>
            <div className="flex gap-[18px] items-center w-[290px] xl:w-[25%] h-[52px] border-[1.5px] border-[#E0E0E0] rounded-[12px] px-[14px] py-[11px] shadow-sm bg-white">
              <FaSearch className="text-[#575757] text-[30px]" onClick={handleSearchSubmit}/>
              <input
                type="text"
                placeholder="Search System Name"
                className="ml-3 w-full border-none outline-none placeholder-gray-500 text-base bg-transparent"
                // onChange={(e)=>{handleSetTabActiveBySearch(e.target.value)}}
                // onKeyDown={(e) => {
                //   if (e.key === 'Enter') {
                //     handleSearchSubmit();
                //   }
                // }}
                onChange={handleSetTabActiveBySearch}
                value={searchTerm}
              />
            </div>
          </div>

          <div className="w-full xl:h-[100%] bg-white rounded-[20px]">
            <div className="w-full h-[98px] border-b-[2px] border-[#e8e8e8] px-[32px]">
              <TabSlider tabs={visibleTabs} handleSetTabActive={handleSetTabActive} systemDetails={systemDetails} loadingSystemData={loadingSystemData}/>
            </div>
            {loadingAccoutData?<SystemDetailsShimmer/>: 
            <div className="h-[calc(100%-98px)] w-full sm:px-[36px] py-[24px] flex flex-col px-[16px]">
              <div className="flex gap-[16px] items-center">
                <img src={Locationpng} alt="" />
                <span className="text-[14px] font-[500] text-[#1e1b39]">
                  Bhilai, Chhattisgarh
                </span>
              </div> 
              <div className="w-full pt-[24px] flex gap-[16px] xl:flex-row flex-col">
                 {/* Parent component (where you're displaying the stats and table) */}
                <div className="2xl:w-[54%] xl:w-[58%] w-[100%]">
                  <div className="flex gap-[12px] sm:flex-row flex-col">
                    <div className="h-[68px] w-[283px] xl:w-[calc(50%-9px)] bg-[#fff6d9] px-[24px] flex justify-between items-center rounded-[10px]">
                      <span className="font-[600] text-[17px] text-[#1e1b39]">
                        Total Instances
                      </span>
                      <span className="bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent text-[26px] font-[700]">
                        {systemAccountDetails?.data?.plugin_count || 0}
                      </span>
                    </div>
                    <div className="h-[68px] w-[283px] xl:w-[calc(50%-9px)] bg-[#ffe5fd] px-[24px] flex justify-between items-center rounded-[10px]">
                      <span className="font-[600] text-[17px] text-[#1e1b39]">
                        Total Ads
                      </span>
                      <span className="bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent text-[26px] font-[700]">
                        {systemAccountDetails?.data?.total_ad_count?.toLocaleString() || 0}
                      </span>
                    </div>
                  </div>
                  <AccountWiseAdsTable accounts={systemAccountDetails?.data?.accounts || []} />
                </div>
                <div className="2xl:w-[46%] 2xl:pl-[48px] xl:pl-[24px] xl:w-[42%] w-[100%] mt-[16px] xl:mt-0">
                  <div className="w-full flex flex-col gap-[24px]">
                    <span className="!font-[500] !text-[22px] !text-[#1e1b39]">Runtime & Resource Details</span>
                  <div className="w-full flex sm:flex-row flex-col">
                    <div className="flex flex-col gap-[24px] text-sm text-gray-700 sm:w-[50%] w-full sm:border-r-[1px] border-[#e5e5ef]">
                      <div>
                        <p className="font-[400]  text-[16px] bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent "
                        >
                        <p className="w-fit" data-tooltip-id="online-tooltip"
                        data-tooltip-html={`
                        <p class="text-gray-800">Displays the current operational status of the system</p>
                      `}
                        data-tooltip-place="right">System Status</p>  
                          <Tooltip id="online-tooltip" className="bg-gray-200! !text-black !shadow-lg !rounded-md !p-3 !max-w-[250px]" />
                        </p>

                        <p className="font-[400] text-[14px] text-[#1f1f1f]">
                          {tabs.length>0?(perticularSystemDetails?.data?.metrics?.uptime?.status === "active" 
                            ? <span >Online <span className="text-[#3fc433]">●</span> </span> 
                            : <span>Offline <span className="text-red-500">●</span></span>) : "N/A"}
                        </p>
                      </div>
                      <div>
                        <p className="font-[400]  text-[16px] bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent">
                          CPU Cores
                        </p>
                        <p className="font-[400] text-[14px] text-[#1f1f1f]">
                          {tabs.length>0&&perticularSystemDetails?.data?.system_info?.cpu_cores
                            ? `${perticularSystemDetails?.data?.system_info?.cpu_cores}`
                            : "N/A"}
                        </p>
                      </div>
                      <div>
                        <p className="font-[400]  text-[16px] bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent ">
                          Up Time
                        </p>
                        <p className="font-[400] text-[14px] text-[#1f1f1f]">
                        {tabs.length>0?(perticularSystemDetails?.data?.metrics?.uptime?.last ? formatSecondsToHrsMin(perticularSystemDetails.data.metrics.uptime.last) : "00 Hrs 00 Min"):"N/A"}
                        </p>
                      </div>
                      <div>
                        <p className="font-[400]  text-[16px] bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent ">
                          RAM Consumption
                        </p>
                        <p className="font-[400] text-[14px] text-[#1f1f1f]">
                          {(tabs.length>0&&perticularSystemDetails?.data?.metrics?.ram?.values?.max && perticularSystemDetails?.data?.system_info?.total_ram?.value)
                            ? `${convertPercentageToGB(perticularSystemDetails.data.metrics.ram.values.max, perticularSystemDetails?.data?.system_info?.total_ram?.value).toFixed(2)} GB / ${perticularSystemDetails?.data?.system_info?.total_ram?.value} GB` 
                            : "N/A"}
                        </p>
                      </div>
                      <div>
                        <p className="font-[400]  text-[16px] bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent ">
                          Data Consumption
                        </p>
                        <p className="font-[400] text-[14px] text-[#1f1f1f]">
                          {tabs.length>0?(perticularSystemDetails?.data?.metrics?.network?.max 
                            ? `${(perticularSystemDetails.data.metrics.network.max / 1024).toFixed(2)} GB` 
                            : "0.00 GB"):"N/A"}
                        </p>
                      </div>
                    </div>

                    {/* Right Column */}
                    <div className="flex flex-col gap-[24px] text-sm text-gray-700 sm:w-[50%] w-full 2xl:pl-[64px] xl:pl-[32px] md:pl-[64px] sm:pl-[32px]">
                      <div>
                        <p className="font-[400]  text-[16px] bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent ">
                          System Started
                        </p>
                        <p className="font-[400] text-[14px] text-[#1f1f1f]">
                          {(tabs.length>0&&perticularSystemDetails?.data?.metrics?.uptime?.last_timestamp)
                            ? formatUnixTimestamp(perticularSystemDetails.data.metrics.uptime.last_timestamp)
                            : "N/A"}
                        </p>
                      </div>
                      <div>
                        <p className="font-[400]  text-[16px] bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent ">
                          CPU Usage
                        </p>
                        <p className="font-[400] text-[14px] text-[#1f1f1f]">
                          {(tabs.length>0&&perticularSystemDetails?.data?.metrics?.cpu?.values?.avg )
                            ? `${perticularSystemDetails?.data?.metrics?.cpu?.values?.avg.toFixed(2)} %` 
                            : "N/A"}
                        </p>
                      </div>
                      <div>
                        <p className="font-[400]  text-[16px] bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent ">
                          Used Storage
                        </p>
                        <p className="font-[400] text-[14px] text-[#1f1f1f]">
                        {(tabs.length>0&&perticularSystemDetails?.data?.system_info?.disk_storage?.value)
                            ? `${perticularSystemDetails?.data?.system_info?.disk_storage?.value} GB` 
                            : "N/A"}
                        </p>
                      </div>
                      <div>
                        <p className="font-[400]  text-[16px] bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent ">
                          Processor Details
                        </p>
                        <p className="font-[400] text-[14px] text-[#1f1f1f]">
                          {(tabs.length>0&&perticularSystemDetails?.data?.system_info?.cpu_model)
                            ? perticularSystemDetails?.data?.system_info?.cpu_model
                            : "N/A"}
                        </p>
                      </div>
                    </div>
                  </div></div>
                  {/* <div className="flex flex-col mt-[32px]">
                    <span className="text-[16px] font-[400] bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent">System Performance Meter</span>
                  <RadarGaugeChart />
                  </div> */}
                </div>
              </div>
            </div>
            }
          </div>
        </div>
        }
     

        <div className="grid gap-[18px] grid-cols-2">
          <div className="bg-white rounded-[20px] xl:col-span-1 col-span-2 ">
          <Title className={"border-b-[0.75px] border-[#e5e5ef] text-[15px] font-[700] text-[#264688] pl-[24px] pt-[18px] pb-[10px] flex items-center justify-normal"} title={"Ad type"} tooltipText={tooltipTextData("Ad type")}/>
            {countData?.data?.length > 0 ? (
              countData?.data?.length > 0 &&
              countData?.data &&
              countData?.network === network ? (
                <AdTypeCrawlerChart
                  key={JSON.stringify(countData)}
                  countData={countData}
                />
              ) : (
                <div className="flex  bg-white rounded-lg w-full shadow-none border-none">
                  <div className="p-3 h-[240px] w-full flex flex-col justify-center items-center relative animate-pulse bg-gray-200 rounded-b-2xl"></div>
                </div>
              )
            ) : (
              <div className="flex  bg-white rounded-lg w-full shadow-none border-none">
                <div className="p-3 h-[240px] w-full flex flex-col justify-center items-center text-[#264688] relative bg-gray-200 rounded-b-2xl">
                  Data Not Found
                </div>
              </div>
            )}
          </div>
          <div className="bg-white rounded-[20px] xl:col-span-1 col-span-2 ">
          <Title className={"border-b-[0.75px] border-[#e5e5ef] text-[15px] font-[700] text-[#264688] pl-[24px] pt-[18px] pb-[10px] flex justify-normal items-center"} title={"Ad Position"} tooltipText={tooltipTextData("Ad Position")}/>
            {searchPositionCount?.data?.length > 0 ? (
              searchPositionCount?.data &&
              searchPositionCount?.network === network ? (
                <AdPositionCrawlerChart
                  key={JSON.stringify(searchPositionCount)}
                  position={searchPositionCount?.data}
                />
              ) : (
                <div className="p-3 h-[240px] w-full flex flex-col justify-center items-center relative animate-pulse bg-gray-200 rounded-b-2xl"></div>
              )
            ) : (
              <div className="flex  bg-white rounded-lg w-full shadow-none border-none">
                <div className="p-3 h-[240px] w-full flex flex-col justify-center items-center text-[#264688] relative bg-gray-200 rounded-b-2xl">
                  Data Not Found
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-5 xl:gap-[18px] gap-[25px]">
          <div className="xl:col-span-2 col-span-5">
            <div className="bg-white  rounded-[20px] shadow-md w-full h-full">
            <Title className={"border-b-[0.75px] border-[#e5e5ef] text-[15px] font-[700] text-[#264688] pl-[24px] pt-[18px] pb-[10px] flex justify-normal items-center"} title={"Ad Source"} tooltipText={tooltipTextData("Ad Source")}/>
              {searchSourceCount?.data?.length > 0 ? (
                searchSourceCount?.data &&
                searchSourceCount?.network === network ? (
                  <>
                    {/* SVG Circles */}
                    <div
                      className={`w-full mt-[42px] 2xl:pl-[24%] xl:pl-[20%] md:pl-[35%] sm:pl-[28%] pl-[16%]`}
                    >
                      <div
                        className={`sm:w-[220px] 2xl:w-[220px] 2xl:h-[220px] sm:h-[220px] w-[140px] h-[140px] rounded-full bg-[#94b7fb] flex justify-center items-center relative ${
                          sidebarOpen
                            ? "xl:w-[180px] xl:h-[180px] 2xl:w-[220px] 2xl:h-[220px]"
                            : ""
                        }`}
                      >
                        <span className="sm:text-[44px] text-[32px] font-[700] text-white">
                          {(searchSourceCount?.data &&
                            searchSourceCount?.network === network &&
                            searchSourceCount?.data?.find(
                              (item) => item?.source === "firstSeenOnDesktop"
                            )?.count) ||
                            0}
                        </span>
                        <div
                          className={`sm:w-[150px] sm:h-[150px] 2xl:w-[150px] 2xl:h-[150px] w-[98px] h-[98px] rounded-full bg-[#ffb25a] flex justify-center items-center absolute sm:right-[-108px] right-[-75px] border-[4px] border-white top-0 ${
                            sidebarOpen
                              ? "xl:w-[110px] xl:h-[110px] xl:right-[-88px]  2xl:right-[-108px] 2xl:w-[150px] 2xl:h-[150px]"
                              : ""
                          }`}
                        >
                          <span className="sm:text-[32px] text-[21px] font-[700] text-white">
                            {(searchSourceCount?.data &&
                              searchSourceCount?.network === network &&
                              searchSourceCount?.data?.find(
                                (item) => item?.source === "firstSeenOnAndroid"
                              )?.count) ||
                              0}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Labels */}
                    <div className="flex justify-center gap-4 my-4">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
                        <span className="text-sm text-gray-600">Desktop</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 bg-yellow-500 rounded-full"></span>
                        <span className="text-sm text-gray-600">Mobile</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="p-3 h-[240px] w-full flex flex-col justify-center items-center relative animate-pulse bg-gray-200 rounded-b-2xl"></div>
                )
              ) : (
                <div className="flex  bg-white rounded-lg w-full shadow-none border-none">
                  <div className="p-3 h-[240px] w-full flex flex-col justify-center items-center text-[#264688] relative bg-gray-200 rounded-b-2xl">
                    Data Not Found
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white xl:col-span-3 col-span-5 rounded-[20px]">
          <Title className={"border-b-[0.75px] border-[#e5e5ef] text-[15px] font-[700] text-[#264688] pl-[24px] pt-[18px] pb-[10px] flex justify-normal items-center"} title={"Country World Map"} tooltipText={tooltipTextData("Country World Map")}/>
            {countryData?.data?.length > 0 ? (
              countryData?.data && countryData?.network === network ? (
                <div className="px-[42px] pt-[24px] pb-[16px]">
                  {" "}
                  <CountryCrawlerChartMap
                    key={JSON.stringify(countryData)}
                    countryData={countryData}
                    network={network}
                  />
                </div>
              ) : (
                <div className="p-3 h-[240px] w-full flex flex-col justify-center items-center relative animate-pulse bg-gray-200 rounded-b-2xl"></div>
              )
            ) : (
              <div className="flex  bg-white rounded-lg w-full shadow-none border-none">
                <div className="p-3 h-[240px] w-full flex flex-col justify-center items-center text-[#264688] relative bg-gray-200 rounded-b-2xl">
                  Data Not Found
                </div>
              </div>
            )}
          </div>
        </div>
        {network !== "tiktok" && (
          <div className="crawler_insights_container flex flex-col gap-[25px] ">
            {SHOW_AFFILIATE_ADS && (
            <div className="common_chart_container common_box_shadow rounded-2xl bg-white">
              <div className=" flex justify-between border-b-[0.75px] border-[#e5e5ef] px-[24px] items-center">
              <Title className={" text-[15px] font-[700] text-[#264688]  pt-[18px] pb-[10px] flex justify-normal items-center"} title={"Ads from Affiliate Networks"} tooltipText={tooltipTextData("Ads from Affiliate Networks")}/>
            <div className=" gap-[5px] text-[#264688] text-[18px] flex items-center"><GrPrevious onClick={handlePrevAffiliateData}
               disabled={cursorStackForAffiliateData.length === 0}  className={`cursor-pointer transition-all duration-200 ${
                cursorStackForAffiliateData.length === 0
                  ? "text-gray-400 cursor-not-allowed"
                  : "text-[#264688] hover:text-[#1e3558] text-[23px] font-bold"
              }`}/>
              <GrNext  onClick={handleNextAffiliateData}
                disabled={!nextCursorForAffiliateData}   className={`cursor-pointer transition-all duration-200 ${
                  !nextCursorForAffiliateData
                    ? "text-gray-400 cursor-none"
                    : "text-[#264688] hover:text-[#1e3558] text-[23px] font-bold"
                }`}/></div>
              </div>
              {adsAffiliateData?.data?.length > 0 ? (
                adsAffiliateData?.data &&
                adsAffiliateData?.network === network ? (
                  <AffiliateNetworksStackedChart
                    key={JSON.stringify(adsAffiliateData)}
                    adsAffiliateData={adsAffiliateData}
                  />
                ) : (
                  <div className="p-3 h-[240px] w-full flex flex-col justify-center items-center relative animate-pulse bg-gray-200 rounded-b-2xl"></div>
                )
              ) : (
                <div className="flex  bg-white rounded-lg w-full shadow-none border-none">
                  <div className="p-3 h-[240px] w-full flex flex-col justify-center items-center text-[#264688] relative bg-gray-200 rounded-b-2xl">
                    Data Not Found
                  </div>
                </div>
              )}
            </div>
            )}
            {SHOW_FUNNEL_ADS && (
            <div className="common_chart_container common_box_shadow rounded-[20px] bg-white">
              <div className="heading_s border-b-[0.75px] border-[#e5e5ef] px-[24px] pb-[10px] pt-[18px] flex justify-between items-center">
              <Title className={"text-[15px] font-[700] text-[#264688] flex justify-normal items-center"} title={"Ads from Funnel"} tooltipText={tooltipTextData("Ads from Funnel")}/>
              <div className="flex gap-[5px] text-[#264688] text-[18px] flex items-center"><GrPrevious onClick={handlePrev}
               disabled={cursorStackForFunnel.length === 0}  className={`cursor-pointer transition-all duration-200 ${
                cursorStackForFunnel.length === 0
                  ? "text-gray-400 cursor-not-allowed"
                  : "text-[#264688] hover:text-[#1e3558] text-[23px] font-bold"
              }`}/>
              <GrNext  onClick={handleNext}
                disabled={!nextCursorForFunnel} className={`cursor-pointer transition-all duration-200 ${
                  !nextCursorForFunnel
                    ? "text-gray-400 cursor-none"
                    : "text-[#264688] hover:text-[#1e3558] text-[23px] font-bold"
                }`}/></div> 
              </div>
              {/* <hr className="opacity-10" /> */}
              {funnelData?.data?.length > 0 ? (
                funnelData?.data && funnelData?.network === network ? (
                  <FunnelAdsChart funnelData={funnelData} />
                ) : (
                  <div className="p-3 h-[240px] w-full flex flex-col justify-center items-center relative animate-pulse bg-gray-200 rounded-b-2xl"></div>
                )
              ) : (
                <div className="flex  bg-white rounded-lg w-full shadow-none border-none">
                  <div className="p-3 h-[240px] w-full flex flex-col justify-center items-center text-[#264688] relative bg-gray-200 rounded-b-2xl">
                    Data Not Found
                  </div>
                </div>
              )}
            </div>
            )}
          </div>
        )}

        {network !== "tiktok" && SHOW_ECOMMERCE_ADS && (
          <div className="w-full">
            <div className="bg-white rounded-[20px] shadow-md w-full">
              <div className="border-b-[0.75px] border-[#e5e5ef]  px-[24px] pt-[18px] pb-[10px] flex justify-between items-center">
              <Title className={"text-[15px] font-[700] text-[#264688] flex justify-normal items-center"} title={"Ads from Ecommerce platforms"} tooltipText={tooltipTextData("Ads from Ecommerce platforms")}/>
               <div className="flex gap-[5px] text-[#264688] text-[18px] flex items-center"><GrPrevious onClick={handlePrevEcommerce}
               disabled={cursorStackForEcommerce.length === 0}  className={`cursor-pointer transition-all duration-200 ${
                cursorStackForEcommerce.length === 0
                  ? "text-gray-400 cursor-not-allowed"
                  : "text-[#264688] hover:text-[#1e3558] text-[23px] font-bold"
              }`}/>
              <GrNext  onClick={handleNextEcommerce}
                disabled={!nextCursorForEcommerce}   className={`cursor-pointer transition-all duration-200 ${
                  !nextCursorForEcommerce
                    ? "text-gray-400 cursor-none"
                    : "text-[#264688] hover:text-[#1e3558] text-[23px] font-bold"
                }`}/></div>
              </div>
              {/* <hr className="opacity-10" /> */}
              {adsEcommerceplatFormsData?.data?.length > 0 ? (
                adsEcommerceplatFormsData?.data &&
                adsEcommerceplatFormsData?.network === network ? (
                  <div className=" pr-[48px] pl-[24px] py-[24px]">
                    {adsEcommerceplatFormsData?.data?.map((item, index) => (
                      <div
                        key={index}
                        className="flex items-center mb-[12px]"
                        data-tooltip-id="my-tooltip"
                        // data-tooltip-content={`${item.count} Ads`}
                        id="ecomplatformads"
                        data-tooltip-content={`${item.e_commerce} : ${item.count} Ads`}
                      >
                        <span className="w-50 text-[#575757] font-[400] text-[14px]">
                          {item.e_commerce}
                        </span>
                        <Slider
                          value={item.count}
                          min={0}
                          max={700}
                          disabled
                          sx={{
                            color: "#3B82F6", // Blue color
                            height: 12,
                            "& .MuiSlider-thumb": { display: "none" },
                          }}
                          className="flex-1"
                        />
                        <span className="ml-3 text-gray-600 text-sm">
                          {item.value}
                        </span>
                      </div>
                    ))}
                    {/* Tooltip should be placed outside the loop */}
                    <Tooltip
                      id="my-tooltip"
                      style={{
                        backgroundColor: "#fff", // Background color
                        color: "#264688", // Text color
                        fontSize: "14px",
                        fontWeight: "bold",
                        padding: "8px 12px",
                        borderRadius: "6px",
                        boxShadow: "0px 4px 10px rgba(0,0,0,0.2)",
                      }}
                      render={({ content }) => (
                        <div className="p-2 text-sm">
                          {/* <span className="font-bold text-[#575757]">Count:</span> */}
                          <span className="text-[#264688] ml-1">{content}</span>
                        </div>
                      )}
                    />
                  </div>
                ) : (
                  <div className="p-3 h-[240px] w-full flex flex-col justify-center items-center relative animate-pulse bg-gray-200"></div>
                )
              ) : (
                <div className="flex  bg-white rounded-lg w-full shadow-none border-none">
                  <div className="p-3 h-[240px] w-full flex flex-col justify-center items-center text-[#264688] relative bg-gray-200">
                    Data Not Found
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default GlobalUiComponent;
