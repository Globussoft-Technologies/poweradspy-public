import React, { useEffect, useRef } from "react";
import * as am5 from "@amcharts/amcharts5";
import * as am5percent from "@amcharts/amcharts5/percent";
import am5themes_Animated from "@amcharts/amcharts5/themes/Animated";

const PieChartComponent = () => {
  const chartRef = useRef(null);

  useEffect(() => {
    // Create root element
    const root = am5.Root.new(chartRef.current);

    // Set theme
    root.setThemes([am5themes_Animated.new(root)]);

    // Create chart
    const chart = root.container.children.push(
      am5percent.PieChart.new(root, {
        layout: root.verticalLayout,
      })
    );

    // Create series
    const series = chart.series.push(
      am5percent.PieSeries.new(root, {
        valueField: "value",
        categoryField: "category",
      })
    );
    series.labels.template.set("visible", false);
    series.ticks.template.set("visible", false);
    // Custom colors for the slices
    series.set("colors", am5.ColorSet.new(root, {
      colors: [
        am5.color("#6993ff"), // Red-Orange
        am5.color("#ffb25a"), // Green
        am5.color("#ffc3fb"), // Blue
        am5.color("#cef1ab"), // Yellow
        am5.color("#94b7fb"), // Purple
        am5.color("#d2a8bb"), // Cyan
    
      ],
    }));

    // Set data
    series.data.setAll([
      { value: 10, category: "One" },
      { value: 9, category: "Two" },
      { value: 6, category: "Three" },
      { value: 5, category: "Four" },
      { value: 4, category: "Five" },
      { value: 3, category: "Six" },
    
    ]);
    const legend = chart.children.push(am5.Legend.new(root, {
      centerX: am5.p50,
      x: am5.p50,
      layout: root.horizontalLayout
    }));

    legend.data.setAll(series.dataItems);

    // Format legend labels to show both category & value
    legend.labels.template.setAll({
      text: "{category}: {value}"
    });
    // Animate the series
    series.appear(1000, 100);

    // Cleanup function to dispose of the chart
    return () => {
      root.dispose();
    };
  }, []);

  return <div ref={chartRef} style={{ width: "100%", height: "500px" }} />;
};

export default PieChartComponent;
