import React, { useState } from "react";
import GlobalUiComponent from "./GlobalUiComponent";

const GDN = () => {
  const [stateData, setSataData] = useState("gdn");
  return (
    <div>
      <GlobalUiComponent network={stateData} />
    </div>
  );
};

export default GDN;
