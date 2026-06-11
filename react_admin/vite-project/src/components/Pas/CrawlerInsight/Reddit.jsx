import React, { useState } from "react";
import GlobalUiComponent from "./GlobalUiComponent";

const Reddit = () => {
  const [stateData, setSataData] = useState("reddit");
  return (
    <div>
      <GlobalUiComponent network={stateData} />
    </div>
  );
};

export default Reddit;
