import React from 'react'

const TabSliderShimmer = () => {
    return (
        <div className='tab-slider-container h-full w-full position-relative'>
        <div className='flex items-center gap-[12px] h-full animate-pulse'>
          {/* Left navigation button placeholder (hidden) */}
          <div className='nav-button'>
            <div className='w-4 h-4 bg-gray-300 rounded-full'></div>
          </div>
   
          {/* Main tabs container shimmer */}
          <div className='tabs-scroll-container w-full'>
            <div className='tabs-wrapper flex gap-2'>
              {/* Tab placeholders (5 tabs shown as example) */}
              {[...Array(6)].map((_, index) => (
                <div
                  key={index}
                  className={`tab-button !outline-none h-10 bg-gray-200 rounded-lg !w-54`}
                >
                  <div className="h-4 bg-gray-300 rounded mx-auto w-3/4"></div>
                </div>
              ))}
            </div>
          </div>
   
          {/* Right navigation button placeholder (hidden) */}
          <div className='nav-button '>
            <div className='w-4 h-4 bg-gray-300 rounded-full'></div>
          </div>
        </div>
      </div>
    );
  };
  
  export default TabSliderShimmer;
