import React, { useState, useMemo } from 'react';
import Chart from 'react-apexcharts';

const AffiliateNetworksStackedChart = ({ adsAffiliateData }) => {

  const colors = [
    '#ff7f0e', '#f5a6ff', '#6495ED', '#32CD32', '#90EE90', '#1E90FF', '#FF6347', '#FFD700', '#FF69B4',
    '#8A2BE2', '#20B2AA', '#DC143C', '#00FF7F', '#4682B4', '#FF4500', '#ADFF2F', '#7B68EE', '#D2691E',
    '#00CED1', '#FFA500', '#DB7093', '#B22222', '#00BFFF', '#7FFF00', '#9400D3', '#40E0D0', '#FF1493',
    '#8B0000', '#32CD32', '#9932CC', '#FA8072', '#808000', '#6B8E23', '#FF8C00', '#1E90FF', '#2E8B57',
    '#FF6347', '#A52A2A', '#DA70D6', '#556B2F', '#CD5C5C', '#708090', '#778899', '#FF00FF', '#FFDAB9',
    '#EE82EE', '#00FA9A', '#FFB6C1', '#191970', '#4682B4'
  ];

  const allItems = adsAffiliateData?.data?.map((item,index) => ({
    color: colors[index],
    label: item.e_commerce,
    value: item.count,
  })) || [];

  const [selected, setSelected] = useState(allItems.map(item => item.label)); // Initially select all


  const handleSelect = (label, index) => {
    setSelected((prev) => {
      if (prev.includes(label)) {
        // Deselect: Remove the label
        return prev.filter((item) => item !== label);
      } else {
        // Select: Insert at the original index (if possible)
        const newSelected = [...prev];
        newSelected.splice(index, 0, label); // Insert at the original position
        return newSelected;
      }
    });
  };

  // Filter data dynamically
  const filteredData = useMemo(() => {
    return adsAffiliateData?.data
      ?.filter(item => selected.includes(item.e_commerce))
      ?.map(item => item.count) || [];
  }, [selected, adsAffiliateData]);

  const options = {
    chart: { type: 'area', stacked: true, toolbar: { show: false } },
    legend: { show: false },
    colors: colors.slice(0, filteredData?.length),
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth' },
    xaxis: {
      categories: selected,
      labels: {
        style: { fontSize: '13px', fontWeight: 400, color: '#615E83', fontFamily: 'Public Sans' },
        offsetY: 2,
      },
    },
    yaxis: {
      labels: {
        formatter: (val) => (val >= 1000 ? (val / 1000).toFixed(0) + 'k' : val.toFixed(0)),
        style: { fontSize: '14px', fontWeight: 400, color: '#615E83', fontFamily: 'Public Sans' },
        offsetX: -2,
      },
    },
    fill: {
      type: 'gradient',
      gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.1 },
    },
    markers: { size: 5 },
    tooltip: {
      shared: true,
      intersect: false,
      // theme: "dark",  // You can change it to "light"
      style: {
        fontSize: "14px",  // Change font size
        fontFamily: "Arial, sans-serif",
        color: "#ffffff"  // Tooltip text color
      },
      y: {
        formatter: (val) => `${val.toLocaleString()} Ads`,  // Formatting number with thousands separator
        title: {
          // formatter: (seriesName) => `Platform: ${seriesName}`,  // Customizing title
          style: {
            fontSize: "14px",
            fontWeight: "bold",
            color: "#264688"  // Custom title color
          }
        }
      },
      background: {
        borderRadius: 5,  // Rounded corners
        backgroundColor: "#fff",  // Background color of tooltip
        borderColor: "#FFA500",  // Border color
      }
    }
  };
  const series = [{ name: '', data: filteredData }];

  return (
      <>
      <div className="chart_container px-2">
        <Chart options={options} series={series} type="area" height={350} />
      </div>
      <hr className="opacity-10" />
      <div className="flex items-center space-x-7 p-6">
        <div className="flex items-center space-x-2 bg-[#F9F9FB] border border-[#E0E0E0] rounded-lg p-2 px-3">
          <input
            id="select-all"
            type="checkbox"
            className="w-4 h-4 border-gray-400"
            checked={selected?.length === allItems?.length}
            onChange={() => setSelected(selected?.length === allItems?.length ? [] : allItems?.map(item => item?.label))}
          />
          <label htmlFor="select-all" className="text-[#615E83] cursor-pointer text-sm font-medium">
            Select All
          </label>
        </div>
        <div className="grid md:grid-cols-4 sm:grid-cols-3 grid-cols-2 gap-x-8 gap-y-2.5">
          {allItems.map((item, index) => (
            <div key={index} className="flex items-center space-x-2 justify-between rounded-[20px]">
              <div className="relative w-4 h-4 flex items-center justify-center">
                <div className="w-4 h-4 rounded-full border-2" style={{ borderColor: item.color }}></div>
                <div
                  className={`w-2 h-2 rounded-full absolute transition-colors ${selected.includes(item.label) ? 'bg-current' : 'bg-white'}`}
                  style={{ backgroundColor: selected.includes(item.label) ? item.color : 'white' }}
                ></div>
              </div>
              <label
                htmlFor={item.label}
                className="text-[#615E83] text-sm font-medium text-left w-full cursor-pointer"
                onClick={() => handleSelect(item.label,index)}
              >
                {item.label}
              </label>
              <span className="text-[#615E83] text-sm font-bold ml-1">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
      </>
  );
};

export default AffiliateNetworksStackedChart;
