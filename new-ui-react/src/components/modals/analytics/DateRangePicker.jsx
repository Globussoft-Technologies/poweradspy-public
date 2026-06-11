import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const DateRangePicker = ({ availableYears = [], onApply, isLight }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [startDate, setStartDate] = useState(null); // Date object
  const [endDate, setEndDate] = useState(null); // Date object
  
  // View state for navigation
  const [viewDate, setViewDate] = useState(new Date());
  const [showYearView, setShowYearView] = useState(false);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Calendar logic
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  
  const days = useMemo(() => {
    const arr = [];
    // Padding for previous month
    for (let i = 0; i < firstDayOfMonth; i++) {
        arr.push({ day: null, key: `pad-${i}` });
    }
    // Days of current month
    for (let i = 1; i <= daysInMonth; i++) {
        arr.push({ day: i, key: `day-${i}` });
    }
    return arr;
  }, [year, month, firstDayOfMonth, daysInMonth]);

  const handleDayClick = (day) => {
    const clickedDate = new Date(year, month, day);
    
    if (!startDate || (startDate && endDate)) {
      setStartDate(clickedDate);
      setEndDate(null);
    } else {
      if (clickedDate < startDate) {
        setEndDate(startDate);
        setStartDate(clickedDate);
      } else {
        setEndDate(clickedDate);
      }
    }
  };

  const isInRange = (day) => {
    if (!day || !startDate) return false;
    const current = new Date(year, month, day);
    if (!endDate) return current.getTime() === startDate.getTime();
    return current >= startDate && current <= endDate;
  };

  const isSelected = (day) => {
    if (!day) return false;
    const current = new Date(year, month, day);
    return (startDate && current.getTime() === startDate.getTime()) || 
           (endDate && current.getTime() === endDate.getTime());
  };

  const changeMonth = (offset) => {
    setViewDate(new Date(year, month + offset, 1));
  };

  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const handleApply = () => {
    const start = startDate;
    const end = endDate || startDate;
    
    const formatDateApi = (d) => d.toISOString().split('T')[0];
    
    onApply({ 
      fromDate: formatDateApi(start), 
      toDate: formatDateApi(end), 
      label: `${formatDate(start)} - ${formatDate(end)}` 
    });
    setIsOpen(false);
  };

  const handleReset = () => {
    setStartDate(null);
    setEndDate(null);
    onApply(null);
    setShowYearView(false);
    setIsOpen(false);
  };

  const handleYearSelect = (y) => {
    setViewDate(new Date(y, month, 1));
    setShowYearView(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-[11px] font-bold ${isLight ? 'bg-white border-gray-200 text-gray-700 hover:border-gray-300' : 'bg-black/40 border-white/10 text-white/70 hover:border-white/20'}`}
      >
        <CalendarIcon size={13} className="opacity-60" />
        {startDate ? `${formatDate(startDate)} ${endDate ? `- ${formatDate(endDate)}` : ''}` : 'Select Range'}
      </button>

      {isOpen && (
        <div className={`absolute top-full right-0 mt-2 z-50 w-72 rounded-2xl border p-5 shadow-2xl animate-in fade-in slide-in-from-top-2 ${isLight ? 'bg-white border-gray-200' : 'bg-[#121212] border-white/10'}`}>
          <div className="flex items-center justify-between mb-5">
            <div className="flex flex-col">
              <button 
                onClick={() => setShowYearView(!showYearView)}
                className={`text-[10px] uppercase font-bold tracking-widest text-left transition-colors hover:text-indigo-400 ${isLight ? 'text-gray-400' : 'text-white/20'}`}
              >
                {year}
              </button>
              <span className="text-sm font-bold">{MONTHS[month]}</span>
            </div>
            {!showYearView && (
              <div className="flex gap-1">
                <button onClick={() => changeMonth(-1)} className={`p-1.5 rounded-lg transition-colors ${isLight ? 'hover:bg-gray-100' : 'hover:bg-white/5'}`}>
                  <ChevronLeft size={16} />
                </button>
                <button onClick={() => changeMonth(1)} className={`p-1.5 rounded-lg transition-colors ${isLight ? 'hover:bg-gray-100' : 'hover:bg-white/5'}`}>
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>

          {showYearView ? (
            <div className="grid grid-cols-3 gap-2 mb-5 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar">
              {Array.from({ length: new Date().getFullYear() - 2009 }, (_, i) => new Date().getFullYear() - i).map(y => (
                <button
                  key={y}
                  onClick={() => handleYearSelect(y)}
                  className={`py-2 text-[11px] font-bold rounded-lg transition-all ${
                    y === year ? 'bg-indigo-600 text-white' : (isLight ? 'hover:bg-gray-100 text-gray-600' : 'hover:bg-white/5 text-white/50')
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 mb-2">
                {DAYS.map(d => (
                  <div key={d} className={`text-center text-[10px] font-bold uppercase py-1 ${isLight ? 'text-gray-400' : 'text-white/20'}`}>{d}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1 mb-5">
                {days.map((dObj) => {
                  const selected = isSelected(dObj.day);
                  const active = isInRange(dObj.day);
                  return (
                    <button
                      key={dObj.key}
                      disabled={!dObj.day}
                      onClick={() => handleDayClick(dObj.day)}
                      className={`relative h-8 w-full text-[11px] font-medium rounded-lg transition-all flex items-center justify-center ${
                        !dObj.day ? 'opacity-0 cursor-default' : 
                        selected ? 'bg-indigo-600 text-white z-10 scale-105' :
                        active ? 'bg-indigo-500/20 text-indigo-400 rounded-none first:rounded-l-lg last:rounded-r-lg' :
                        (isLight ? 'hover:bg-gray-100' : 'hover:bg-white/5 text-white/60')
                      }`}
                    >
                      {dObj.day}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="flex items-center gap-2 pt-4 border-t border-white/5">
            <button
              onClick={handleReset}
              className="px-4 py-2 text-[10px] font-bold text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
            >
              Reset
            </button>
            <button
              onClick={handleApply}
              disabled={!startDate}
              className="flex-1 py-2 text-[10px] font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-600/20"
            >
              Apply Range
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DateRangePicker;
