import React, { useEffect, useRef, useState } from 'react';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import './TabSlider.css';
import { fetchSystemDetails } from './../../../store/actions/powerAdsPyActionsApi';
import TabSliderShimmer from './TabSliderShimmer';

const TabSlider = ({tabs,handleSetTabActive,systemDetails,loadingSystemData}) => {
  // const allTabs = [
  //   { name: 'GLB-1361', fixed: true, value: 12000 },
  //   { name: 'GLB-1362', value: 10500 },
  //   { name: 'GLB-1363', value: 9800 },  // 5k–10k
  //   { name: 'GLB-1364', value: 4000 },  // below 5k
  //   { name: 'GLB-1365', value: 15500 },
  //   { name: 'GLB-1366', value: 18000 },
  //   { name: 'GLB-1367', value: 13500 },
  //   { name: 'GLB-1368', value: 16000 },
  //   { name: 'GLB-1369', value: 17000 },
  //   { name: 'GLB-13611', value: 19000 },
  //   { name: 'GLB-13612', value: 20000 },
  //   { name: 'GLB-13613', value: 14500 },
  //   { name: 'GLB-13614', value: 15000 },
  //   { name: 'GLB-13615', value: 16500 },
  // ];

  const activeTab = tabs.find(tab => tab.isActive)?.name;
  const scrollRef = useRef(null);
  const [scrollPosition, setScrollPosition] = useState(0);

  const scroll = direction => {
    const container = scrollRef.current;
    const scrollAmount = 200;
    const newPosition =
      direction === 'left'
        ? Math.max(container.scrollLeft - scrollAmount, 0)
        : Math.min(
            container.scrollLeft + scrollAmount,
            container.scrollWidth - container.clientWidth
          );

    container.scrollTo({
      left: newPosition,
      behavior: 'smooth',
    });
    setScrollPosition(newPosition);
  };

  // const handleSetTabActive = clickedTab => {
  //   setTabs(prev =>
  //     prev.map(tab => ({
  //       ...tab,
  //       isActive: tab.name === clickedTab.name,
  //     }))
  //   );
  // };
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const activeTabElement = container.querySelector(`.tab-button.active`);
    if (activeTabElement) {
      const containerRect = container.getBoundingClientRect();
      const tabRect = activeTabElement.getBoundingClientRect();

      container.style.scrollBehavior = 'auto';
      if (tabRect.left < containerRect.left || tabRect.right > containerRect.right) {
        const delta = tabRect.left - containerRect.left;
        container.scrollBy({ left: delta, behavior: 'auto' });
      }

      setTimeout(() => {
        container.style.scrollBehavior = 'smooth';
      }, 0);
    }
  }, [activeTab]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      setScrollPosition(container.scrollLeft);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  const getBorderClass = value => {
    if (value < 5000) return 'below5k';
    if (value >= 5000 && value < 10000) return 'below10ab5k';
    return 'border-green';
  };

  return (
    <>
    {loadingSystemData?
     <TabSliderShimmer/>
   :
    <div className='tab-slider-container h-full w-full position-relative'>
    <div className='flex items-center gap-[12px] h-full'>
      {scrollPosition > 0 && (
        <button className='nav-button' onClick={() => scroll('left')}>
          <FaChevronLeft className='text-[#cbcbcb]' />
        </button>
      )}

      {(systemDetails?.data?.inactive_systems?.length>0 || systemDetails?.data?.active_systems?.length>0 ) ?
          <div ref={scrollRef} className='tabs-scroll-container'>
              <div className='tabs-wrapper'>
                  {tabs.map(tab => (
                      <button
                          key={tab.name}
                          className={`tab-button !outline-none ${activeTab === tab.name ? 'active' : ''} ${getBorderClass(tab.value)} ${tab.status==="Active"&& 'border-green-300! !border-2'} ${tab.status==="inActive"&& 'border-red-300! !border-2'}`}
                          onClick={() => handleSetTabActive(tab)}
                      >
                          <div>{tab.name}</div>
                          {tab.hostname && (
                              <div className="text-[10px] opacity-60 leading-tight">{tab.hostname}</div>
                          )}
                      </button>
                  ))}
              </div>
          </div> : 
          <div className='tabs-scroll-container  pt-4 pb-4 rounded-2xl'>
              <div className="text-[#264688] w-full h-full flex items-center justify-center bg-gray-200 rounded-2xl px-4 py-2">
                  Data Not Found
              </div>
          </div>
      }

      {scrollPosition < scrollRef.current?.scrollWidth - scrollRef.current?.clientWidth && (
        <button className='nav-button' onClick={() => scroll('right')}>
          <FaChevronRight className='text-[#cbcbcb] text-[12px]' />
        </button>
      )}
    </div>
  </div>
  }  
</>
    
  );
};

export default TabSlider;
