import React, { useState } from "react";
import GlobalUiComponent from "./GlobalUiComponent";

const Google = () => {
  const [stateData, setSataData] = useState("google");
  return (
    <div>
      <GlobalUiComponent network={stateData} />
    </div>
  );
};

export default Google;
