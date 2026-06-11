import { flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table';
import React, { useCallback, useEffect, useState } from 'react';
import { CiSearch, CiFilter } from 'react-icons/ci';
import { FaAngleDoubleLeft, FaAngleDoubleRight, FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { fetchSystemInsites } from '../../store/actions/powerAdsPyActionsApi';
import { useDispatch, useSelector } from 'react-redux';

const SystemPerformanceTable = React.memo(({ columns, dateRange1, systemName,adsFilterPlatform }) => {
  const { loadingSystemInsites, SystemInsites } = useSelector((state) => state.poweradspy);
  const [networkDropdownOpen, setNetworkDropdownOpen] = useState(false);
  const [globalFilter, setGlobalFilter] = useState('');
  const [debouncedFilter, setDebouncedFilter] = useState('');
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 10,
  });
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [adsFilter, setAdsFilter] = useState({
    min: '',
    max: '',
    networks: [] // Now supports multiple network selection
  });
  // const [adsFilterPlatform, setAdsFilterPlatform] = useState({
  //   platform: [] // Now supports multiple network selection
  // });
  function calculateDaysInclusive(fromDate, toDate) {
    const date1 = new Date(fromDate);
    const date2 = new Date(toDate);
    date1.setHours(0, 0, 0, 0);
    date2.setHours(0, 0, 0, 0);
    return Math.abs(date2 - date1) / (1000 * 60 * 60 * 24) + 1;
  }

  // const platFormOptions = [
  //   { value: '10', label: 'Scroll Plugin' },
  //   { value: '12', label: 'Python Crawler' },
  // ];
  const networkOptions = [
    { value: 'facebook', label: 'Facebook' },
    { value: 'instagram', label: 'Instagram' },
    { value: 'gtext', label: 'Google' },
    { value: 'youtube', label: 'YouTube' },
    { value: 'linkedin', label: 'LinkedIn' },
    { value: 'quora', label: 'Quora' },
    { value: 'reddit', label: 'Reddit' },
    { value: 'native', label: 'Native' },
    { value: 'gdn', label: 'Gdn' }
  ];

  const allNetworkValues = networkOptions.map(option => option.value);

  const dispatch = useDispatch();
  
  const formatSystemDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  function getHoursBetweenDates(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffInMs = Math.abs(end - start);
    const diffInHours = diffInMs / (1000 * 60 * 60);
    return diffInHours;
  }
   // Create refs for both modal and filter button
   const modalRef = React.useRef(null);
   const filterButtonRef = React.useRef(null);
 
   // Close modal when clicking outside (excluding filter button)
   useEffect(() => {
     const handleClickOutside = (event) => {
       if (
         showFilterModal && 
         modalRef.current && 
         !modalRef.current.contains(event.target) &&
         !filterButtonRef.current.contains(event.target)  // Add this check
       ) {
         setShowFilterModal(false);
       }
     };
 
     if (showFilterModal) {
       document.addEventListener('mousedown', handleClickOutside);
     }
 
     return () => {
       document.removeEventListener('mousedown', handleClickOutside);
     };
   }, [showFilterModal]);

  const fetchDataForCurrentSystem = useCallback(async (searchTerm = debouncedFilter) => {
    try {
      const endDate = new Date(dateRange1.endDate);
      endDate.setDate(endDate.getDate() + 1);
      
      const payload = {
        range: {
          from: formatSystemDate(dateRange1?.startDate),
          to: formatSystemDate(dateRange1?.endDate)
        },
        mode: "test",
        steps: calculateDaysInclusive(dateRange1.startDate, dateRange1?.endDate),
        searchTerm: systemName !== null ? searchTerm : "",
        platform:(adsFilterPlatform?.platform?.length>1||adsFilterPlatform?.platform?.length===0)?null:adsFilterPlatform?.platform[0]
      };
      await dispatch(fetchSystemInsites(payload));
    } catch (error) {
      console.error(`Error fetching data for ${searchTerm}:`, error);
    } 
  }, [dateRange1, systemName, getHoursBetweenDates]);

  // Apply ads count filter and network filter
  const filteredData = React.useMemo(() => {
    let data = SystemInsites;
    
    // Apply ads count filter if min or max is set
    if (adsFilter.min !== "" || adsFilter.max !== "") {
      const min = adsFilter.min ? parseInt(adsFilter.min) : 0;
      const max = adsFilter.max ? parseInt(adsFilter.max) : Infinity;
      
      data = data.filter(item => {
        // If no networks selected, check all networks
        if (adsFilter.networks?.length === 0) {
          const adsCountFacebook = item["facebook"] || 0;
          const adsCountInstagram = item["instagram"] || 0;
          const adsCountGoogle = item["gtext"] || 0;
          const adsCountYoutube = item["youtube"] || 0;
          const adsCountLinkedin = item["linkedin"] || 0;
          const adsCountQuora = item["quora"] || 0;
          const adsCountReddit = item["reddit"] || 0;
          const adsCountNative= item["native"] || 0;
          const adsCountGdn = item["gdn"] || 0;
          return (adsCountFacebook >= min && adsCountFacebook <= max) && 
                 (adsCountInstagram >= min && adsCountInstagram <= max) && 
                 (adsCountGoogle >= min && adsCountGoogle <= max) && 
                 (adsCountYoutube >= min && adsCountYoutube <= max)&&
                 (adsCountLinkedin >= min && adsCountLinkedin <= max)&&
                 (adsCountQuora >= min && adsCountQuora <= max)&&
                 (adsCountReddit >= min && adsCountReddit <= max)&&
                 (adsCountNative >= min && adsCountNative <= max)&&
                 (adsCountGdn >= min && adsCountGdn <= max);
        } else {
          // Check selected networks only
          return adsFilter.networks.every(network => {
            const adsCount = item[network] || 0;
            return adsCount >= min && adsCount <= max;
          });
        }
      });
    }
    
    // Apply network filter if specific networks are selected
    if (adsFilter.networks?.length > 0) {
      data = data.filter(item => {
        return adsFilter.networks.some(network => {
          const adsCount = item[network] || 0;
          return adsCount > 0;
        });
      });
    }
    
    return data;
  }, [SystemInsites, adsFilter]);

  // Debounce effect for search
  useEffect(() => {
    const timerId = setTimeout(() => {
      setDebouncedFilter(globalFilter);
    }, 300);

    return () => {
      clearTimeout(timerId);
    };
  }, [globalFilter]);

  // Fetch data when debounced filter changes
  useEffect(() => {
    setGlobalFilter("")
    fetchDataForCurrentSystem();
  }, [dateRange1,adsFilterPlatform]);

  useEffect(() => {
    setGlobalFilter(systemName)
  }, [systemName]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      setDebouncedFilter(globalFilter);
    }
  }, [globalFilter]);

  const handleSearch = useCallback((e) => {
    setGlobalFilter(e.target.value);
  }, []);

  const handleFilterApply = () => {
    setShowFilterModal(false);
  };

  const handleFilterReset = () => {
    setAdsFilter({ 
      min: '', 
      max: '',
      networks: []
    });
    // setAdsFilterPlatform({
    //   platform:[]
    // })
    setShowFilterModal(false);
  };

  useEffect(()=>{
    setAdsFilter({ 
      min: '', 
      max: '',
      networks: []
    });
    setShowFilterModal(false);
  },[dateRange1])
  // Handle network selection change
  const handleNetworkChange = (e, option) => {
    const value = option.value;
    setAdsFilter(prev => {
      if (prev.networks.includes(value)) {
        // Remove if already selected
        return {
          ...prev,
          networks: prev.networks.filter(net => net !== value)
        };
      } else {
        // Add to selection
        return {
          ...prev,
          networks: [...prev.networks, value]
        };
      }
    });
  };
// // Handle network selection change
// const handlePlatFormChange = (e, option) => {
//   setNetworkDropdownOpen(false)
//   const value = option.value;
//   setAdsFilterPlatform(prev => {
//     if (prev.platform.includes(value)) {
//       // Remove if already selected
//       return {
//         ...prev,
//         platform: prev.platform.filter(net => net !== value)
//       };
//     } else {
//       // Add to selection
//       return {
//         ...prev,
//         platform: [...prev.platform, value]
//       };
//     }
//   });
// };

  // Handle select all networks
  const handleSelectAllNetworks = () => {
    setAdsFilter(prev => ({
      ...prev,
      networks: prev.networks?.length === allNetworkValues?.length ? [] : [...allNetworkValues]
    }));
  };

  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onPaginationChange: setPagination,
    onGlobalFilterChange: setDebouncedFilter,
    state: {
      pagination,
      globalFilter: debouncedFilter,
    },
  });

  return (
<div className="relative flex flex-col gap-[18px]">
 <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 md:gap-4">
  {/* Title - Always visible and takes full width on mobile */}
  <div className="w-full md:w-auto md:min-w-[200px]">
    <span className="text-2xl md:text-[30px] font-[600] text-[#264688] whitespace-nowrap">
      All System Performance
    </span>
  </div>

  {/* Middle section - Networks tags with scroll */}
  {adsFilter.networks?.length > 0 && (
    <div className="w-full md:flex-1 relative min-w-0">
      {/* Left fade overlay */}
      <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none"></div>
      
      {/* Right fade overlay */}
      <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none"></div>
      
      <div className="flex overflow-x-auto py-1 scrollbar-hide">
        <div className="flex space-x-2">
          {adsFilter.networks.map(network => (
            <span 
              key={network} 
              className="inline-flex items-center flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 hover:bg-blue-200 transition-colors"
            >
              {networkOptions.find(opt => opt.value === network)?.label || network}
                <svg onClick={(e) => {
                  e.stopPropagation();
                  handleNetworkChange(e, { value: network });
                }}
                  className="w-3 h-3 ml-1.5 -mr-0.5 p-0.5 rounded-full text-white bg-red-400 transition-colors" 
                  stroke="currentColor" 
                  fill="none" 
                  viewBox="0 0 8 8"
                >
                  <path strokeLinecap="round" strokeWidth="1.5" d="M1 1l6 6m0-6L1 7" />
                </svg>
            </span>
          ))}
        </div>
      </div>
    </div>
  )}

  {/* Search and Filter - Right section */}
  <div className="w-full md:w-auto flex items-center justify-end gap-3">
    <div className="w-full md:w-[300px] lg:w-[400px] flex items-center relative">
      <CiSearch className="absolute left-3 top-2 w-6 h-6 text-[#131212]" />
      <input
        type="text"
        placeholder="Search systems..."
        value={globalFilter ?? ''}
        onChange={handleSearch}
        onKeyDown={handleKeyDown}
        className="pl-10 pr-3 w-full bg-white py-2 border border-[#dee2e6] rounded-lg focus:outline-[#157496] text-sm text-black"
      />  
    </div>
    <button ref={filterButtonRef}
      onClick={(e) =>{ e.stopPropagation();setShowFilterModal(!showFilterModal)}}
      className={`flex items-center justify-center !rounded-lg !border focus:!outline-0 !border-gray-300 !p-2 !w-10 ${
        (adsFilter.min !== "" || adsFilter.max !== "" || adsFilter.networks?.length > 0) 
          ? "!bg-[#d2dfff]" 
          : "!bg-white"
      }`}
    >
      <CiFilter className="w-6 h-6" />
    </button>
  </div>
</div>
      {/* Filter Modal */}
      {showFilterModal && (
        <div ref={modalRef} className="absolute right-[5px] top-[50px] z-50 bg-white p-6 rounded-xl shadow-xl border border-[#e0e7ff] w-84">
          <div className="flex flex-col gap-4">
            {/* <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">Platforms</label>
                <svg xmlns="http://www.w3.org/2000/svg" onClick={() => setShowFilterModal(false)} className="h-5 w-5 cursor-pointer" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </div>
              
              <div className="flex flex-wrap gap-2">  
                {platFormOptions.map(option => (
                  <div 
                    key={option.value}
                    className={`px-3 py-1 rounded-full text-sm border cursor-pointer ${
                      adsFilterPlatform.platform.includes(option.value) 
                        ? 'bg-blue-100 border-blue-500 text-blue-700' 
                        : 'bg-gray-100 border-gray-300 text-gray-700'
                    }`}
                    onClick={(e) => handlePlatFormChange(e, option)}
                  >
                    {option.label}
                  </div>
                ))}
              </div>
              </div> */}
            <div className="space-y-2">
              <div className="relative">
                <button 
                  onClick={(e) => {
                    e.preventDefault();
                    setNetworkDropdownOpen(!networkDropdownOpen);
                  }}
                  className={`w-full flex items-center justify-between  !border-[#d1d5db] px-4 py-2.5 text-left !rounded-lg !border transition-all duration-200 ${
                    networkDropdownOpen 
                      ? "border-blue-500 ring-2 ring-blue-200 bg-blue-50" 
                      : "border-gray-300 hover:border-gray-400 bg-white"
                  }`}
                >
                  <span className={`truncate ${
                    adsFilter.networks?.length === 0 ? "text-gray-400" : "text-gray-800"
                  }`}>
                    {adsFilter.networks?.length === 0 
                      ? 'Select networks...'
                      : adsFilter.networks?.length === allNetworkValues?.length
                        ? 'All networks selected'
                        : `${adsFilter.networks?.length} selected`}
                  </span>
                  <svg 
                    className={`w-5 h-5 text-gray-500 transition-transform duration-200 ${
                      networkDropdownOpen ? "transform rotate-180" : ""
                    }`}
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {networkDropdownOpen && (
                  <div 
                    className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div 
                      className={`px-4 py-2.5 flex  items-center justify-between cursor-pointer ${
                        adsFilter?.networks?.length === allNetworkValues?.length 
                          ? "bg-blue-50 text-blue-700" 
                          : "hover:bg-gray-50"
                      }`}
                      onClick={handleSelectAllNetworks}
                    >
                      <span className="font-medium">
                        {adsFilter?.networks?.length === allNetworkValues?.length ? 'Deselect All' : 'Select All'}
                      </span>
                      <div className={`w-5 h-5 flex items-center justify-center rounded border ${
                        adsFilter?.networks?.length === allNetworkValues?.length 
                          ? "bg-blue-600 border-blue-600" 
                          : "border-gray-300"
                      }`}>
                        {adsFilter?.networks?.length === allNetworkValues?.length && (
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                    </div>
                    
                    <div className="max-h-25 overflow-y-auto border-b border-gray-100">
                      {networkOptions?.map(option => (
                        <div 
                          key={option?.value}
                          className={`px-4 py-2.5 flex items-center cursor-pointer ${
                            adsFilter?.networks?.includes(option?.value) 
                              ? "bg-blue-50" 
                              : "hover:bg-gray-50"
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleNetworkChange(e, option);
                          }}
                        >
                          <div className={`w-5 h-5 flex items-center justify-center rounded border mr-3 ${
                            adsFilter?.networks?.includes(option?.value)
                              ? "bg-blue-600 border-blue-600"
                              : "border-gray-300"
                          }`}>
                            {adsFilter?.networks?.includes(option?.value) && (
                              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                          </div>
                          <span className={`${
                            adsFilter?.networks?.includes(option?.value) 
                              ? "text-blue-700 font-medium" 
                              : "text-gray-700"
                          }`}>
                            {option?.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Ads Count Range</label>
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <input
                    type="number"
                    placeholder="Min"
                    value={adsFilter?.min}
                    onChange={(e) => setAdsFilter({...adsFilter, min: e.target.value})}
                    className="w-full pl-3 pr-2 py-2 border border-[#d1d5db] rounded-lg"
                  />
                </div>
                <span className="text-gray-500">to</span>
                <div className="relative flex-1">
                  <input
                    type="number"
                    placeholder="Max"
                    value={adsFilter?.max}
                    onChange={(e) => setAdsFilter({...adsFilter, max: e.target.value})}
                    className="w-full pl-3 pr-2 py-2 border border-[#d1d5db] rounded-lg"
                  />
                </div>
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

      {/* Rest of the component remains the same */}
      {loadingSystemInsites ? (
        <div className="w-full !py-[18px] !px-[26px] !bg-white !rounded-[10px] h-[756px] flex flex-col">
          {/* Table Header Shimmer */}
          <div className="overflow-auto w-full flex-grow">
            <table className="min-w-full border-collapse">
              <thead className="sticky top-0 !rounded-[10px] z-[26]">
                <tr className="!rounded-[10px] !bg-[#f9f9fb]">
                  {/* Create 5 header cells (adjust number based on your actual columns) */}
                  {[...Array(5)].map((_, i) => (
                    <th key={i} className="!px-4 !py-3 !h-[53px] text-left">
                      <div className="h-6 bg-gray-200 rounded shimmer" style={{ width: `${Math.random() * 100 + 100}px` }}></div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Table Rows Shimmer - 10 rows matching original height */}
                {[...Array(10)].map((_, rowIndex) => (
                  <tr key={rowIndex} className={`!h-[98px] border-b ${rowIndex % 2 === 0 ? "bg-[#fff]" : "bg-white"}`}>
                    {/* Create 5 cells per row (match your column count) */}
                    {[...Array(5)].map((_, cellIndex) => (
                      <td key={cellIndex} className="!px-5 !py-4">
                        <div className="flex items-center">
                          {/* First column often has different content */}
                          {cellIndex === 0 ? (
                            <div className="flex items-center space-x-3">
                              <div className="h-10 w-10 bg-gray-200 rounded-full shimmer"></div>
                              <div className="h-4 bg-gray-200 rounded shimmer" style={{ width: `${Math.random() * 100 + 50}px` }}></div>
                            </div>
                          ) : (
                            <div className="h-4 bg-gray-200 rounded shimmer" style={{ width: `${Math.random() * 100 + 50}px` }}></div>
                          )}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Shimmer */}
          <div className="flex items-center justify-between mt-4 px-4 border-t border-[#e5e7eb] pt-4">
            <div className="flex items-center gap-4">
              {/* Results count shimmer */}
              <div className="h-5 bg-gray-200 rounded shimmer" style={{ width: '200px' }}></div>
              
              {/* Page size selector shimmer */}
              <div className="border border-[#d1d5db] rounded-lg px-3 py-1.5">
                <div className="h-5 bg-gray-200 rounded shimmer" style={{ width: '100px' }}></div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Navigation buttons shimmer */}
              <div className="!h-[29px] !w-[36px] !rounded-[9px] !border !border-[#cbcbcb] bg-gray-200 shimmer"></div>
              <div className="!h-[29px] !w-[36px] !rounded-[9px] !border !border-[#cbcbcb] bg-gray-200 shimmer"></div>
              
              {/* Page numbers shimmer */}
              {[...Array(5)].map((_, i) => (
                <div 
                  key={i} 
                  className={`!h-[29px] !w-[36px] !rounded-[9px] !border flex justify-center items-center ${
                    i === 2 ? "!border-[#cbcbcb] !bg-[#9ca9ff]" : "!border-[#cbcbcb]"
                  }`}
                >
                  <div className="h-3 w-3 bg-gray-200 rounded-full shimmer"></div>
                </div>
              ))}
              
              <div className="!h-[29px] !w-[36px] !rounded-[9px] !border !border-[#cbcbcb] bg-gray-200 shimmer"></div>
              <div className="!h-[29px] !w-[36px] !rounded-[9px] !border !border-[#cbcbcb] bg-gray-200 shimmer"></div>
            </div>
          </div>
        </div> 
      ) : (
        // <div className="w-full !py-[18px] !px-[26px] !bg-white !rounded-[10px] h-[740px] flex flex-col">
        // <div className="overflow-auto w-full flex-grow relative">
        //   {/* Remove overflow-x-auto from this div as it can interfere with sticky headers */}
        //   <div className="min-w-full">
        //     <table className="w-full border-collapse">
        //       <thead className="sticky top-0 !rounded-[10px] z-[26] bg-[#f9f9fb]">
        //         {table.getHeaderGroups().map((headerGroup) => (
        //           <tr key={headerGroup.id}>
        //             {headerGroup.headers.map((header, index) => (
        //               <th
        //                 key={header.id}
        //                 className={`
        //                   !px-4 !py-3 !h-[53px] text-left text-[16px] font-[400] 
        //                   text-[#575757] hover:text-[#1f296a] sticky top-0 bg-[#f9f9fb]
        //                   ${index === 0 ? 'sticky left-0 z-[27]' : ''}
        //                 `}
        //               >
        //                 {flexRender(
        //                   header.column.columnDef.header,
        //                   header.getContext()
        //                 )}
        //               </th>
        //             ))}
        //           </tr>
        //         ))}
        //       </thead>
        //         {table.getRowModel().rows.length > 0 ? (
        //           <tbody>
        //             {table.getRowModel().rows.map((row, rowIndex) => (
        //               <tr
        //                 key={row.id}
        //                 className={`!h-[98px] border-t border-b ${
        //                   rowIndex % 2 === 0 ? "bg-[#fff]" : "bg-white"
        //                 }`}
        //               >
        //                 {row.getVisibleCells().map((cell, cellIndex) => (
        //                   <td
        //                     key={cell.id}
        //                     className={`!px-5 !py-4 !text-[14px] !text-[#1f1f1f] !font-[400] ${
        //                       cellIndex === 0 ? 'sticky left-0 z-[10] bg-white' : ''
        //                     } ${rowIndex % 2 === 0 ? "bg-[#fff]" : "bg-white"}`}
        //                   >
        //                     {flexRender(
        //                       cell.column.columnDef.cell,
        //                       cell.getContext()
        //                     )}
        //                   </td>
        //                 ))}
        //               </tr>
        //             ))}
        //           </tbody>
        //         ) : (
        //           <tbody>
        //             <tr>
        //               <td 
        //                 colSpan={table.getAllColumns().length}
        //                 className="!h-[98px] text-center !text-[14px] !text-[#1f1f1f] !font-[400]"
        //               >
        //                 System Not Found
        //               </td>
        //             </tr>
        //           </tbody>
        //         )}
        //       </table>
        //     </div>
        //   </div>

  <div className="w-full !py-[18px] !px-[26px] !bg-white !rounded-[10px] h-[740px] flex flex-col">
  <div className="overflow-auto w-full flex-grow relative">
    <table className="w-full border-separate border-spacing-0">
      <thead className="sticky top-0 z-[26] bg-[#f9f9fb]">
        {table?.getHeaderGroups()?.map((headerGroup) => (
          <tr key={headerGroup?.id}>
            {headerGroup?.headers?.map((header, index) => (
              <th
                key={header?.id}
                className={`
                  !px-4 !py-3 !h-[53px] text-left text-[16px] font-[400] 
                  text-[#575757] hover:text-[#1f296a] sticky top-0 bg-[#f9f9fb]
                  border-b border-t border-[#e5e7eb]
                  ${index === 0 ? 'sticky left-0 z-[27]' : ''}
                `}
              >
                {flexRender(header?.column?.columnDef?.header, header?.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      {table?.getRowModel()?.rows?.length > 0 ? (
      <tbody>
        {table?.getRowModel()?.rows?.map((row, rowIndex) => (
          <tr
            key={row?.id}
            className={`relative h-[98px] ${rowIndex % 2 === 0 ? "bg-[#fff]" : "bg-white"}`}
          >
            {row?.getVisibleCells()?.map((cell, cellIndex) => (
              <td
                key={cell?.id}
                className={`
                  !px-5 !py-4 !text-[14px] !text-[#1f1f1f] !font-[400]
                  border-t border-b border-[#e5e7eb]
                  ${cellIndex === 0 ? 'sticky left-0 z-[10] bg-inherit' : ''}
                  ${rowIndex % 2 === 0 ? "bg-[#fff]" : "bg-white"}
                `}
              >
                {flexRender(cell?.column?.columnDef?.cell, cell?.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody> 
      )
      :( 
                 <tbody>
                    <tr>
                      <td 
                        colSpan={table?.getAllColumns()?.length}
                        className="!h-[98px] text-center !text-[14px] !text-[#1f1f1f] !font-[400]"
                      >
                        System Not Found
                      </td>
                    </tr>
                  </tbody>
      )
}
    </table>
  </div>

          {/* Pagination controls */}
          <div className="flex items-center justify-between mt-4 px-4 border-t  border-[#e5e7eb] pt-4">
            <div className="flex items-center gap-4">
              <span className="text-sm text-[#6b7280]">
                Showing{' '}
                <span className="font-medium text-[#1f296a]">
                  {table?.getState()?.pagination?.pageIndex * table?.getState()?.pagination?.pageSize + 1}
                </span>{' '}
                to{' '}
                <span className="font-medium text-[#1f296a]">
                  {Math.min(
                    (table?.getState()?.pagination?.pageIndex + 1) * table?.getState()?.pagination?.pageSize,
                    table?.getFilteredRowModel()?.rows?.length
                  )}
                </span>{' '}
                of{' '}
                <span className="font-medium text-[#1f296a]">
                  {table?.getFilteredRowModel()?.rows?.length}
                </span>{' '}
                results
              </span>

              <select
                className="border border-[#d1d5db] rounded-lg px-3 py-1.5 text-sm text-[#374151] focus:outline-none focus:ring-2 focus:ring-[#5C61F2] focus:border-transparent"
                value={table?.getState()?.pagination?.pageSize}
                onChange={(e) => {
                  table?.setPageSize(Number(e.target.value));
                }}
              >
                {[10, 20, 30, 40, 50].map((pageSize) => (
                  <option key={pageSize} value={pageSize}>
                    Show {pageSize}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                className={`!h-[29px] !w-[36px] flex justify-center items-center !rounded-[9px] !border !border-[#cbcbcb] !text-[#1f1f1f] bg-gray-300! !p-0 disabled:opacity-50`}
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
              >
                <FaAngleDoubleLeft className="w-4 h-4" />
              </button>
              <button
                className={`!h-[29px] !w-[36px] flex justify-center items-center !rounded-[9px] !border !border-[#cbcbcb] !text-[#1f1f1f] bg-gray-300! !p-0 disabled:opacity-50`}
                onClick={() => table?.previousPage()}
                disabled={!table?.getCanPreviousPage()}
              >
                <FaChevronLeft className="w-3 h-3" />
              </button>
              
              {/* Page numbers */}
              {Array.from({ length: Math.min(5, table?.getPageCount()) }, (_, i) => {
                const pageIndex = table?.getState()?.pagination?.pageIndex;
                let displayPage;
                if (table?.getPageCount() <= 5) {
                  displayPage = i;
                } else if (pageIndex <= 2) {
                  displayPage = i;
                } else if (pageIndex >= table?.getPageCount() - 3) {
                  displayPage = table?.getPageCount() - 5 + i;
                } else {
                  displayPage = pageIndex - 2 + i;
                }
                
                return (
                  <button
                    key={displayPage}
                    className={`!h-[29px] !w-[36px] !rounded-[9px] !border flex justify-center items-center text-[12px] font-[400] ${
                      table?.getState()?.pagination?.pageIndex === displayPage
                        ? "!border-[#cbcbcb] !bg-[#9ca9ff] !text-[#1f1f1f]"
                        : "!border-[#cbcbcb] !text-[#1f1f1f] hover:bg-gray-100"
                    }`}
                    onClick={() => table?.setPageIndex(displayPage)}
                  >
                    {displayPage + 1}
                  </button>
                );
              })}

              <button
                className={"!h-[29px] !w-[36px] flex justify-center items-center !rounded-[9px] !border !border-[#cbcbcb] !text-[#1f1f1f] bg-gray-300! !p-0 disabled:opacity-50"}
                onClick={() => table?.nextPage()}
                disabled={!table?.getCanNextPage()}
              >
                <FaChevronRight className="w-3 h-3" />
              </button>
              <button
                className={`!h-[29px] !w-[36px] flex justify-center items-center !rounded-[9px] !border !border-[#cbcbcb] !text-[#1f1f1f] bg-gray-300! !p-0 disabled:opacity-50`}
                onClick={() => table?.setPageIndex(table?.getPageCount() - 1)}
                disabled={!table?.getCanNextPage()}
              >
                <FaAngleDoubleRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
});

export default SystemPerformanceTable;