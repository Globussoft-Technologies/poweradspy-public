import React from 'react'

const SystemDetailsShimmer = () => {
    return (
      <div className="h-[calc(100%-98px)] w-full sm:px-[36px] py-[24px] flex flex-col px-[16px] animate-pulse">
        {/* Location Shimmer */}
        <div className="flex gap-[16px] items-center">
          <div className="h-5 w-5 bg-gray-200 rounded-full"></div>
          <div className="h-4 w-32 bg-gray-200 rounded"></div>
        </div>
        
        {/* Main Content Shimmer */}
        <div className="w-full pt-[24px] flex gap-[16px] xl:flex-row flex-col">
          {/* Left Column (Stats and Table) */}
          <div className="2xl:w-[54%] xl:w-[58%] w-[100%]">
            {/* Stats Cards Shimmer */}
            <div className="flex gap-[12px] sm:flex-row flex-col">
              <div className="h-[68px] w-[283px] xl:w-[calc(50%-9px)] bg-gray-200 px-[24px] flex justify-between items-center rounded-[10px]">
                <div className="h-5 w-24 bg-gray-300 rounded"></div>
                <div className="h-8 w-12 bg-gray-300 rounded"></div>
              </div>
              <div className="h-[68px] w-[283px] xl:w-[calc(50%-9px)] bg-gray-200 px-[24px] flex justify-between items-center rounded-[10px]">
                <div className="h-5 w-16 bg-gray-300 rounded"></div>
                <div className="h-8 w-12 bg-gray-300 rounded"></div>
              </div>
            </div>
            
            {/* Table Shimmer */}
            <div className="mt-6 space-y-4">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-12 w-full bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
          
          {/* Right Column (Runtime & Resource Details) */}
          <div className="2xl:w-[46%] 2xl:pl-[48px] xl:pl-[24px] xl:w-[42%] w-[100%] mt-[16px] xl:mt-0">
            <div className="w-full flex flex-col gap-[24px]">
              {/* Title Shimmer */}
              <div className="h-7 w-48 bg-gray-200 rounded"></div>
              
              {/* Two Column Details Shimmer */}
              <div className="w-full flex sm:flex-row flex-col">
                {/* Left Details Column */}
                <div className="flex flex-col gap-[24px] sm:w-[50%] w-full sm:border-r-[1px] border-[#e5e5ef]">
                  {[...Array(5)].map((_, i) => (
                    <div key={`left-${i}`} className="space-y-2">
                      <div className="h-5 w-24 bg-gray-200 rounded"></div>
                      <div className="h-4 w-32 bg-gray-200 rounded"></div>
                    </div>
                  ))}
                </div>
                
                {/* Right Details Column */}
                <div className="flex flex-col gap-[24px] sm:w-[50%] w-full 2xl:pl-[64px] xl:pl-[32px] md:pl-[64px] sm:pl-[32px]">
                  {[...Array(4)].map((_, i) => (
                    <div key={`right-${i}`} className="space-y-2">
                      <div className="h-5 w-28 bg-gray-200 rounded"></div>
                      <div className="h-4 w-40 bg-gray-200 rounded"></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            
            {/* Performance Meter Shimmer (commented in original) */}
            {/* <div className="flex flex-col mt-[32px]">
              <div className="h-5 w-40 bg-gray-200 rounded mb-4"></div>
              <div className="h-64 w-full bg-gray-200 rounded"></div>
            </div> */}
          </div>
        </div>
      </div>
    );
  };
  
  export default SystemDetailsShimmer;