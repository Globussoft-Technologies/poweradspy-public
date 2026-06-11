import React, { useState, useRef, useEffect } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

const DateRangePickerCustom = ({ startDate, endDate, onChange }) => {
  const [open, setOpen] = useState(false);
  const [tempStart, setTempStart] = useState(startDate || null);
  const [tempEnd, setTempEnd] = useState(endDate || null);
  const ref = useRef(null);

  useEffect(() => {
    setTempStart(startDate || null);
    setTempEnd(endDate || null);
  }, [startDate, endDate]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fmt = (date) =>
    date
      ? date.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" })
      : null;

  const label = () => {
    if (startDate && endDate) return `📅 ${fmt(startDate)} – ${fmt(endDate)}`;
    if (startDate) return `📅 ${fmt(startDate)}`;
    return "📅 Select Date Range";
  };

  const handleChange = ([start, end]) => {
    setTempStart(start);
    setTempEnd(end);
  };

  const handleApply = () => {
    onChange(tempStart, tempEnd);
    setOpen(false);
  };

  const handleClear = () => {
    setTempStart(null);
    setTempEnd(null);
    onChange(null, null);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((p) => !p)}
        className="custom-date-picker"
        style={{ width: "auto", minWidth: 160 }}
      >
        {label()}
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-1 bg-white border border-[#dee2e6] rounded-lg shadow-lg p-4"
          style={{ minWidth: 260 }}
        >
          <DatePicker
            selected={tempStart}
            onChange={handleChange}
            startDate={tempStart}
            endDate={tempEnd}
            selectsRange
            inline
          />

          <div className="flex gap-2 mt-3">
            <button
              onClick={handleClear}
              className="flex-1 py-2 rounded-md border border-[#dee2e6] text-sm text-[#343A40] hover:bg-gray-100 transition"
            >
              Clear Filter
            </button>
            <button
              onClick={() => setOpen(false)}
              className="flex-1 py-2 rounded-md border border-[#dee2e6] text-sm text-[#343A40] hover:bg-gray-100 transition"
            >
              Close
            </button>
          </div>
          {(tempStart || tempEnd) && (
            <button
              onClick={handleApply}
              className="w-full mt-2 py-2 rounded-md bg-[#1f296a] text-white text-sm font-semibold hover:bg-[#2c3a8c] transition"
            >
              Apply
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default DateRangePickerCustom;
