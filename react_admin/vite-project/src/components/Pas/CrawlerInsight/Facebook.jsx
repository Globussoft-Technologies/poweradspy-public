import React, {useState } from "react";


import GlobalUiComponent from "./GlobalUiComponent";

const Facebook = () => {
    const [stateData,setSataData]=useState("facebook");



  return (
    <>
    <GlobalUiComponent network={stateData}/>
    </>
  );
};

export default Facebook;
