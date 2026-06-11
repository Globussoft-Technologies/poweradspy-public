import React, { useEffect } from 'react';
import Chart from 'react-apexcharts';

const FunnelAdsChart = ({funnelData}) => {

     function extractFunnelKeys(data,key) {
      return data?.map(item => item[key]);
  }

  const options = {
    chart: {
      height: 300,
      type: 'bar',
      fontFamily: 'Public Sans',
      toolbar: {
        show: false,
      },
    },
    colors: [
      '#FFB25A',
      '#FFC3FB',
      '#6993FF',
      '#0BB783',
      '#94B7FB',
      '#D2A8FF',
      '#CEF1AB',
      '#FFC0C1',
      '#FF7A90',
      '#3AC4FF',
      '#FF963A',
      '#F077C0',
      '#FF5F49',
      '#54B63B'  
    ],
    plotOptions: {
      bar: {
        columnWidth: '50%',
        distributed: true,
        borderRadius: 3,
        barHeight: '90%',
        barAlign: 'center',
      },
    },
    states: {
      hover: {
        filter: {
          type: 'none',
        },
        opacity: 1,
      },
      active: {
        allowMultipleDataPointsSelection: false,
        filter: {
          type: 'none',
        },
      },
    },
    fill: {
      opacity: 1,
    },
    dataLabels: {
      enabled: false,
    },
    legend: {
      show: false,
    },
    xaxis: {
      categories: extractFunnelKeys(funnelData?.data,"funnel_key"),
      labels: {
        offsetX: 0,
        style: {
          colors: '#615E83',
          fontSize: '11px',
          fontWeight: '500',
          fontFamily: 'Public Sans',
        },
      },
    },
    yaxis: {
      labels: {
        style: {
          colors: '#615E83',
          fontWeight: '600',
          fontSize: '14px',
          fontFamily: 'Public Sans',
        },
      },
    },
    grid: {
      show: true,
      borderColor: '#E5E5EF',
      strokeDashArray: 4,
      xaxis: {
        lines: {
          show: false,
        },
      },
      yaxis: {
        lines: {
          show: true,
        },
      },
    },
  };

  const series = [
    {
      data: extractFunnelKeys(funnelData?.data,"count"),
    },
  ];

  
  return (
    <div>
      <div className="chart_container px-2">
        <Chart options={options} series={series} type="bar" height={300} />
      </div>
    </div>
  );
};

export default FunnelAdsChart;
