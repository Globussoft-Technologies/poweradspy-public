import React, { useRef, useEffect } from "react";
import { DateRangePicker } from "react-date-range";
import "react-date-range/dist/styles.css";
import "react-date-range/dist/theme/default.css";

const RangeDatePicker = ({ selectedDates, onDateChange, onApply, onCancel }) => {

  return (
    <div
      className="absolute top-[100%] mt-2 right-0 z-50 bg-white shadow-lg border border-gray-300 rounded-lg p-2"
    >
      <div className="p-4 bg-white shadow-md rounded-lg text-[#264688] relative">
        <DateRangePicker
          ranges={[{ startDate: selectedDates.startDate, endDate: selectedDates.endDate, key: "selection" }]}
          onChange={onDateChange }
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
