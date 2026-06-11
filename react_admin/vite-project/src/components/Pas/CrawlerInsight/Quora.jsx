import React, { useState } from "react";
import GlobalUiComponent from "./GlobalUiComponent";

const Quora = () => {
  const [stateData, setSataData] = useState("quora");
  return (
    <div>
      <GlobalUiComponent network={stateData} />
    </div>
  );
};

export default Quora;
