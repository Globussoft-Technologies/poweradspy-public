import React, { useState } from "react";
import GlobalUiComponent from "./GlobalUiComponent";

const Pinterest = () => {
  const [stateData, setSataData] = useState("pinterest");
  return (
    <div>
      <GlobalUiComponent network={stateData} />
    </div>
  );
};

export default Pinterest;
