import React, { useState } from "react";
import GlobalUiComponent from "./GlobalUiComponent";

const Tiktok = () => {
  const [stateData, setSataData] = useState("tiktok");
  return (
    <div>
      <GlobalUiComponent network={stateData} />
    </div>
  );
};

export default Tiktok;
