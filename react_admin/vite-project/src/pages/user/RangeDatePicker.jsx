import React, { useRef, useEffect } from "react";
import { DateRangePicker } from "react-date-range";
import "react-date-range/dist/styles.css";
import "react-date-range/dist/theme/default.css";

// minDate/maxDate are optional. Left out, react-date-range falls back to its own defaults
// (today -100y .. today +20y), which is why the year dropdown otherwise lists 1926-2046.
const RangeDatePicker = ({ selectedDates, onDateChange, onApply, onCancel, minDate, maxDate }) => {

  return (
    <div
      className="absolute top-[100%] mt-2 right-0 z-50 bg-white shadow-lg border border-gray-300 rounded-lg p-2"
    >
      <div className="p-4 bg-white shadow-md rounded-lg text-[#264688] relative">
        <DateRangePicker
          ranges={[{ startDate: selectedDates.startDate, endDate: selectedDates.endDate, key: "selection" }]}
          onChange={onDateChange }
          minDate={minDate}
          maxDate={maxDate}
        />
        <div className="!flex !h-9 !justify-end !space-x-2 ">
        <button className="!px-4 !flex !items-center"
        onClick={(e)=>{e.stopPropagation(); onApply();}} >Apply</button>
        <button className="!px-4 !flex !items-center"
        onClick={(e)=>{e.stopPropagation(); onCancel();}}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

export default RangeDatePicker;
