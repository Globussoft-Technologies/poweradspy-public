import { useEffect, useState, useRef } from 'react';
import * as am5 from '@amcharts/amcharts5';
import * as am5percent from '@amcharts/amcharts5/percent';
import am5themes_Animated from '@amcharts/amcharts5/themes/Animated';

import moment from 'moment';


const AdPositionCrawlerChart = ({position}) => {
  const chartTaskStatusRef = useRef(null);
  const [baseimg, setbaseimg] = useState('');

  const [bigScreen, setbigScreen] = useState('');
 
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  

  const [fwidth, setfwidth] = useState(window.innerWidth);
  const handleWdSize = () => {
    setfwidth(window.innerWidth); // Update state with the new width
  };
  useEffect(() => {
    // Add resize event listener
    window.addEventListener('resize', handleWdSize);

    // Cleanup function to remove the event listener
    return () => {
      window.removeEventListener('resize', handleWdSize);
    };
  }, []);
  useEffect(() => {
    let root = am5.Root.new(chartTaskStatusRef.current);
    root._logo.dispose();
    root.setThemes([am5themes_Animated.new(root)]);

    let chart = root.container.children.push(
      am5percent.PieChart.new(root, {
        layout: root.verticalLayout,
        width: 400,
        height: 460,
        innerRadius:
           am5.percent(72),
        paddingTop: 20,
        paddingBottom: 20,
        paddingLeft: 20,
        paddingRight: 20,
      })
    );

    let series = chart.series.push(
      am5percent.PieSeries.new(root, {
        height: am5.p100,
        width: am5.p100,
        valueField: 'count',
        categoryField: 'position',
        alignLabels: false,

        radius: am5.percent(220),
        x: am5.percent(-15),
        y: am5.percent(5),
        tooltip: am5.Tooltip.new(root, {
          pointerOrientation: 'horizontal',
          labelText:
            '[fontFamily: "QuickSand" fontSize: "12px"]{position} : {count} Ads',
        }),
        endAngle: 90,
        rotation: 270,
      })
    );
    series.labels.template.set('forceHidden', true);

    const chartData = position?.filter(item => item?.position !== "");
    series?.data?.setAll(chartData);

    const gradients = {
      Completed: am5.LinearGradient.new(root, {
        stops: [
          { color: am5.color(0xffb25a) },
          { color: am5.color(0xffb25a) },
        ],
        rotation: 90,
      }),
      Paused: am5.LinearGradient.new(root, {
        stops: [
          { color: am5.color(0x94b7fb) },
          { color: am5.color(0x94b7fb) },
        ],
        rotation: 90,
      }),
      Pending: am5.LinearGradient.new(root, {
        stops: [
          { color: am5.color(0xcef1ab) },
          { color: am5.color(0xcef1ab) },
        ],
        rotation: 90,
      }),
    };

    series.slices.each((slice, index) => {
      const category = chartData?.[index]?.position;
      if (gradients[category]) {
        slice.set('fillGradient', gradients[category]);
      }
    });

    series.ticks.setAll({
      fill: am5.color('#000'),
    });

    let strokeColor = am5.color(0xffffff);

    series.slices.template.setAll({
      stroke: strokeColor,
      strokeWidth: 0,
      cornerRadius: 4,
    });

    let legendItems = series.dataItems;

    let legendTop = chart.children.push(
      am5.Legend.new(root, {
        width: am5.percent(100),

        // centerY: am5.percent(50),
        y: am5.percent(10),
        x:am5.percent(67),
        marginTop: 15,
        layout: root.verticalLayout,
        paddingLeft: window.innerWidth < 768 ? 0 : 0,
      })
    );

    if (fwidth >= 1600) {
      legendTop.data.setAll(legendItems);
      legendTop.itemContainers.template.setAll({
        minWidth: am5.percent(25),
        marginBottom: 2,
      });
    } else if (fwidth < 1280) {
      legendTop.data.setAll(legendItems);
      legendTop.itemContainers.template.setAll({
        minWidth: am5.percent(25),
        marginBottom: 2,
        // marginRight:am5.percent(25)
        paddingRight:
          window.innerWidth < 468 ? -3 : window.innerWidth < 768 ? 20 : 0,
      });
    } else {
      legendTop.data.setAll(legendItems.slice(0, 3));
      legendTop.itemContainers.template.setAll({
        minWidth: am5.percent(33),
        marginBottom: 2,
      });
    }

    legendTop.labels.template.setAll({
      //  text: "{category} ({value})",
      fill: am5.color('#000'),
      fontSize: '10px',
      fontWeight: '600',
      fontFamily: 'QuickSand',
      textAlign: 'center',
    });

    // hide values
    // legendTop.valueLabels.template.set('forceHidden', true);

    legendTop.markerRectangles.template.setAll({
      cornerRadiusTL: 2,
      cornerRadiusTR: 2,
      cornerRadiusBL: 2,
      cornerRadiusBR: 2,
    });

    const handleResize = () => {
      let width = window.innerWidth;

      if (width < 768) {
        chart.set('width', am5.percent(100));
        chart.set('height', 350);
      } else if (width < 1280) {
        chart.set('width', am5.percent(100));
        chart.set('height', 350);
      } else if (width < 1600) {
        chart.set('width', am5.percent(100));
        chart.set('height', 400);
      } else {
        chart.set('width', am5.percent(100));
        chart.set('height', 400);
      }
    };
    handleResize();

    window.addEventListener('resize', handleResize);
    series.appear(1000, 100);

    return () => {
      root.dispose();
      window.removeEventListener('resize', handleResize);
    };
  }, []);


 
  return (
    <div
      className="flex col-span-12 md:col-span-6 bg-white rounded-lg w-full  shadow-none border-none"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
      }}>
      {/* <div className="flex flex-row items-center bg-gradient rounded-t-lg px-4 2xl:h-12 h-10 w-full">
        <div className="text-xs 2xl:text-sm font-bold text-white">
          Tasks Status
        </div>
      </div> */}
      <div className="p-3 pl-0 h-[288px] flex xl:justify-center justify-start  flex-col items-center relative">
        <div
          id="chartdiv1"
          ref={chartTaskStatusRef}
          className="h-[calc(100%-40px)] w-full relative flex justify-center ">
               {/* <div className="absolute flex text-center flex-col justify-center items-center top-[72px]">
          <h2 className="2xl:text-6xl text-5xl font-semibold font-montserat dark:text-white text-[#1F3A78]">
            12
          </h2>
          <p className="text-[#1F3A78] font-bold text-xs relative top-2 whitespace-nowrap uppercase">
            Out of 32 completed
          </p>
        </div> */}
          {/* sm:left-[9rem] sm:top-[40%] top-[12vw] left-[48vw] xl:left-[52%] xl:top-[37%] -translate-x-1/2 -translate-y-1/4 lg:-translate-y-[0%] */}
        </div>
     
      </div>
    </div>
  );
};

export default AdPositionCrawlerChart;
