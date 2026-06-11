import React, { useState } from "react";
import GlobalUiComponent from "./GlobalUiComponent";

const Linkedin = () => {
  const [stateData, setSataData] = useState("linkedin");
  return (
    <div>
      <GlobalUiComponent network={stateData} />
    </div>
  );
};

export default Linkedin;
