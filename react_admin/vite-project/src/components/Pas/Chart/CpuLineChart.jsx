import React from 'react';
import { AreaChart, Area, XAxis, Tooltip } from 'recharts';

const CpuLineChart = ({ data, width = 150, height = 60 }) => {
  
  const formattedData = data?.map((item,index) => ({
    // name: date[index]?.split('-').slice(1).join('/') || "N/A", // Format as "11/10"
    value:item.value,
    fullDate: item.date || "N/A"
  }));

  const color = '#1E90FF';
  const gradientId = `gradient-${color?.replace('#', '')}`;

  function formatUnixTimestamp(timestamp) {
    const date = new Date(timestamp * 1000); // Convert seconds to milliseconds
    const year = date.getFullYear();
    const month = String(date?.getMonth() + 1)?.padStart(2, '0'); // Months are 0-indexed
    const day = String(date?.getDate())?.padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  }

  return (
    <AreaChart width={width} height={height} data={formattedData}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.5} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <Area
        type="monotone"
        dataKey="value"
        stroke={color}
        fill={`url(#${gradientId})`}
        strokeWidth={2}
        dot={false}
      />
      <Tooltip 
  formatter={(value, name, props) => [
    `Value: ${Number(value)?.toFixed(2)}`, 
    `Date: ${formatUnixTimestamp(props?.payload?.fullDate)}`
  ]}
  labelFormatter={() => ''}
  wrapperStyle={{
    zIndex: 99999, // Ensures the entire tooltip container has high z-index\
    right:"0px",
    left:"revert",
    top:"-12px!important"
  }}
/>
    </AreaChart>
  );
};

export default CpuLineChart;