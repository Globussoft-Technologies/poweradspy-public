import React from 'react';
import {
  AreaChart,
  Area,
  Tooltip,
} from 'recharts';

const SparklineChart = ({ data }) => {
  const formattedData = data?.map((item) => (
    {   
    value:item?.value,
    fullDate: item?.date || item?.timestamp
  }));

  // Determine trend color
  const isUptrend = formattedData && 
  Array.isArray(formattedData) &&
  formattedData?.length > 0 &&
  formattedData[formattedData?.length - 1]?.value !== undefined &&
  formattedData[0]?.value !== undefined &&
  formattedData[formattedData?.length - 1]?.value >= formattedData[0]?.value;
  const color = isUptrend ? '#00C49F' : '#FF4D4F'; // green or red
  const gradientId = `gradient-${color?.replace('#', '')}`;

  function formatUnixTimestamp(timestamp) {
    const date = new Date(timestamp * 1000); // Convert seconds to milliseconds
    const year = date?.getFullYear();
    const month = String(date?.getMonth() + 1)?.padStart(2, '0'); // Months are 0-indexed
    const day = String(date?.getDate())?.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return (
    <AreaChart width={80} height={30} data={formattedData}>
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
  contentStyle={{
    zIndex: 99999, // High z-index to ensure it appears above other elements
    borderRadius: '8px', // Optional: adds rounded corners
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)', // Optional: adds subtle shadow
  }}
  wrapperStyle={{
    zIndex: 99999, // Ensures the entire tooltip container has high z-index\
    right:"0px",
    left:"revert"
  }}
/> {/* Hides tooltip for cleaner sparkline */}
    </AreaChart>
  );
};

export default SparklineChart;
