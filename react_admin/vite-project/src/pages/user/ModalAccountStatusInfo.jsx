import React, { useEffect, useRef, useState } from 'react';
import * as am5 from '@amcharts/amcharts5';
import * as am5xy from '@amcharts/amcharts5/xy';
import am5themes_Animated from '@amcharts/amcharts5/themes/Animated';

const ModalAccountStatusInfo = ({ AccountInfo, loadingStatusAccountInfo, dateRange1, onClose, onStageClick }) => {
  const chartRef = useRef(null);
  const [filteredStatus, setFilteredStatus] = useState(null);
  
  // Function to format seconds to HH:MM:SS
  const formatSecondsToTime = (timeString) => {
    if (!timeString) return "00:00:00";
    
    const parts = timeString?.split(':');
    if (parts?.length !== 3) return timeString;
    
    const [hours, minutes, seconds] = parts?.map(part => 
      parseInt(part, 10)?.toString()?.padStart(2, '0')
    );
    
    return `${hours}:${minutes}:${seconds}`;
  };


  useEffect(() => {
    if (loadingStatusAccountInfo || !AccountInfo || !AccountInfo.timeline?.length) return;

    const root = am5?.Root?.new(chartRef?.current);
    root?.setThemes([am5themes_Animated?.new(root)]);
    root?._logo?.dispose();

    // Create chart with scrollbar
    const chart = root?.container?.children?.push(
      am5xy?.XYChart?.new(root, {
        panX: true,
        panY: false,
        wheelX: "panX",
        wheelY: "zoomX",
        layout: root?.verticalLayout,
        pinchZoomX: true
      })
    );

    // Add scrollbar
    const scrollbar = chart?.set("scrollbarX", am5?.Scrollbar?.new(root, {
      orientation: "horizontal"
    }));

    // Process the data - convert Unix timestamps to milliseconds
    const processedData = AccountInfo?.timeline?.map(item => ({
      ...item,
      from: item?.from * 1000, // Convert to milliseconds
      to: item?.to * 1000,
      columnSettings: {
        fill: am5?.color(parseInt(item?.columnSettings?.fill?.split('(')[1]?.split(')')[0], 16))
      }
    }));

    // Filter data based on selected status
    const getFilteredData = () => {
      if (!filteredStatus) return processedData;
      return processedData?.filter(item => item?.name?.toLowerCase() === filteredStatus?.toLowerCase());
    };

    // Create axes
    const yAxis = chart?.yAxes?.push(
      am5xy?.CategoryAxis?.new(root, {
        categoryField: "category",
        renderer: am5xy?.AxisRendererY?.new(root, {}),
        tooltip: am5?.Tooltip?.new(root, {})
      })
    );
    
    // Set category data with unique categories
    const uniqueCategories = [...new Set(processedData?.map(item => item?.category))];
    yAxis?.data?.setAll(uniqueCategories?.map(category => ({ category })));

    const xAxis = chart?.xAxes?.push(
      am5xy?.DateAxis?.new(root, {
        baseInterval: { timeUnit: "second", count: 1 },
        renderer: am5xy?.AxisRendererX?.new(root, {}),
        min: processedData[0]?.from, // Set min to first timestamp
        max: processedData[processedData?.length - 1]?.to, // Set max to last timestamp
        tooltip: am5?.Tooltip?.new(root, {})
      })
    );

    xAxis?.get("renderer")?.labels?.template?.setAll({
      fontSize: 10,
      rotation: -45,
      dy: 20,
      centerX: am5?.p50
    });
    xAxis?.get("renderer")?.labels?.template?.set("visible", false);
    xAxis?.get("renderer")?.grid?.template?.set("visible", false);
    xAxis?.get("renderer")?.ticks?.template?.set("visible", false);

    // Create a transparent container to capture hover events
    const hoverArea = root?.container?.children?.push(
      am5?.Container?.new(root, {
        width: am5?.percent(100),
        height: am5?.percent(100),
        interactive: true
      })
    );

    // Show labels/grid/ticks on hover
    hoverArea?.events?.on("pointerover", () => {
      xAxis?.get("renderer")?.labels?.template?.set("visible", true);
      xAxis?.get("renderer")?.grid?.template?.set("visible", true);
      xAxis?.get("renderer")?.ticks?.template?.set("visible", true);
    });

    // Hide again when hover ends
    hoverArea?.events?.on("pointerout", () => {
      xAxis?.get("renderer")?.labels?.template?.set("visible", false);
      xAxis?.get("renderer")?.grid?.template?.set("visible", false);
      xAxis?.get("renderer")?.ticks?.template?.set("visible", false);
    });
    
    // Add series
    const series = chart?.series?.push(
      am5xy?.ColumnSeries?.new(root, {
        xAxis: xAxis,
        yAxis: yAxis,
        valueXField: "to",
        openValueXField: "from",
        categoryYField: "category",
        sequencedInterpolation: true
      })
    );

    series?.columns?.template?.setAll({
      strokeWidth: 0,
      strokeOpacity: 0,
      height: am5?.percent(80),
      templateField: "columnSettings",
      tooltipText: "{category}: {name}\nFrom: {openValueX.formatDate('yyyy-MM-dd HH:mm:ss')}\nTo: {valueX.formatDate('yyyy-MM-dd HH:mm:ss')}"
    });

    // Set initial data
    series?.data?.setAll(getFilteredData());

    // Add cursor
    chart?.set("cursor", am5xy?.XYCursor?.new(root, {
      behavior: "zoomX",
      xAxis: xAxis,
      snapToSeries: [series]
    }));

    // Create axis ranges for each column
    for (let i = 0; i < processedData?.length; i++) {
      const rangeDataItem = xAxis?.makeDataItem({
        value: processedData[i]?.from
      });
      
      const range = xAxis?.createAxisRange(rangeDataItem);
      
      rangeDataItem?.get("grid")?.set("forceHidden", true);
      
      rangeDataItem?.get("tick")?.setAll({
        visible: true,
        length: 18,
        strokeOpacity: 0.2
      });
      
      rangeDataItem?.get("label")?.setAll({
        centerX: am5.p0,
        forceHidden: false,
        fontSize: 10,
        text: root?.dateFormatter?.format(new Date(processedData[i]?.from), "HH:mm:ss")
      });
    }

    // Add legend
    const legend = chart?.children?.push(
      am5?.Legend?.new(root, {
        nameField: "name",
        fillField: "color",
        strokeField: "color",
        centerX: am5?.percent(50),
        x: am5?.percent(50)
      })
    );

    // Generate legend items based on unique status names
    const uniqueStatuses = [...new Set(processedData?.map(item => item?.name))];
    legend?.data?.setAll(
      uniqueStatuses?.map(status => ({
        name: status,
        color: processedData?.find(item => item?.name === status)?.columnSettings?.fill,
        visible: filteredStatus ? (status?.toLowerCase() === filteredStatus?.toLowerCase() || !filteredStatus) : true
      }))
    );

    // Add click event to legend items
    legend?.itemContainers?.template?.events?.on("click", (ev) => {
      const item = ev?.target?.dataItem?.dataContext;
      if (item) {
        if (filteredStatus === item?.name?.toLowerCase()) {
          // Clicked on already filtered item - show all
          setFilteredStatus(null);
        } else {
          // Filter by clicked status
          setFilteredStatus(item?.name?.toLowerCase());
        }
      }
    });

    // Add tooltip
    series?.set("tooltip", am5?.Tooltip?.new(root, {
      labelText: "{category}: {name}\nFrom: {openValueX.formatDate('yyyy-MM-dd HH:mm:ss')}\nTo: {valueX.formatDate('yyyy-MM-dd HH:mm:ss')}"
    }));

    // Make stuff animate on load
    series?.appear();
    chart?.appear(1000, 100);

    // Update chart when filteredStatus changes
    const handleFilterChange = () => {
      series?.data?.setAll(getFilteredData());
      
      // Update legend to show which status is selected
      legend?.data?.setAll(
        uniqueStatuses?.map(status => ({
          name: status,
          color: processedData?.find(item => item?.name === status)?.columnSettings?.fill,
          visible: true,
          opacity: filteredStatus ? 
            (status?.toLowerCase() === filteredStatus?.toLowerCase() ? 1 : 0.3) : 
            1
        }))
      );
    };

    // Add event listener for filteredStatus changes
    const seriesListener = series?.events?.on("datavalidated", handleFilterChange);

    return () => {
      series?.events?.off("datavalidated", seriesListener);
      root?.dispose();
    };
  }, [AccountInfo, filteredStatus, loadingStatusAccountInfo]);

  return (
    <div className="p-4 w-full h-full z-9999">
      <div className="flex justify-between items-center mb-4">
        <h4 className="text-md font-semibold text-gray-800">Account Status Timeline</h4>
        <button 
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700 focus:outline-none"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 outline-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {loadingStatusAccountInfo ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      ) : (
        <>
          {/* Status Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 ">
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">Total Active Time</p>
                  <p className="text-2xl font-semibold text-gray-800">
                    {formatSecondsToTime(AccountInfo?.totalActive)}
                  </p>
                </div>
                <div className="p-3 rounded-full bg-green-100 text-green-600">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-red-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">Total Inactive Time</p>
                  <p className="text-2xl font-semibold text-gray-800">
                    {formatSecondsToTime(AccountInfo?.totalInactive)}
                  </p>
                </div>
                <div className="p-3 rounded-full bg-red-100 text-red-600">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          <div id="chartdiv" ref={chartRef} style={{ width: '100%', height: '200px' }} />
        </>
      )}
    </div>
  );
};

export default ModalAccountStatusInfo;