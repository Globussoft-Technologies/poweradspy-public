import { useEffect, useRef } from "react";
import * as am5 from "@amcharts/amcharts5";
import * as am5percent from "@amcharts/amcharts5/percent";
import am5themes_Animated from "@amcharts/amcharts5/themes/Animated";

const AdTypeCrawlerChart = ({countData}) => {

  const chartTaskStageRef = useRef(null);

    const getRandomColor = (index) =>{
      const colors=[
        '#6993FF',
        '#0BB783',
        '#94B7FB',
        '#D2A8FF',
        '#FFB25A',
        '#FFC3FB',
        '#CEF1AB',
        '#FFC0C1',
        '#FF7A90',
        '#3AC4FF',
    
      ]
      return colors[index]
    }
  
  const transformedData = countData?.data?.map((item,index )=> ({
    value: item.value,
    category: item.category,
    color:getRandomColor(index),
  }
  ));

  useEffect(() => {
    // Create root element
    let root = am5.Root.new(chartTaskStageRef.current);
    root._logo.dispose(); // Remove amCharts branding

    // Set themes
    root.setThemes([am5themes_Animated.new(root)]);

    // Create chart
    let chart = root.container.children.push(
      am5percent.PieChart.new(root, {
        layout: root.horizontalLayout,
        width: am5.percent(110),
        height: am5.percent(80),
        innerRadius: am5.percent(70),
      })
    );

    // Create series
    let series = chart.series.push(
      am5percent.PieSeries.new(root, {
        height: am5.p110,
        width: am5.p100,
        valueField: "value",
        categoryField: "category",
        alignLabels: false,
         y: am5.percent(10),
        radius: am5.percent(180),
        tooltip: am5.Tooltip.new(root, {
          pointerOrientation: "horizontal",
          labelText: '[fontFamily: "QuickSand" fontSize: "12px"]{category}: {value} Ads',
        }),
      })
    );

    // Hide series labels
    series.labels.template.set("forceHidden", true);

    series.data.setAll(transformedData);

    // Set colors for slices
    series.slices.each((slice, index) => {
      const dataItem = series.dataItems[index];
      if (dataItem) {
        const color = dataItem?.dataContext?.color;
        slice.set("fill", am5.color(color));
      }
    });

    // Play initial series animation
    series.appear(1000, 100);

    // Add legend container
    let legendContainer = chart.children.push(
      am5.Container.new(root, {
        width: am5.percent(65),
        height: am5.percent(80),
        layout: root.verticalLayout,
      })
    );

    // Add legend
    let legend = legendContainer.children.push(
      am5.Legend.new(root, {
        layout: root.verticalLayout,
        height: am5.percent(50),
        y: am5.percent(50),
        verticalScrollbar: am5.Scrollbar.new(root, {
          orientation: "vertical",
        }),
      })
    );

    legend.data.setAll(series.dataItems);
    legend.labels.template.setAll({
      fontSize: "10px",
      fontWeight: "600",
      fontFamily: "QuickSand",
    });

    legend.valueLabels.template.set("forceHidden", false);

    // Set slice stroke and radius
    series.slices.template.setAll({
      stroke: am5.color("#ffffff"),
      strokeWidth: 0,
      cornerRadius: 4,
    });

    return () => {
      root.dispose(); // Cleanup when component unmounts
    };
  }, []);

  return (
    <div className="flex  bg-white rounded-lg w-full shadow-none border-none">
      <div className=" hidden items-center bg-gradient rounded-t-lg px-4 2xl:h-12 h-10 w-full">
        <div className="text-xs 2xl:text-sm font-bold text-white">Tasks Stage</div>
      </div>
      <div className="p-3  h-[288px] w-full flex  flex-col  relative">
        <div id="chartdiv" ref={chartTaskStageRef} className="h-[calc(100%)] w-full relative">
        {/* <div className="absolute top-[140px] left-[24%] 2xl:left-[28%] lg:left-[25%] md:left-[26%] sm:left-[26%] text-center flex-col justify-center items-center">
          <h2 className="2xl:text-6xl text-4xl font-semibold font-montserat dark:text-white text-[#1F3A78]">50</h2>
          <p className="text-[#1F3A78] font-bold text-[11px] uppercase">Total Stages</p>
        </div> */}
        </div>
      
      </div>
    </div>
  );
};

export default AdTypeCrawlerChart;
