
import { Link, BrowserRouter as Router, Route, Routes, Outlet, useNavigate, useLocation } from "react-router-dom";
import { FaFacebook, FaInstagram, FaYoutube, FaGoogle, FaLinkedin, FaReddit, FaQuora, FaPinterest, FaTiktok } from "react-icons/fa";
import { SiGoogleads } from "react-icons/si";
import React, { useCallback, useEffect, useRef, useState } from "react";
// import { Link } from "react-router-dom";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { FaRegCalendarAlt } from "react-icons/fa";
import { GoTriangleDown, GoTriangleUp } from "react-icons/go";
import RangeDatePicker from "./RangeDatePicker";
import fb from '../../assets/Social/fb.png'
import Googleads from '../../assets/Social/Google-ads.png'
import Instagram from '../../assets/Social/Instagram.png'
import Youtube from '../../assets/Social/Youtube.png'
import Google from '../../assets/Social/Google.png'
import Linkedin from '../../assets/Social/Linkedin.png'
import Native from '../../assets/Social/Native.png'
import Reddit from '../../assets/Social/Reddit.png'
import Quora from '../../assets/Social/Quora.png'
import Pinterest from '../../assets/Social/Pinterest.png'
import Tiktok from '../../assets/Social/Tiktok.png'
import { format } from 'date-fns';
import HelmetExport from "react-helmet";

const platforms = [
  { name: "Facebook", icon: fb, path: "/pas/crawler-insights" },
  { name: "Instagram", icon: Instagram, path: "/pas/crawler-insights/instagram" },
  { name: "YouTube", icon: Youtube, path: "/pas/crawler-insights/youtube" },
  { name: "Google", icon: Google, path: "/pas/crawler-insights/google" },
  { name: "GDN", icon: Googleads, path: "/pas/crawler-insights/gdn" },
  { name: "LinkedIn", icon: Linkedin, path: "/pas/crawler-insights/linkedin" },
  { name: "Native", icon: Native, path: "/pas/crawler-insights/native" },
  { name: "Reddit", icon: Reddit, path: "/pas/crawler-insights/reddit" },
  { name: "Quora", icon: Quora, path: "/pas/crawler-insights/quora" },
  { name: "Pinterest", icon: Pinterest, path: "/pas/crawler-insights/pinterest" },
  { name: "TikTok", icon: Tiktok, path: "/pas/crawler-insights/tiktok" },
];


// Helper function to load from localStorage
const loadSelectedDates = () => {
  try {
    const savedDates = localStorage.getItem('selectedDates');
    if (savedDates) {
      const parsedDates = JSON.parse(savedDates);
      return {
        startDate: new Date(parsedDates.startDate),
        endDate: new Date(parsedDates.endDate)
      };
    }
  } catch (error) {
    console.error('Failed to parse saved dates', error);
  }
  // Default dates if nothing in storage
  return {
    startDate: new Date(),
    endDate: new Date()
  };
};

const CrawlerInsight = () => {
  const location = useLocation();
  const pathSegments = location.pathname?.split("/");
  const platform = pathSegments[pathSegments?.length - 1];
  const [selectedPlatform, setSelectedPlatform] = useState(platform);
  const scrollRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isApply, setIsApply] = useState(false);
  // const [selectedDates, setSelectedDates] = useState({
  //   startDate: new Date(),
  //   endDate: new Date(),
  // });

    // Initialize state with saved dates or defaults
    const [selectedDates, setSelectedDates] = useState(loadSelectedDates());
  
    // Save to localStorage whenever selectedDates changes
    useEffect(() => {
      localStorage.setItem('selectedDates', JSON.stringify({
        startDate: selectedDates.startDate.toISOString(),
        endDate: selectedDates.endDate.toISOString()
      }));
    }, [selectedDates]);

  const isOpenRef = useRef(isOpen); // Store isOpen reference to prevent unnecessary re-renders
  const pickerRef = useRef(null);
  const toggleDatePicker = () => {
    setIsOpen((prev) => !prev);
    isOpenRef.current = !isOpenRef.current; // Update the ref manually
  };


  const handleDateChange = useCallback((ranges) => {

    // setIsApply(false);
    setSelectedDates({
      startDate: ranges.selection.startDate,
      endDate: ranges.selection.endDate,
    });
  }, []);
    // Detect clicks outside the DatePicker and close it
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen,isApply]);

  const formatDateObject = (dateObj) => {
    const formatDate = (date) => {
      const d = new Date(date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
  
    return {
      from: formatDate(dateObj.startDate),
      to: formatDate(dateObj.endDate),
    };
  };
  const formatDate = (dateString) => {
 
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  return (
    <>
    
      <HelmetExport>
        <title>PowerAdspy Admin Panel</title>
      </HelmetExport>
    
    <div className="w-full relative">

    <div className="flex justify-between mb-[18px]">
        <span className="font-[700] text-[30px] text-[#264688]">Crawler Insights </span>
         <div className="relative inline-block" ref={pickerRef}>
              {/* Toggle Button */}
              <div
                className="relative inline-flex items-center px-4 py-2 rounded-xl shadow-md border border-[#e0e0e0] cursor-pointer"
                onClick={toggleDatePicker} // Only toggle on button click
              >
                <FaRegCalendarAlt className="text-gray-600 mr-2" />
               <span className="text-[#264688]">{!isOpen&&(format(new Date(), "dd-MM-yyyy")!=formatDate(formatDateObject(selectedDates).from))?formatDate(formatDateObject(selectedDates).from)==formatDate(formatDateObject(selectedDates).to)?formatDate(formatDateObject(selectedDates).from):`${formatDate(formatDateObject(selectedDates).from)} ~ ${formatDate(formatDateObject(selectedDates).to)}`:"Select Date"}</span> 
                {isOpen ? (
                  <GoTriangleUp className="text-gray-600 ml-2 text-[16px]" />
                ) : (
                  <GoTriangleDown className="text-gray-600 ml-2 text-[16px]" />
                )}
              </div>
        
              {/* Pass props to DatePicker */}
              {isOpen && (
                <RangeDatePicker  
                  isOpen={isOpen}
                  setIsOpen={setIsOpen}
                  selectedDates={selectedDates}
                  onDateChange={handleDateChange}
                  setIsApply={setIsApply} // Prevents re-renders from closing
                />
              )}
        </div>
    
    </div>
      {/* Left Arrow */}
      <div>

      
      {/* <button
        onClick={scrollLeft}
        className="absolute left-0 top-1/2 transform -translate-y-1/2 bg-white p-2 shadow-md rounded-full z-10"
      >
        <FaChevronLeft className="text-gray-600 text-xl" />
      </button> */}

      {/* Scrollable Container */}
      <div
        ref={scrollRef}
        className="bg-white py-4 px-6 rounded-xl shadow-md flex gap-[24px] custom-scrollbar overflow-x-auto scrollbar-hide scroll-smooth scroll-snap-x snap-mandatory w-full"
      >
        {platforms.map((platform) => (
          <Link
            key={platform.name}
            to={platform.path}
            onClick={() => setSelectedPlatform(platform.name.toLowerCase())}
            className={`flex flex-col items-center px-4 py-2 rounded-full transition gap-2 w-[106px] h-[100px] snap-center`}
          >
            <div
              className={`w-[56px] h-[56px] rounded-full px-[10px] py-[10px] ${
                (selectedPlatform=="crawler-insights"?"facebook":selectedPlatform) == platform.name.toLowerCase() ? "border-2 border-[#264688]" : "border border-[#cbcbcb]"
              }`}
            >
              <img src={platform.icon} alt={platform.name} className="w-full h-full" />
            </div>
            <span
              className={`text-sm text-[14px] ${
                (selectedPlatform=="crawler-insights"?"facebook":selectedPlatform) == platform.name.toLowerCase() ? "font-semibold text-[#264688]" : "font-normal text-[#575757]"
              }`}
            >
              {platform.name}
            </span>
          </Link>
        ))}
      </div>

      {/* Right Arrow */}
      {/* <button
        onClick={scrollRight}
        className="absolute right-0 top-1/2 transform -translate-y-1/2 bg-white p-2 shadow-md rounded-full z-10"
      >
        <FaChevronRight className="text-gray-600 text-xl" />
      </button> */}

    </div>
  <Outlet context={{selectedDates,isOpen,isApply,setIsApply}}/>  </div>
    </>
      
    
  )
}

export default CrawlerInsight
