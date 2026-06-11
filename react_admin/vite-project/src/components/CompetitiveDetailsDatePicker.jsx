import React, { useState, useRef, useEffect, use } from "react";
import { DateRange } from "react-date-range";
import { FiCalendar } from "react-icons/fi";
import "react-date-range/dist/styles.css";
import "react-date-range/dist/theme/default.css";
import { set } from "date-fns";
import { CiFilter } from "react-icons/ci";
import { is } from "date-fns/locale";

const CustomDateRangePicker = ({ 
  initialStartDate = new Date(), 
  initialEndDate = new Date(),
  onDateChange,
  setSelectedSystem,
  setShowFilterModal,
 
}) => {
  const [range, setRange] = useState([
    {
      startDate: new Date(),
      endDate: new Date(),
      key: "selection",
    },
 ] );
  const [isInitialLoad, setIsInitialLoad] = useState(false);
    const [filterOn,setFilterOn] = useState(false);
  
  const [tempRange, setTempRange] = useState(range);
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef();

  const handleDateChange = (ranges) => {
    setTempRange([ranges.selection]);
  };

  const handleApply = () => {
    setRange(tempRange);
    setSelectedSystem(null)
    setIsInitialLoad(true);
    if (onDateChange) {
      onDateChange(tempRange[0].startDate, tempRange[0].endDate);
    }
    setIsOpen(false);
  };

  const handleCancel = () => {
    setTempRange(range);
    setIsOpen(false);
  };

  const formatDate = (date) => {
    return `${date.getDate().toString().padStart(2, "0")}-${(date.getMonth() + 1)
      .toString()
      .padStart(2, "0")}-${date.getFullYear()}`;
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setIsOpen(false);
        setTempRange(range); // Reset to original range when clicking outside
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [range]);

  
const handleClearDate = () => { 
    if(isInitialLoad) {
setTempRange([
        {
            startDate: new Date(),
            endDate: new Date(),
            key: "selection",
        },
        ]);
        setRange([
        {
            startDate: new Date(),
            endDate: new Date(),
            key: "selection",
        },
        ]);
        setIsInitialLoad(false);
        onDateChange(null, null)
    }
}
  

  return (
    <div className="flex gap-[10px] items-center" ref={ref}>
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() =>{setIsOpen(!isOpen); setShowFilterModal(false);}}
        className="flex items-center gap-2 px-3 py-2 text-sm font-medium border rounded-md shadow-sm transition bg-white text-gray-800"
      >
        <FiCalendar className="w-4 h-4 text-gray-600" />
        <span className="text-xs">
        {
            isInitialLoad
              ? `${formatDate(range[0].startDate)} - ${formatDate(range[0].endDate)}`
              : ""
        }  
        </span>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-2 shadow-lg border rounded-md bg-white !right-0 competetive-details-datepicker">
          <DateRange
            ranges={tempRange}
            onChange={handleDateChange}
            moveRangeOnFirstSelection={false}
        
            //   initialFocusedRange={null}
            //   focusedRange={[0, 0]}
             rangeColors={["#5C61F2"]}
            minDate={new Date("2020-01-01")}
            maxDate={new Date()}
          />
          <div className="flex gap-2 justify-end p-2">
            <button
              onClick={handleCancel}
              className="px-3 py-1 mr-2 text-sm !text-gray-600 bg-gray-100 !rounded-2xl hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="px-3 py-1 text-sm !text-white bg-[#5C61F2] !rounded-2xl hover:bg-[#4a4fc9]"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div></div>
  );
};

export default CustomDateRangePicker;