import React, { useState } from "react";
import GlobalUiComponent from "./GlobalUiComponent";

const Native = () => {
  const [stateData, setSataData] = useState("native");
  return (
    <div>
      <GlobalUiComponent network={stateData} />
    </div>
  );
};

export default Native;
