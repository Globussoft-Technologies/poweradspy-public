import React, { useState } from "react";
import GlobalUiComponent from "./GlobalUiComponent";

const Insta = () => {
  const [stateData, setSataData] = useState("instagram");
  return (
    <>
      <GlobalUiComponent network={stateData} />
    </>
  );
};

export default Insta;
