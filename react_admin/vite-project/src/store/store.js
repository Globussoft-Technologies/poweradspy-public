import { configureStore } from "@reduxjs/toolkit";
import adsgptSlice from "./reducers/adsgpt";
import poweradspySlice from "./reducers/powerAdsPySlice";

const store = configureStore({
  reducer: {
    adsgpt: adsgptSlice,
    poweradspy: poweradspySlice,
  },
});

export default store;
