import React, { useContext, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { RxCross1 } from "react-icons/rx";
import { FiHardDrive } from "react-icons/fi";
import AdminContext from "../Context/Context";
import fbaccountdetails from '../assets/fbaccountdetails.png'
import systeminfo from '../assets/systeminfo.png'

const Sidebar = () => {
  const navigate = useNavigate();
  const { sidebarOpen, setsidebarOpen } = useContext(AdminContext);
  const [isOn, setIsOn] = useState(true);
  const location = useLocation();
  useEffect(() => {
    // const storedValue = localStorage.getItem("powerAdSpy") === "true";
    // const lastPath = localStorage.getItem("lastPath");

    // setIsOn(storedValue);

    // if (lastPath) {
    // navigate(lastPath);
    //   } else {
    //     navigate(storedValue ? "/pas/user-details" : "/adsgpt");
    //   }
  }, []);
  const handleToggle = () => {
    const newState = !isOn;
   
    setIsOn(newState);
    const defaultRoute = newState ? "/pas/crawler-insights" : "/adsgpt";

    localStorage.setItem("powerAdSpy", newState);
    localStorage.setItem("lastPath", defaultRoute);
    navigate(defaultRoute);
  };

  useEffect(() => {
    if(window.location.pathname){

      localStorage.setItem("lastPath", window.location.pathname);
    }
  }, [window.location.pathname]);

  // useEffect(() => {
  //   if (location.pathname ) {
  //     localStorage.setItem("lastPath", location.pathname);
  //   }
  // }, [location]);


useEffect(() => {
  if (isOn) {
    // navigate('pas/crawler-insights')
    const favicon = document.querySelector("link[rel='icon']");
    if (favicon) {
      // favicon.href = "../assets/img/favicon.jpg";
      document.title = "Poweradspy Admin Panel";
    }
  } else {
    // navigate('/adsgpt')
    const favicon = document.querySelector("link[rel='icon']");
    if (favicon) {
      // favicon.href = "../assets/img/favicon.jpg";
      document.title = "AdsGpt Admin Panel";
    }
  }
}, [isOn]);

const handleFBSystemInfo = (e) => {

  e.preventDefault()
  navigate('/pas/system-info')
}

// Active-state helpers for sidebar nav highlighting.
// `exact` matches the path exactly (used for index routes like /adsgpt that
// are a prefix of their own children); otherwise we match by prefix so nested
// routes (e.g. /pas/crawler-insights/youtube) keep their parent highlighted.
const isActive = (path, exact = false) =>
  exact ? location.pathname === path : location.pathname.startsWith(path);

const navItemClass = (active) =>
  `flex gap-[16px] items-center cursor-pointer rounded-[10px] px-[12px] py-[10px] -ml-[12px] mr-[16px] transition-colors ${
    active ? "bg-[#e8ebff]" : "hover:bg-[#f1f3ff]"
  }`;

const navLabelClass = (active) =>
  `font-[400] text-[18px] ${active ? "text-[#3F51B5]" : "text-[#1f296a]"}`;
  return (
    <>
      {sidebarOpen && (
        <div className="w-[264px] bg-[#fff] h-full flex flex-col items-center pt-[24px] absolute md:relative left-0 z-[100] md:z-10">
          <div className="flex md:hidden absolute right-[12px] top-[12px]">
            <RxCross1
              className="text-[24px]"
              onClick={() => setsidebarOpen(!sidebarOpen)}
            />
          </div>

          <img
            className="h-[44px] w-[64%]"
            src={
              isOn
                ? "https://i.ibb.co/bMD8bCDj/2560x1440-Change-Tagline-Change-2.png"
                : "https://app.adsgpt.io/amember/data/public/673ac6707b2be.png"
            }
            alt="AdsGPT"
          />

          <div className="w-full pl-[16px] pr-[10px] my-[24px]">
            <div className="w-full h-[52px] bg-[linear-gradient(90deg,#3F51B5_22.5%,#673AB7_100%)] rounded-[10px] px-[12px] flex justify-between items-center">
              <span className="text-[14px] font-400 text-[#fff]">
                {isOn ? "Switch to Adsgpt" : "Switch to PowerAdSpy"}
              </span>
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={isOn}
                  onChange={handleToggle}
                />
                <div
                  className={`w-12 h-6 flex items-center bg-gray-300 rounded-full p-1 transition ${
                    isOn ? "bg-blue-500" : "bg-gray-300"
                  }`}
                >
                  <div
                    className={`bg-white w-5 h-5 rounded-full shadow-md transform transition ${
                      isOn ? "translate-x-6" : "translate-x-0"
                    }`}
                  ></div>
                </div>
              </label>
            </div>
          </div>

          <div className="pl-[28px] w-full">
            <ul className="flex flex-col gap-1">
              {isOn && (
                <>
                   <Link className="block">
                   <li className={navItemClass(isActive("/pas/system-info"))} onClick={handleFBSystemInfo}>
                     <img
                       src={systeminfo}
                       alt=""
                       className="w-[22px] h-[22px]"
                     />
                     <span className={navLabelClass(isActive("/pas/system-info"))}>
                     System Info
                     </span>
                   </li>
                  </Link>
                <Link to={"/pas/nas-storage"} className="block">
                  <li className={navItemClass(isActive("/pas/nas-storage"))}>
                    <FiHardDrive className="w-[22px] h-[22px] text-[#1f296a]" />
                    <span className={navLabelClass(isActive("/pas/nas-storage"))}>
                      NAS Storage
                    </span>
                  </li>
                </Link>
                <Link to={"/pas/crawler-insights"} className="block">
                  <li className={navItemClass(isActive("/pas/crawler-insights"))}>
                    <img
                      src="https://i.ibb.co/99W27LGb/vaadin-pie-bar-chart.png"
                      alt=""
                      className="w-[22px] h-[22px]"
                    />
                    <span className={navLabelClass(isActive("/pas/crawler-insights"))}>
                      Crawler Insights
                    </span>
                  </li>
                </Link>
                <Link to={"/pas/search-intelligence"} className="block">
                  <li className={navItemClass(isActive("/pas/search-intelligence"))}>
                    <img
                      src="https://i.ibb.co/99W27LGb/vaadin-pie-bar-chart.png"
                      alt=""
                      className="w-[22px] h-[22px]"
                    />
                    <span className={navLabelClass(isActive("/pas/search-intelligence"))}>
                      Intelligence
                    </span>
                  </li>
                </Link>
                {/* <Link to={"/pas/processed-domains"}>
                  <li className="flex gap-[16px] items-center">
                    <img
                      src="https://i.ibb.co/99W27LGb/vaadin-pie-bar-chart.png"
                      alt=""
                      className="w-[22px] h-[22px]"
                    />
                    <span className="font-[400] text-[18px] text-[#1f296a]">
                      Processed Domains
                    </span>
                  </li>
                </Link> */}
                   {/* <Link to={"/pas/fb-accountdetails"}> */}
                   {/* <li className="flex gap-[16px] items-center cursor-pointer" onClick={handleFBAccountroute}>
                     <img
                       src={fbaccountdetails}
                       alt=""
                       className="w-[22px] h-[22px]"
                     />
                     <span className="font-[400] text-[18px] text-[#1f296a]">
                     FB Account Details
                     </span>
                   </li> */}
                 {/* </Link> */}
                   
                 </>
              )}
                {isOn && (
                <Link to={"/pas/competitor-details"} className="block">
                  <li className={navItemClass(isActive("/pas/competitor-details"))}>
                    <img
                      src="https://i.ibb.co/hJRQHK70/Vector.png"
                      alt=""
                      className="w-[22px] h-[22px]"
                    />
                    <span className={navLabelClass(isActive("/pas/competitor-details"))}>
                     Competitors Details
                    </span>
                  </li>
                </Link>
              )}
              {isOn && (
                <Link to={"/pas/daily-keyword-details"} className="block">
                  <li className={navItemClass(isActive("/pas/daily-keyword-details"))}>
                    <img
                      src="https://i.ibb.co/hJRQHK70/Vector.png"
                      alt=""
                      className="w-[22px] h-[22px]"
                    />
                    <span className={navLabelClass(isActive("/pas/daily-keyword-details"))}>
                     Daily Keywords Details
                    </span>
                  </li>
                </Link>
              )}
              {isOn && (
                <Link to={"/pas/email-details"} className="block">
                  <li className={navItemClass(isActive("/pas/email-details"))}>
                    <img
                      src="https://i.ibb.co/hJRQHK70/Vector.png"
                      alt=""
                      className="w-[22px] h-[22px]"
                    />
                    <span className={navLabelClass(isActive("/pas/email-details"))}>
                     Email Details
                    </span>
                  </li>
                </Link>
              )}
              {isOn && (
                <li
                  className={navItemClass(isActive("/pas/competitor-tracker"))}
                  onClick={() =>
                    navigate("/pas/competitor-tracker", {
                      state: { resetTracker: Date.now() },
                    })
                  }
                >
                  <img
                    src="https://i.ibb.co/hJRQHK70/Vector.png"
                    alt=""
                    className="w-[22px] h-[22px]"
                  />
                  <span className={navLabelClass(isActive("/pas/competitor-tracker"))}>
                   Competitor Tracker
                  </span>
                </li>
              )}
              {!isOn && (
                <>
                <Link to={"/adsgpt/generated-media"} className="block">
                  <li className={navItemClass(isActive("/adsgpt/generated-media"))}>
                    <img
                      src="https://i.ibb.co/hJRQHK70/Vector.png"
                      alt=""
                      className="w-[22px] h-[22px]"
                      style={{ filter: "hue-rotate(180deg)" }}
                    />
                    <span className={navLabelClass(isActive("/adsgpt/generated-media"))}>
                     Generated Media
                    </span>
                  </li>
                </Link>
                <Link to={"/adsgpt"} className="block">
                  <li className={navItemClass(isActive("/adsgpt", true))}>
                    <img
                      src="https://i.ibb.co/hJRQHK70/Vector.png"
                      alt=""
                      className="w-[22px] h-[22px]"
                      style={{ filter: "hue-rotate(180deg)" }}
                    />
                    <span className={navLabelClass(isActive("/adsgpt", true))}>
                     Interaction Data
                    </span>
                  </li>
                </Link>
                <Link to={"/adsgpt/calculation"} className="block">
                  <li className={navItemClass(isActive("/adsgpt/calculation"))}>
                    <img
                      src="https://i.ibb.co/hJRQHK70/Vector.png"
                      alt=""
                      className="w-[22px] h-[22px]"
                      style={{ filter: "hue-rotate(180deg)" }}
                    />
                    <span className={navLabelClass(isActive("/adsgpt/calculation"))}>
                     Calculation Tool
                    </span>
                  </li>
                </Link>
                </>
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
};

export default Sidebar;
