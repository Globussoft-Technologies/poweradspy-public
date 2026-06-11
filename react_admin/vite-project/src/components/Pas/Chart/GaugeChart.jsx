import React, { useEffect } from "react";
import * as am5 from "@amcharts/amcharts5";
import * as am5xy from "@amcharts/amcharts5/xy";
import * as am5radar from "@amcharts/amcharts5/radar";
import am5themes_Animated from "@amcharts/amcharts5/themes/Animated";

const GaugeChart = () => {
  useEffect(() => {
    const root = am5.Root.new("performanceMeter");

    // Remove amCharts logo
    root._logo?.dispose();

    root.setThemes([am5themes_Animated.new(root)]);

    const chart = root.container.children.push(
      am5radar.RadarChart.new(root, {
        startAngle: 180,
        endAngle: 360,
        innerRadius: -40,
        panX: false,
        panY: false,
      })
    );

    const xRenderer = am5radar.AxisRendererCircular.new(root, {
      innerRadius: -30,
      labels: {
        visible: false,
      },
    });

    const xAxis = chart.xAxes.push(
      am5xy.ValueAxis.new(root, {
        min: 0,
        max: 100,
        strictMinMax: true,
        renderer: xRenderer,
      })
    );

    // Hide axis labels
    xAxis.get("renderer").labels.template.set("visible", false);

    // Gauge ranges
    const ranges = [
      { color: "#ff4d4d", start: 0, end: 20 },
      { color: "#ffa726", start: 20, end: 40 },
      { color: "#ffee58", start: 40, end: 60 },
      { color: "#81c784", start: 60, end: 80 },
      { color: "#4caf50", start: 80, end: 100 },
    ];

    ranges.forEach((range) => {
      let axisRange = xAxis.createAxisRange(
        xAxis.makeDataItem({
          value: range.start,
          endValue: range.end,
        })
      );

      axisRange.get("axisFill").setAll({
        visible: true,
        fill: am5.color(range.color),
        fillOpacity: 1,
      });
    });

    // Clock hand
    const axisDataItem = xAxis.makeDataItem({});
    const hand = am5radar.ClockHand.new(root, {
      pinRadius: am5.percent(10),
      bottomWidth: 10,
      radius: am5.percent(90),
    });

    axisDataItem.set("bullet", am5xy.AxisBullet.new(root, { sprite: hand }));
    xAxis.createAxisRange(axisDataItem);
    axisDataItem.set("value", 75); // Change this to reflect dynamic value

    // Center circle
    chart.radarContainer.children.push(
      am5.Circle.new(root, {
        radius: 30,
        centerX: am5.percent(50),
        centerY: am5.percent(80),
        fill: am5.color("#e8f5e9"),
        stroke: am5.color("#66bb6a"),
        strokeWidth: 2,
      })
    );

    // Center label
    chart.radarContainer.children.push(
      am5.Label.new(root, {
        text: "12K+\nAds",
        fontSize: "1.2em",
        textAlign: "center",
        centerX: am5.percent(50),
        centerY: am5.percent(80),
        fill: am5.color("#333"),
      })
    );

    chart.appear(1000, 100);

    return () => {
      root.dispose();
    };
  }, []);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
    
        justifyContent: "center",
      }}
      className="2xl:gap-[40px] lg:gap-[18px]"
    >
      <div
        id="performanceMeter"
        style={{ width: "400px", height: "250px" }}
      ></div>
      <div>
      
        <ul style={{ listStyle: "none", padding: 0 }}>
          {[
            ["#ff4d4d", "Poor"],
            ["#ffa726", "Fair"],
            ["#ffee58", "Good"],
            ["#81c784", "Very Good"],
            ["#4caf50", "Excellent"],
          ].map(([color, label]) => (
            <li
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: "8px",
              }}
            >
              <div
                style={{
                  width: "12px",
                  height: "12px",
                  backgroundColor: color,
                  marginRight: "10px",
                  borderRadius: "2px",
                }}
              />
              {label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default GaugeChart;
