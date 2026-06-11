import React, { useState } from "react";
import GlobalUiComponent from "./GlobalUiComponent";

const Youtube = () => {
  const [stateData, setSataData] = useState("youtube");
  return (
    <div>
      <GlobalUiComponent network={stateData} />
    </div>
  );
};

export default Youtube;
