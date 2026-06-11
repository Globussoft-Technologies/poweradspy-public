import React, { useEffect, useRef, useState } from "react";
import { ListFilter } from "lucide-react";
import { GoChevronDown, GoChevronUp } from "react-icons/go";
import Daterangepicker from "../Daterangepicker";
import Select from 'react-select';
import countryList from 'country-list';

const FbAccountFilter = ({ onFilterChange }) => {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [isClicked, setIsClicked] = useState(false);
  // const popoverRef = useRef(null); // ref to the entire component
  const dateref = useRef(null)
  const [dateOpen, setDateOpen] = useState(false);
  const popoverRef = useRef(null);
  
  // Filter states
  const [filters, setFilters] = useState({
    dateRange: { startDate: null, endDate: null },
    city: '',
    accountName: '',
    country: ''
  });
  
  const [dropdownStates, setDropdownStates] = useState({
    date: false,
    city: false,
    account: false,
    country: false
  });

  // Get all countries with country-list library
  const allCountries = countryList.getData().map(country => ({
    value: country.code,
    label: country.name
  }));

  const cityOptions = ["Bhilai", "Bangalore"];

  // Apply filters
  const applyFilters = () => {
    onFilterChange(filters);
    setPopoverOpen(false);
  };

  // Clear filters
  const clearFilters = () => {
    setFilters({
      dateRange: { startDate: null, endDate: null },
      city: '',
      accountName: '',
      country: ''
    });
    onFilterChange({
      dateRange: { startDate: null, endDate: null },
      city: '',
      accountName: '',
      country: ''
    });
  };

  // Handle date range change
  const handleDateChange = (startDate, endDate) => {
    setFilters(prev => ({
      ...prev,
      dateRange: { startDate, endDate }
    }));
  };

  // Handle country change
  const handleCountryChange = (selectedOption) => {
    setFilters(prev => ({
      ...prev,
      country: selectedOption ? selectedOption.label : ''
    }));
  };

  // Toggle dropdown
  const toggleDropdown = (dropdown) => {
    setDropdownStates(prev => ({
      date: false,
      city: false,
      account: false,
      country: false,
      [dropdown]: !prev[dropdown]
    }));
  };

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      const datePickerPanel = document.querySelector('.rs-picker-daterange-panel');
      const clickedInsideDatePicker = datePickerPanel && datePickerPanel.contains(event.target);
  
      setTimeout(() => {
        if (
          popoverRef.current &&
          !popoverRef.current.contains(event.target) &&
          !clickedInsideDatePicker
        ) {
          setPopoverOpen(false);
          setIsClicked(false);
        }
      }, 0);
    };
  
    //   if (popoverRef.current && !popoverRef.current.contains(event.target)) {
    //     setPopoverOpen(false);
    //   }
    // };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  
  const options = ["Automotive", "Auxyz", "Augment", "Auction"];
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [isOpen, setIsOpen] = useState(false);
const [isOpenInCountry,setisOpenInCountry] = useState(false)
  const filteredOptions = options.filter((option) =>
    option.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="relative inline-block" ref={popoverRef}>
      <button
        onClick={() => setPopoverOpen(!popoverOpen)}
        className="export-button flex gap-2 text-xs tracking-wide font-semibold py-3 w-[114px] h-[40px] !rounded-[10px] !border !border-[#e0e0e0] !outline-none"
      >
        <ListFilter className="w-4 h-4 2xl:w-5 2xl:h-5" />
        <span className="text-[14px] font-[400] text-[#575757]">Filter</span> 
      </button>

      {popoverOpen && (
        <div className="absolute z-50 mt-2 right-0 bg-white card-shadow w-[250px] rounded-md px-[8px] py-[16px]" style={{ boxShadow: '0px 0px 5px 0px #00000054' }}>
          <div className="filter_content_container select-none bg-white w-full rounded-md flex flex-col items-center justify-start pb-[6px] px-[8px]">
            <div className="w-full flex flex-col gap-[20px]">
              {/* Date Filter */}
              <div>
                <div
                  // onClick={handleDateOpen}
                  // className="text-[14px]  font-[400] text-[#575757] flex justify-between "
                  ref={dateref}
                  onClick={() => toggleDropdown('date')}
                  className="text-[14px] font-[400] text-[#575757] flex justify-between cursor-pointer"
                >
                  <span>Date</span>
                  {dropdownStates.date ? <GoChevronUp /> : <GoChevronDown />}
                </div>
                {dropdownStates.date && (
                  <Daterangepicker 
                    onDateChange={handleDateChange}
                    initialStartDate={filters.dateRange.startDate}
                    initialEndDate={filters.dateRange.endDate}
                  />
                )}
              </div>

              {/* City Filter */}
              <div>
                <div
                  onClick={() => toggleDropdown('city')}
                  className="text-[14px] font-[400] text-[#575757] flex justify-between cursor-pointer"
                >
                  <span>City</span>
                  {dropdownStates.city ? <GoChevronUp /> : <GoChevronDown />}
                </div>
                {dropdownStates.city && (
                  <div className="w-full mt-2 space-y-2">
                    {cityOptions.map(city => (
                      <div key={city} className="flex items-center">
                        <input
                          type="radio"
                          id={`city-${city}`}
                          name="city"
                          checked={filters.city === city}
                          onChange={() => setFilters(prev => ({ ...prev, city }))}
                          className="mr-2"
                        />
                        <label htmlFor={`city-${city}`}>{city}</label>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Account Name Filter - Simple Text Input */}
              <div>
                <div
                  onClick={() => toggleDropdown('account')}
                  className="text-[14px] font-[400] text-[#575757] flex justify-between cursor-pointer"
                >
                  <span>Account Name</span>
                  {dropdownStates.account ? <GoChevronUp /> : <GoChevronDown />}
                </div>
                {dropdownStates.account && (
                  <div className="w-full mt-2">
                    <input
                      type="text"
                      value={filters.accountName}
                      onChange={(e) => setFilters(prev => ({ ...prev, accountName: e.target.value }))}
                      placeholder="Type account name"
                      className="w-full p-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>

              {/* Country Filter - Searchable Select */}
              <div>
                <div
                  onClick={() => toggleDropdown('country')}
                  className="text-[14px] font-[400] text-[#575757] flex justify-between cursor-pointer"
                >
                  <span>Country</span>
                  {dropdownStates.country ? <GoChevronUp /> : <GoChevronDown />}
                </div>
                {dropdownStates.country && (
                  <div className="w-full mt-2">
                    <Select
                      options={allCountries}
                      value={filters.country ? { label: filters.country, value: filters.country } : null}
                      onChange={handleCountryChange}
                      placeholder="Search or select country"
                      isClearable
                      className="basic-single"
                      classNamePrefix="select"
                      styles={{
                        control: (base) => ({
                          ...base,
                          minHeight: '40px'
                        }),
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

            <hr className="w-full my-2" />
            <div className="w-full flex justify-between px-2 py-2">
              <button
                onClick={applyFilters}
                className="text-xs  text-[#623eb7] rounded-[5px] border border-[#623eb7] hover:bg-[#623eb7] hover:text-white transition-colors"
              >
                Apply
              </button>
              <button
                onClick={clearFilters}
                className="text-xs font-bold text-[#1F3A78] hover:text-[#623eb7] transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FbAccountFilter;
