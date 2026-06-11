import { Outlet, useNavigate } from "react-router-dom";
import Sidebar from "./Sidebar";
import { useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import AdminContext from "../Context/Context";
import { AiOutlineMenuFold } from "react-icons/ai";
import { GoArrowLeft } from "react-icons/go";

const Layout = () => {
  const scrollRef = useRef(null);
  const { searchdataFilterTable, sidebarOpen, setsidebarOpen } = useContext(AdminContext);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isTabClosing, setIsTabClosing] = useState(false);
  
  function clearCookie(name) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
  }

  const clearAllStorage = () => {
    localStorage.clear();
    sessionStorage.clear();
    clearCookie('token');
  };
  
  const location = useLocation();
  const isuserdetails = location.pathname.includes("/adsgpt/userdetails");
  const isPasDashboard = location.pathname === "/pas";
  const navigate = useNavigate();

  useEffect(() => {
    if (searchdataFilterTable === 1 && scrollRef.current) {
      scrollRef.current.scrollBy({ top: 800, behavior: "smooth" });
    } else if (searchdataFilterTable === 2 && scrollRef.current) {
      scrollRef.current.scrollBy({ top: 1300, behavior: "smooth" });
    }
  }, [searchdataFilterTable]);

  const [isDropdownVisible, setDropdownVisible] = useState(false);
  const dropdownContainerRef = useRef(null);

  const handleDropdownToggle = () => {
    setDropdownVisible(!isDropdownVisible);
  };

  const handleLogout = () => {
    setDropdownVisible(false);
    clearAllStorage();
    navigate('/login', { replace: true });
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownContainerRef.current && !dropdownContainerRef.current.contains(event.target)) {
        setDropdownVisible(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Session cleanup on tab close (not refresh)
  useEffect(() => {
    const handleBeforeUnload = (event) => {
      // Only clear if we're sure the tab is closing (not refreshing)
      if (isTabClosing) {
        clearAllStorage();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Set flag when tab becomes hidden (might be closing)
        setIsTabClosing(true);
      } else {
        // Tab is visible again (wasn't closed)
        setIsTabClosing(false);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isTabClosing]);

  return (
    <div className="flex flex-row w-full h-screen overflow-auto">
      <Sidebar />
      <div
        className={`bg-[#fafafa] flex-col flex pb-[24px] sm:px-[36px] px-[16px] overflow-auto ${
          sidebarOpen ? "md:w-[calc(100vw-264px)] w-full" : "w-full"
        }`}
        ref={scrollRef}
      >
        <div className="h-[76px] bg-white rounded-[10px] w-full flex justify-between items-center px-[18px] mt-[24px] mb-[18px] py-[9px] gap-[18px] z-50 sticky top-0">
          <div className="flex items-center space-x-2">
            <AiOutlineMenuFold 
              className="text-[24px]" 
              onClick={() => setsidebarOpen(!sidebarOpen)}
            /> 
          
            {isuserdetails && (
              <button
                className="!w-[100px] !flex !gap-[5px] !items-center !text-[#fff] !h-[44px] !rounded-[44px] !bg-gradient-to-r from-[#C85ED8] via-[#A079F8] to-[#A079F8] !outline-none !focus:outline-none !focus:ring-0"
                onClick={() => navigate('/adsgpt')}
              >
                <GoArrowLeft className="text-white text-xl"/>
                <span>Back</span>
              </button>
            )}
            {isPasDashboard && (
              <button
                className="!w-[100px] !flex !gap-[5px] !items-center !text-[#fff] !h-[44px] !rounded-[44px] !bg-gradient-to-r from-[#C85ED8] via-[#A079F8] to-[#A079F8] !outline-none !focus:outline-none !focus:ring-0"
                onClick={() => navigate('/pas/user-details')}
              >
                <GoArrowLeft className="text-white text-xl"/>
                <span>Back</span>
              </button>
            )}
          </div>
          <div className="flex gap-[16px] items-center">
            <div className="relative" ref={dropdownContainerRef}>
              <button
                className="w-[55px] h-[55px] !rounded-full bg-[#f0e9ff] flex justify-center items-center focus:outline-none"
                onClick={handleDropdownToggle}
              >
                <span className="text-[#1f296a]">AH</span>
              </button>

              {isDropdownVisible && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border p-2 z-50">
                  {location.pathname.includes("/pas/system-info") && (
                    <div className="flex items-center justify-between px-4 py-2">
                      <span className="text-gray-700">Monitoring</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          className="sr-only peer" 
                          checked={isMonitoring}
                          onChange={() => setIsMonitoring(!isMonitoring)}
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>
                  )}
                  <button
                    className="w-full text-left px-4 py-2 text-red-600 hover:bg-gray-100 rounded-md"
                    onClick={handleLogout}
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        
        <Outlet context={{ isMonitoring, setIsMonitoring }} />
      </div>
    </div>
  );
};

export default Layout;