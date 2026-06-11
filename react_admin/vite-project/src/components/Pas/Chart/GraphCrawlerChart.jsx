import React, { useState, useEffect } from "react";
import ReactApexChart from "react-apexcharts";

const ApexChart = ({ graph}) => {
  const getLastSixMonths = () => {
    const months = [];
    const currentDate = new Date();
    
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(currentDate.getMonth() - i);
      months.push(d.toLocaleString("default", { month: "short" }));
    }

    return months;
  };
  const platformMapping = {
    "3": "User Plugin",
    "10": "Scroll Plugin",
    "12": "Python Crawler",
    "15": "Meta",
    "Total": "Total"
  };
 
  const transformGraphData = () => {
    const result = [];
    const totalData = [0, 0, 0, 0, 0, 0];
    const expectedLength = totalData?.length;
  
    Object.keys(platformMapping)?.forEach(key => {
      if (key === "Total") return;
      const filteredGraph = graph?.filter(item => item?.platform !== "Total");
      const dataItem = filteredGraph?.find(item => item?.platform == key);
      let dataArray = dataItem ? dataItem?.data?.slice(0, expectedLength) : [];
      while (dataArray?.length < expectedLength) {
        dataArray?.push(0);
      }

      for (let i = 0; i < expectedLength; i++) {
        totalData[i] += dataArray[i];
      }
      result?.push({
        name: platformMapping?.[key],
        data: dataArray
      });
    });
  
    result?.push({
      name: platformMapping["Total"],
      data: totalData
    });
    return result;
  };
  const [state, setState] = useState({
    series: transformGraphData(),
    options: {
      chart: {
        height: 350,
        type: "area",
        toolbar: { show: false },
      },
      dataLabels: { enabled: false },
      fill: { opacity: 0 },
      stroke: { curve: "smooth" },
      xaxis: {
        categories: getLastSixMonths(),
        labels: { style: { colors: "#8e8da4", fontSize: "12px" } }
      },
      yaxis: {
        labels: {
          formatter: (val) => val + "", 
          style: { colors: "#8e8da4", fontSize: "12px" }
        }
      },
      tooltip: {
        y: {
          formatter: (val) => `${val.toLocaleString()} ${val.toLocaleString()>"1"?"Ads":"Ad"} `,  // Formatting number with thousands separator
          title: {
            // formatter: (seriesName) => `Platform: ${seriesName}`,  // Customizing title
            style: {
              fontSize: "14px",
              fontWeight: "bold",
              color: "#FFA500"  // Custom title color
            }
          }
        },
      },
      legend: {
        position: "top",
        horizontalAlign: "center"
      }
    }
  });

  useEffect(() => {
    setState((prevState) => ({
      ...prevState,
      series: transformGraphData(),
      options: { ...prevState?.options, xaxis: { categories: getLastSixMonths() } }
    }));
  }, [graph]);

  return (
    <div className="px-[26px] pt-[12px] h-[297px] xl:h-auto">
      <div id="chart" className="graphChart">
        <ReactApexChart
          options={state.options}
          series={state.series}
          type="area"
          height={285}
        />
      </div>
    </div>
  );
};

export default ApexChart;
