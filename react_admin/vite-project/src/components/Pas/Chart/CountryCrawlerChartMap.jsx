import React, { useEffect, useLayoutEffect, useRef } from "react";
import * as am5 from "@amcharts/amcharts5";
import * as am5map from "@amcharts/amcharts5/map";
import am5geodata_worldLow from "@amcharts/amcharts5-geodata/worldLow";

const CountryCrawlerChartMap = ({countryData,network}) => {

  const chartRef = useRef(null);
  
  const usedColors = new Set();
  const getUniqueColor = () => {
      let color;
      do {
          color = `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;
      } while (usedColors.has(color));
      usedColors.add(color);
      return color;
  };

function transformData(apiResponse) {
  return apiResponse?.data?.reduce((acc, item) => {
      acc[item.code] ={color:item.color,
        count: item.count,country:item.country};
      return acc;
  }, {});
}
const countryColorMap = transformData(countryData);
  useLayoutEffect(() => {
    const root = am5.Root.new(chartRef.current);
    root._logo?.set("forceHidden", true);

    const chart = root.container.children.push(
      am5map.MapChart.new(root, {
        panX: "none",
        panY: "none",
        wheelX: "none",
        wheelY: "none",
        projection: am5map.geoMercator(),
      })
    );
   

    // Define a list of highlighted countries with custom colors

    const highlightedCountries = network!=="tiktok"?countryColorMap:countryData?.data
    .filter(({ country }) => country !== "ALL")
    .reduce((acc, { country, count}) => {
      acc[country] = {
        color: getUniqueColor(),
        count:count,
        country:country
      };
      return acc;
    }, {});

    // Create polygon series for the world map
    const polygonSeries = chart.series.push(
      am5map.MapPolygonSeries.new(root, {
        geoJSON: {
          ...am5geodata_worldLow,
          features: am5geodata_worldLow.features.filter(
            (feature) => feature.id !== "AQ" // Remove Antarctica
          ),
        },
        
      })
    );   

    polygonSeries.mapPolygons.template.setAll({
      interactive: true,
      fill: am5.color("#DDDDDD"), 
      stroke: am5.color("#FFFFFF"),
    });
        // Set tooltip per polygon
      polygonSeries.mapPolygons.template.adapters.add("tooltipText", (text, target) => {
      const id = target.dataItem?.get("id");
      const name = target.dataItem?.get("name");
      const data = highlightedCountries[id];
      if (data!== undefined && data.count !== undefined) {
        return `${data.country} : ${data.count} ${data.count>1?"Ads":"Ad"}`;
      }
      // return `${name}`;
    });

    polygonSeries.events.on("datavalidated", () => {
      polygonSeries.mapPolygons.each((polygon) => {
        const countryId = polygon.dataItem.get("id");
        if (highlightedCountries[countryId]) {
          polygon.set("fill", am5.color(highlightedCountries[countryId].color));
        }
      });
    });

    chartRef.current = root;

    return () => {
      root.dispose();
    };
  }, []);

  return <div ref={chartRef} style={{ width: "100%", height: "335px" }} />;
};

export default CountryCrawlerChartMap;
