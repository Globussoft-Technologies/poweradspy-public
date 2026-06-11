import { flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table';
import React, { useCallback, useEffect, useState,useRef } from 'react';
import { CiSearch, CiFilter } from 'react-icons/ci';
import { FaAngleDoubleLeft, FaAngleDoubleRight, FaAngleDown, FaAngleUp, FaChevronLeft, FaChevronRight, FaDownload, FaSpinner } from 'react-icons/fa';
import { fetchSystemInfoAccounts } from '../../store/actions/powerAdsPyActionsApi';
import { useDispatch, useSelector } from 'react-redux';
import { useOutletContext } from 'react-router-dom';
import { Tooltip } from 'react-tooltip';
import { FaSync } from 'react-icons/fa';
// import { useRef } from 'react';
import { FaFileExcel, FaFilePdf } from 'react-icons/fa';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import ExcelJS from 'exceljs';

const AccountPerformanceTable = React.memo(({ columns, dateRange1, adsFilterPlatform,setAccountName,setIsStatusModalOpen,setIsAccountStatusModalOpen,setAccountSystemName }) => {
  const { loadingSystemInfoAccount, SystemInfoAccount } = useSelector((state) => state.poweradspy);
  const [networkDropdownOpen, setNetworkDropdownOpen] = useState(false);
  const [adsTypeDropdownOpen, setAdsTypeDropdownOpen] = useState(false);
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
    networks: [],
    adsType: '',
    alert: '' // Now a string for single selection
  });
 
  const { isMonitoring } = useOutletContext();
  const [monitoringStatus, setMonitoringStatus] = useState({});
  const [refreshInterval, setRefreshInterval] = useState(null);
  const [tableData, setTableData] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  
  function calculateDaysInclusive(fromDate, toDate) {
    const date1 = new Date(fromDate);
    const date2 = new Date(toDate);
    date1.setHours(0, 0, 0, 0);
    date2.setHours(0, 0, 0, 0);
    return Math.abs(date2 - date1) / (1000 * 60 * 60 * 24) + 1;
  }

// Options array remains the same
const platFormOptions = [
  { value: 'red', label: 'Red Alert' },
  { value: 'yellow', label: 'Yellow Alert' },
];

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


  const optionAdsTypes = [
    { value: 'unique_ads', label: 'Unique Ads' },
    { value: 'ads', label: 'Total Ads' },
    { value: 'updated_ads', label: 'Updated Ads' },
  ];
  const allAdsTypeValues = optionAdsTypes.map(option => option.value);
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
    return diffInMs / (1000 * 60 * 60);
  }

  const fetchSystemInfoAccountsdata = useCallback(async (searchTerm = debouncedFilter) => {
    try {
      const endDate = new Date(dateRange1.endDate);
      endDate.setDate(endDate.getDate() + 1);
      
      const payload = {
        range: {
          from: formatSystemDate(dateRange1?.startDate),
          to: formatSystemDate(dateRange1?.endDate)
        },
        mode: "test",
        steps: calculateDaysInclusive(dateRange1?.startDate, dateRange1?.endDate),
        accounts: searchTerm,
        platform: (adsFilterPlatform?.platform?.length > 1 || adsFilterPlatform?.platform?.length === 0) ? null : adsFilterPlatform?.platform[0]
      };
      const response = await dispatch(fetchSystemInfoAccounts(payload));
      
      // Update local table data state when new data arrives
      // if (response?.payload) {
      //   setTableData(response?.payload);
        
      //   // Update monitoring status based on new data
      //   const newStatus = {};
      //   response?.payload?.forEach(account => {
      //     // Customize this based on your actual status logic
      //     newStatus[account?.id] = account?.isActive || false;
      //   });
      //   setMonitoringStatus(newStatus);
      // }

      if (response?.payload) {
        const dataArray = Array.isArray(response.payload) 
          ? response.payload 
          : [response.payload]; // Convert single object to array
        
        setTableData(dataArray);
        
        const newStatus = {};
        dataArray.forEach(account => {
          newStatus[account?.id] = account?.isActive || false;
        });
        setMonitoringStatus(newStatus);
      }
    } catch (error) {
      console.error(`Error fetching data for ${searchTerm}:`, error);
    }
  }, [dateRange1, adsFilterPlatform, debouncedFilter]);
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

    const filteredData = React.useMemo(() => {
      let data = tableData?.length > 0 ? tableData : SystemInfoAccount;
      
      // Apply network filter if any networks are selected
      if (adsFilter.networks?.length > 0) {
        data = data.filter(item => {
          return adsFilter.networks.some(network => {
            return network.toLowerCase() === item?.network?.toLowerCase();
          });
        });
      }
      
      // Apply ads type and range filters
      if (adsFilter.adsType || adsFilter.min !== "" || adsFilter.max !== "") {
        const min = adsFilter.min ? parseInt(adsFilter.min) : 0;
        const max = adsFilter.max ? parseInt(adsFilter.max) : Infinity;
        
        data = data.filter(item => {
          // If specific ads type is selected, check only that
          if (adsFilter.adsType) {
            const value = item[adsFilter.adsType] || 0;
            return value >= min && value <= max;
          }
          // Otherwise check all ads types if min/max is set
          else if (adsFilter.min !== "" || adsFilter.max !== "") {
            return allAdsTypeValues.some(type => {
              const value = item[type] || 0;
              return value >= min && value <= max;
            });
          }
          return true;
        });
      }
        // Apply alert color filter if selected
        if (adsFilter.alert) {
          data = data.filter(item => {
            // If alert filter is set, check if the item's alert color matches
            return item.alert?.color?.toLowerCase() === adsFilter.alert.toLowerCase();
          });
}
      return data;
    }, [tableData, SystemInfoAccount, adsFilter]);
  // Debounce effect for search
  useEffect(() => {
    const timerId = setTimeout(() => {
      setDebouncedFilter(globalFilter);
    }, 300);
    return () => clearTimeout(timerId);
  }, [globalFilter]);

  useEffect(() => {
    fetchSystemInfoAccountsdata();
  }, [dateRange1, adsFilterPlatform]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') setDebouncedFilter(globalFilter);
  }, [globalFilter]);

  const handleSearch = useCallback((e) => {
    setGlobalFilter(e.target.value);
  }, []);

  const handleFilterApply = () => {
    setShowFilterModal(false);
  };

  const handleFilterReset = () => {
    setAdsFilter({ min: '', max: '', networks: [], adsType: '',alert:'' });
    // setAdsFilterPlatform({ platform: [] });
    setShowFilterModal(false);
  };

  const handleNetworkChange = (e, option) => {
    const value = option.value;
    setAdsFilter(prev => ({
      ...prev,
      networks: prev.networks.includes(value) 
        ? prev.networks.filter(net => net !== value) 
        : [...prev.networks, value]
    }));
  };


  const handleAdsTypeChange = (e, option) => {
    const value = option.value;
    setAdsFilter(prev => ({
      ...prev,
      adsType: prev.adsType.includes(value) 
        ? prev.adsType.filter(net => net !== value) 
        : [...prev.adsType, value]
    }));
  };

  // Polling effect
  useEffect(() => {
    let intervalId;
    // Set up polling if monitoring is enabled
    if (isMonitoring) {
    fetchSystemInfoAccountsdata();
    }
    if (isMonitoring) {
      intervalId = setInterval(() => {
        fetchSystemInfoAccountsdata();
      }, 180000); // 180 seconds
    }
    // Cleanup interval on unmount or when monitoring is turned off
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isMonitoring, fetchSystemInfoAccountsdata]);



  const handleSelectAllNetworks = () => {
    setAdsFilter(prev => ({
      ...prev,
      networks: prev.networks?.length === allNetworkValues?.length ? [] : [...allNetworkValues]
    }));
  };
  const handleSelectAllAdsType = () => {
    setAdsFilter(prev => ({
      ...prev,
      adsType: prev.adsType?.length === allAdsTypeValues?.length ? [] : [...allAdsTypeValues]
    }));
  };
  useEffect(()=>{
    setAdsFilter({ 
      min: '', 
      max: '',
      networks: [],
      adsType:"",
      alert:''
    });
    setShowFilterModal(false);
  },[dateRange1])

  // Add the refresh handler function
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchSystemInfoAccountsdata();
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

const exportToExcel = async () => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Account Performance');

    // Get visible rows and columns
    const visibleRows = table.getFilteredRowModel().rows;
    const visibleColumns = table.getAllColumns()
      .filter(column => column.getIsVisible() && column.id !== 'performance');

    // Create headers with styling
    worksheet.columns = visibleColumns.map(column => {
      let header;
      if (typeof column.columnDef.header === 'string') {
        header = column.columnDef.header;
      } else {
        header = column.columnDef.accessorKey 
          ? column.columnDef.accessorKey.toString().replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
          : 'Column';
      }
      
      return {
        header,
        key: column.id,
        width: 20
      };
    });

    // Style header row
    worksheet.getRow(1).eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '264688' }
      };
      cell.font = {
        bold: true,
        color: { argb: 'FFFFFF' }
      };
      cell.alignment = { horizontal: 'center' };
    });

    // Add data rows with alert text coloring only
    visibleRows?.forEach(row => {
      const rowData = {};
      const alertColor = row?.original?.alert?.color;
      const hasAlert = alertColor === "red" || alertColor === "yellow";
      
      visibleColumns?.forEach(column => {
        const value = row.getValue(column.id);
        
        if (column.id === 'account') {
          const accountValue = row.original.account !== null 
            ? row.original.account 
            : row.original.account_id ?? "---";
          
          if (hasAlert) {
            // Create rich text format for account cell
            rowData[column.id] = {
              richText: [
                { text: accountValue }, // Normal text for account name
                { text: '    ' }, // Spacing
                { 
                  text: alertColor === "red" ? "⚠️Red Alert" : "⚠️Yellow Alert",
                  font: {
                    bold: true,
                    color: { argb: alertColor === "red" ? 'FF0000' : 'FFD700' }
                  }
                }
              ]
            };
          } else {
            rowData[column.id] = accountValue;
          }
        } else if (['unique_ads', 'ads', 'updated_ads'].includes(column.id)) {
          rowData[column.id] = value > 0 ? value : "---";
        } else {
          rowData[column.id] = value === undefined || value === null ? '' : 
                     typeof value === 'object' ? JSON.stringify(value) : 
                     value.toString();
        }
      });

      worksheet.addRow(rowData);
    });

    // Auto-fit columns
    worksheet?.columns?.forEach(column => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        let cellLength;
        if (cell.value && typeof cell.value === 'object' && cell.value.richText) {
          // Handle rich text length calculation
          cellLength = cell.value.richText.reduce((sum, part) => sum + part.text?.length, 0);
        } else {
          cellLength = cell.value ? cell.value.toString()?.length : 0;
        }
        if (cellLength > maxLength) {
          maxLength = cellLength;
        }
      });
      column.width = Math.max(15, Math.min(maxLength + 2, 50)); // Min 15, Max 50
    });

    // Generate file
    const dateString = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).replace(/\//g, '-');
    
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Account_Performance_${dateString}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    alert('Failed to export to Excel. Please try again or contact support.');
  }
};

  // Update columns with monitoring status icons
  const statusColumns = React.useMemo(() => [
    {
      accessorKey: "account",
      enableSorting: true,
      header: ({ column }) => (
        <div className="flex items-center gap-1">
          <span>Accounts</span>
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
        <div className="flex items-center justify-between w-full">
        {/* Account name with truncation */}
        <span 
          data-tooltip-id="status-tooltip"
          data-tooltip-content="Click to check System Status"
          className="cursor-pointer truncate pr-1 flex-1 min-w-0"
         onClick={(e) => {
          e.stopPropagation();
          // setSelectedSystem(prev => 
          //   prev === row.original.system ? null : row.original.system
          // )
          // setSystemName(row?.original?.system)
          row.original?.account !==null&&setIsStatusModalOpen(false);setIsAccountStatusModalOpen(true)
            setAccountName(prev => 
              prev === row.original?.account ? null : row.original?.account
            );
            setAccountSystemName(prev => 
              prev === row.original.system ? null : row.original.system
            );
        }}
        >
          {row.original.account !== null ? row.original?.account : row?.original?.account_id ?? "---"}
        </span>
        <Tooltip
            id="status-tooltip"
            place="top"
            effect="solid"
            className="z-50 !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px]"
            delayShow={300}
          />
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
           : row?.original?.alert?.color=="red"?
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
    ...columns.filter(col => col.accessorKey !== 'account')
  ], [columns, monitoringStatus]);

// Handler function for single selection
const handlePlatFormChange = (option) => {
  setAdsFilter(prev => {
    // If already selected, deselect it, otherwise select the new option
    const newValue = prev.alert === option.value ? '' : option.value;
    return {
      ...prev,
      alert: newValue
    };
  });
};

  const table = useReactTable({
    data: filteredData,
    columns:statusColumns,
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

  const [isDownloading, setIsDownloading] = useState(false);

  const handleExport = async () => {
    setIsDownloading(true);
    try {
      await exportToExcel(); // Your existing export function
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsDownloading(false);
    }
  };
  return (
    <div className="relative flex flex-col gap-[18px]">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 md:gap-4">
        {/* Title with refresh button */}
        <div className="w-full md:w-auto md:min-w-[200px] flex items-center gap-1">
          <span className="text-2xl md:text-[30px] font-[600] text-[#264688] whitespace-nowrap">
            Account Wise Performance
          </span>
          {!isMonitoring &&<button 
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1 rounded-full transition-colors focus:!outline-none"
            data-tooltip-id="refresh-tooltip"
            data-tooltip-content="Refresh data"
          >
            <FaSync 
              className={`w-5 h-5 text-[#264688] ${isRefreshing ? 'animate-spin' : ''}`} 
            />
          </button>
          }
          <Tooltip
            id="refresh-tooltip"
            place="top"
            effect="solid"
            className="!z-9999 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 !py-0.75"
          />
        </div>

        {/* Selected Networks */}
        {adsFilter?.networks?.length > 0 && (
          <div className="w-full md:flex-1 relative min-w-0">
            <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none"></div>
            <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none"></div>
            
            <div className="flex overflow-x-auto py-1 scrollbar-hide">
              <div className="flex space-x-2">
                {adsFilter?.networks?.map(network => (
                  <span 
                    key={network} 
                    className="inline-flex items-center flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 hover:bg-blue-200 transition-colors"
                  >
                    {networkOptions.find(opt => opt.value === network)?.label || network}
                    <svg 
                      onClick={(e) => {
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

        {/* Search and Filter */}
        {/* <div  className="w-full md:w-auto flex items-center justify-end gap-3">
          <div className="w-full md:w-[300px] lg:w-[400px] flex items-center relative">
            <CiSearch className="absolute left-3 top-2 w-6 h-6 text-[#131212]" />
            <input
              type="text"
              placeholder="Search accounts..."
              value={globalFilter ?? ''}
              onChange={handleSearch}
              onKeyDown={handleKeyDown}
              className="pl-10 pr-3 w-full bg-white py-2 border border-[#dee2e6] rounded-lg focus:outline-[#157496] text-sm text-black"
            />  
          </div>
          <button ref={filterButtonRef} 
            onClick={() => setShowFilterModal(!showFilterModal)}
            className={`flex items-center justify-center !rounded-lg !border focus:!outline-0 !border-gray-300 !p-2 !w-10 ${
              (adsFilter.min !== "" || adsFilter.max !== "" || adsFilter.networks.length > 0) 
                ? "!bg-[#d2dfff]" 
                : "!bg-white"
            }`}
          >
            <CiFilter className="w-6 h-6" />
          </button>
        </div> */}

<div className="w-full md:w-auto flex items-center justify-end gap-3">
  <div className="w-full md:w-[300px] lg:w-[400px] flex items-center relative">
    <CiSearch className="absolute left-3 top-2 w-6 h-6 text-[#131212]" />
    <input
      type="text"
      placeholder="Search accounts..."
      value={globalFilter ?? ''}
      onChange={handleSearch}
      onKeyDown={handleKeyDown}
      className="pl-10 pr-3 w-full bg-white py-2 border border-[#dee2e6] rounded-lg focus:outline-[#157496] text-sm text-black"
    />  
  </div>

<button 
        onClick={handleExport}
        disabled={isDownloading}
        className={`flex items-center justify-center !rounded-lg !border focus:!outline-0 !border-gray-300 !p-2 !w-10 hover:bg-blue-50 ${
          isDownloading ? 'cursor-wait' : ''
        }`}
        data-tooltip-id="export-excel-tooltip"
      >
        {isDownloading ? (
          <FaSpinner className="w-5 h-5 text-blue-600 animate-spin" />
        ) : (
          <FaDownload className="w-5 h-5 text-blue-600" />
        )}
      </button>
      
      <Tooltip
        id="export-excel-tooltip"
        place="top"
        effect="solid"
        className="!z-[9999] !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 !py-0.75"
      >
        <div className="flex items-center gap-2">
          <FaFileExcel className="w-4 h-4 text-green-600" />
          <span>Export to Excel</span>
        </div>
      </Tooltip>
  
  {/* Existing Filter Button */}
  <button ref={filterButtonRef} 
    onClick={() => setShowFilterModal(!showFilterModal)}
    className={`flex items-center justify-center !rounded-lg !border focus:!outline-0 !border-gray-300 !p-2 !w-10 ${
      (adsFilter.min !== "" || adsFilter.max !== "" || adsFilter.networks?.length > 0) 
        ? "!bg-[#d2dfff]" 
        : "!bg-white"
    }`}
    data-tooltip-id="filter-tooltip"
    data-tooltip-content="Filter"
  >
    <CiFilter className="w-6 h-6" />
  </button>
  <Tooltip
    id="filter-tooltip"
    place="top"
    effect="solid"
    className="!z-9999 !text-[15px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 !py-0.75"
  />
</div>
      </div>

      {/* Filter Modal */}
      {showFilterModal && (
        <div ref={modalRef} className="absolute right-[5px] top-[50px] z-50 bg-white p-6 rounded-xl shadow-xl border border-[#e0e7ff] w-84">
          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <div className="relative">
                <button 
                  onClick={(e) => {
                    e.preventDefault();
                    setNetworkDropdownOpen(!networkDropdownOpen);
                    setAdsTypeDropdownOpen(false);
                  }}
                  className={`w-full flex items-center justify-between !border-[#d1d5db] px-4 py-2.5 text-left !rounded-lg !border transition-all duration-200 ${
                    networkDropdownOpen 
                      ? "border-blue-500 ring-2 ring-blue-200 bg-blue-50" 
                      : "border-gray-300 hover:border-gray-400 bg-white"
                  }`}
                >
                  <span className={`truncate ${
                    adsFilter?.networks?.length === 0 ? "text-gray-400" : "text-gray-800"
                  }`}>
                    {adsFilter?.networks?.length === 0 
                      ? 'Select networks...'
                      : adsFilter?.networks?.length === allNetworkValues?.length
                        ? 'All networks selected'
                        : `${adsFilter?.networks?.length} selected`}
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
                      className={`px-4 py-2.5 flex items-center justify-between cursor-pointer ${
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
                    
                    <div className="max-h-25 overflow-y-auto border-t border-gray-100">
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
           <div className="relative">
             <button 
               onClick={(e) => {
                 e.preventDefault();
                 setAdsTypeDropdownOpen(!adsTypeDropdownOpen);
                 setNetworkDropdownOpen(false);
               }}
               className={`w-full flex items-center justify-between !border-[#d1d5db] px-4 py-2.5 text-left !rounded-lg !border transition-all duration-200 ${
                 adsTypeDropdownOpen
                   ? "border-blue-500 ring-2 ring-blue-200 bg-blue-50" 
                   : "border-gray-300 hover:border-gray-400 bg-white"
               }`}
             >
               <span className={`truncate ${
                 adsFilter.adsType==="" ? "text-gray-400" : "text-gray-800"
               }`}>
                 {adsFilter.adsType==="" 
                   ? 
                   'Select Ads Type...'
                   : optionAdsTypes.find(opt => opt.value === adsFilter.adsType)?.label}
               </span>
               <svg 
                 className={`w-5 h-5 text-gray-500 transition-transform duration-200 ${
                   adsTypeDropdownOpen ? "transform rotate-180" : ""
                 }`}
                 fill="none" 
                 stroke="currentColor" 
                 viewBox="0 0 24 24"
               >
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
               </svg>
             </button>
             
             {adsTypeDropdownOpen && (
               <div 
                 className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
                 onClick={(e) => e.stopPropagation()}
               >
                 <div className="max-h-25 overflow-y-auto">
                   {optionAdsTypes.map(option => (
                     <div 
                       key={option.value}
                       className={`px-4 py-2.5 flex items-center cursor-pointer ${
                         adsFilter.adsType === option.value 
                           ? "bg-blue-50 text-blue-700 font-medium" 
                           : "hover:bg-gray-50 text-gray-700"
                       }`}
                       onClick={(e) => {
                         e.stopPropagation();
                         setAdsFilter(prev => ({
                           ...prev,
                           adsType: prev.adsType === option.value ? '' : option.value
                         }));
                         setAdsTypeDropdownOpen(false);
                       }}
                     >
                       <span>{option.label}</span>
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
                    value={adsFilter.min}
                    onChange={(e) => setAdsFilter({...adsFilter, min: e.target.value})}
                    className="w-full pl-3 pr-2 py-2 border border-[#d1d5db] rounded-lg"
                  />
                </div>
                <span className="text-gray-500">to</span>
                <div className="relative flex-1">
                  <input
                    type="number"
                    placeholder="Max"
                    value={adsFilter.max}
                    onChange={(e) => setAdsFilter({...adsFilter, max: e.target.value})}
                    className="w-full pl-3 pr-2 py-2 border border-[#d1d5db] rounded-lg"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              {/* <label className="block text-sm font-medium text-gray-700">Platforms</label> */}
              <div className="flex flex-wrap gap-2">  
                {platFormOptions.map(option => (
                  <div 
                    key={option.value}
                    className={`px-3 py-1 rounded-full text-sm border cursor-pointer ${
                      adsFilter?.alert === option.value 
                        ? 'bg-blue-100 border-blue-500 text-blue-700' 
                        : 'bg-gray-100 border-gray-300 text-gray-700'
                    }`}
                    onClick={() => handlePlatFormChange(option)}
                  >
              <div className='flex items-center justify-between '>
              <svg 
               data-tooltip-id="Active-tooltip"
               data-tooltip-content={option.value=="red"?"System/Chrome profile is inactive": "No ads fetched from the account"}
                className={`w-5 h-5 text-${option.value}-500 cursor-pointer focus:!outline-none `} 
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
            className="!z-9990 !text-[12px] !bg-[#d2dfff] !text-[#1f296a] !rounded-[20px] px-2 !py-0.75"
            delayShow={100}
          />
          {option.label}
            </div>
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

      {/* Table Content */}
      {loadingSystemInfoAccount ? (
        <div className="w-full !py-[18px] !px-[26px] !bg-white !rounded-[10px] h-[756px] flex flex-col">
          {/* Loading Shimmer */}
          <div className="overflow-auto w-full flex-grow">
            <table className="min-w-full border-collapse">
              <thead className="sticky top-0 !rounded-[10px] z-[26]">
                <tr className="!rounded-[10px] !bg-[#f9f9fb]">
                  {[...Array(5)].map((_, i) => (
                    <th key={i} className="!px-4 !py-3 !h-[53px] text-left">
                      <div className="h-6 bg-gray-200 rounded shimmer" style={{ width: `${Math.random() * 100 + 100}px` }}></div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...Array(10)].map((_, rowIndex) => (
                  <tr key={rowIndex} className={`!h-[98px] border-t ${rowIndex % 2 === 0 ? "bg-[#fff]" : "bg-white"}`}>
                    {[...Array(5)].map((_, cellIndex) => (
                      <td key={cellIndex} className="!px-5 !py-4">
                        <div className="flex items-center">
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
              <div className="h-5 bg-gray-200 rounded shimmer" style={{ width: '200px' }}></div>
              <div className="border border-[#d1d5db] rounded-lg px-3 py-1.5">
                <div className="h-5 bg-gray-200 rounded shimmer" style={{ width: '100px' }}></div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {[...Array(7)].map((_, i) => (
                <div 
                  key={i} 
                  className={`!h-[29px] !w-[36px] !rounded-[9px] !border !border-[#cbcbcb] ${i === 3 ? "!bg-[#9ca9ff]" : "bg-gray-200"} shimmer`}
                ></div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        // <div className="w-full !py-[18px] !px-[26px] !bg-white !rounded-[10px] h-[740px] flex flex-col">
        //   <div className="overflow-auto w-full flex-grow relative">
        //     <div className="min-w-full">
        //       <table className="w-full border-collapse">
        //         <thead className="sticky top-0 !rounded-[10px] z-[26] bg-[#f9f9fb]">
        //           {table.getHeaderGroups().map((headerGroup) => (
        //             <tr key={headerGroup.id}>
        //               {headerGroup.headers.map((header, index) => (
        //                 <th
        //                   key={header.id}
        //                   className={`
        //                     !px-4 !py-3 !h-[53px] text-left text-[16px] font-[400] 
        //                     text-[#575757] hover:text-[#1f296a] sticky top-0 bg-[#f9f9fb]
        //                     ${index === 0 ? 'sticky left-0 z-[27]' : ''}
        //                   `}
        //                 >
        //                   {flexRender(
        //                     header.column.columnDef.header,
        //                     header.getContext()
        //                   )}
        //                 </th>
        //               ))}
        //             </tr>
        //           ))}
        //         </thead>
        //         {table.getRowModel().rows.length > 0 ? (
        //           <tbody>
        //             {table.getRowModel().rows.map((row, rowIndex) => (
        //               <tr
        //                 key={row.id}
        //                 className={`!h-[98px] border-t ${
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
        //                 {globalFilter ? 'No matching accounts found' : 'No accounts available'}
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
                     {table.getHeaderGroups().map((headerGroup) => (
                       <tr key={headerGroup.id}>
                         {headerGroup.headers.map((header, index) => (
                           <th
                             key={header.id}
                             className={`
                               !px-4 !py-3 !h-[53px] text-left text-[16px] font-[400] 
                               text-[#575757] hover:text-[#1f296a] sticky top-0 bg-[#f9f9fb]
                               border-b border-t border-[#e5e7eb]
                               ${index === 0 ? 'sticky left-0 z-[27]' : ''}
                             `}
                           >
                             {flexRender(header.column.columnDef.header, header.getContext())}
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
                             key={cell.id}
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
                  ) : (
                  <tbody>
                    <tr>
                      <td 
                        colSpan={table?.getAllColumns()?.length}
                        className="!h-[98px] text-center !text-[14px] !text-[#1f1f1f] !font-[400]"
                      >
                        {globalFilter ? 'No matching accounts found' : 'No accounts available'}
                      </td>
                    </tr>
                  </tbody>
                )}
                 </table>
               </div>
          {/* Pagination */}
          <div className="flex items-center justify-between mt-4 px-4 border-t border-[#e5e7eb] pt-4">
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
                  table.setPageSize(Number(e.target.value));
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
                onClick={() => table?.setPageIndex(0)}
                disabled={!table?.getCanPreviousPage()}
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
  );
});

export default AccountPerformanceTable;