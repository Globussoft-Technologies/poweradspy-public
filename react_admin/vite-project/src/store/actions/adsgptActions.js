import { createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";
import Cookies from "js-cookie";

const ADSGPT_URL = import.meta.env.VITE_ADSGPT_BACKEND;
const HOST_URL = import.meta.env.VITE_ADMIN_BACKEND_URL;
const TIKTOK_HOST = import.meta.env.VITE_ADMIN_TIKTOK_HOST;
export const fetchAllUsers = createAsyncThunk(
  "adsgpt/fetchAllUsers",
  async (args, { rejectWithValue }) => {
    try {
      const token = Cookies.get("token"); // Get token from cookies
      if (!token) throw new Error("No authentication token found!");
      const { data } = await axios.get(
        `${HOST_URL}/adsgpt-users/get-user-id`,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
        }
      );
      return data?.data ;
    } catch (error) {
      return rejectWithValue(error.response.data.message);
    }
  }
);


export const fetchUserDetails = createAsyncThunk(
    "adsgpt/fetchUserDetails",
    async (args, { rejectWithValue }) => {
      try {
        const token = Cookies.get("token"); // Get token from cookies
        if (!token) throw new Error("No authentication token found!");
        const { data } = await axios.get(
          `${HOST_URL}/adsgpt-users/get-user-data/${args}`,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`
            },
          }
        );
        return data?.data;
      } catch (error) {
        return rejectWithValue(error.response.data.message);
      }
    }
  );

  export const fetchUsersStats = createAsyncThunk(
    "/adsgpt/amember/get-users-stats",
    async (args, { rejectWithValue }) => {
      try {
        const token = Cookies.get("token"); // Get token from cookies
        if (!token) throw new Error("No authentication token found!");
        const { data } = await axios.get(
          `${HOST_URL}/adsgpt-users/get-users-stats`,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`
            },
          }
        );
        return data?.data;
      } catch (error) {
        return rejectWithValue(error.response.data.message);
      }
    }
  );
  //ad-count api
  export const fetchAdsCount = createAsyncThunk(
    "adsgpt/fetchAdsCount",
    async (payload, { rejectWithValue, signal }) => {
      try {
        // Centralized count API (per-platform metric). Reshaped into the existing
        // { data: [{ platform, total_ads }], network } store shape so cards stay untouched.
        const { data } = await axios.post(
          `${HOST_URL}/network-name/get-count`,
          { network: payload.network, metric: "platform", range: payload.range, platform: payload.platform },
          {
            signal,
            headers: {
              "Content-Type": "application/json"
            },
          }
        );
        return {
          code: 200,
          message: "success",
          data: [{ platform: payload.platform, total_ads: data?.data?.total ?? 0 }],
          network: payload.network,
        };
      } catch (error) {
        if (axios.isCancel(error)) throw error;
        return rejectWithValue(error.response.data.message);
      }
    }
  );

  export const fetchAdsCountScroll = createAsyncThunk(
    "adsgpt/fetchAdsCountScroll",
    async (payload, { rejectWithValue, signal }) => {
      try {
        const { data } = await axios.post(
          `${HOST_URL}/network-name/get-count`,
          { network: payload.network, metric: "platform", range: payload.range, platform: payload.platform },
          {
            signal,
            headers: {
              "Content-Type": "application/json"
            },
          }
        );
        return {
          code: 200,
          message: "success",
          data: [{ platform: payload.platform, total_ads: data?.data?.total ?? 0 }],
          network: payload.network,
        };
      } catch (error) {
        if (axios.isCancel(error)) throw error;
        return rejectWithValue(error.response.data.message);
      }
    }
  );

//python api
export const fetchAdsCountPython = createAsyncThunk(
  "adsgpt/fetchAdsCountPython",
  async (payload, { rejectWithValue, signal }) => {
    try {
      const { data } = await axios.post(
        `${HOST_URL}/network-name/get-count`,
        { network: payload.network, metric: "platform", range: payload.range, platform: payload.platform },
        {
          signal,
          headers: {
            "Content-Type": "application/json"
          },
        }
      );
      return {
        code: 200,
        message: "success",
        data: [{ platform: payload.platform, total_ads: data?.data?.total ?? 0 }],
        network: payload.network,
      };
    } catch (error) {
      if (axios.isCancel(error)) throw error;
      return rejectWithValue(error.response.data.message);
    }
  }
);

export const fetchAdsCountMeta = createAsyncThunk(
  "adsgpt/fetchAdsCountMeta",
  async (payload, { rejectWithValue, signal }) => {
    try {
      const { data } = await axios.post(
        `${HOST_URL}/network-name/get-count`,
        { network: payload.network, metric: "platform", range: payload.range, platform: payload.platform },
        {
          signal,
          headers: {
            "Content-Type": "application/json"
          },
        }
      );
      return {
        code: 200,
        message: "success",
        data: [{ platform: payload.platform, total_ads: data?.data?.total ?? 0 }],
        network: payload.network,
      };
    } catch (error) {
      if (axios.isCancel(error)) throw error;
      return rejectWithValue(error.response.data.message);
    }
  }
);
// Unique (new) + Total (active) counts for the date-ranged cards.
// Backed by the centralized /network-name/get-count (metric: "range") — see
// admin_panel_backend/src/dynamic-count-analytics.js. Returns { newCount, activeCount }.
export const fetchRangeCounts = createAsyncThunk(
  "adsgpt/fetchRangeCounts",
  async (payload, { rejectWithValue, signal }) => {
    try {
      const { data } = await axios.post(
        `${HOST_URL}/network-name/get-count`,
        { network: payload.network, metric: "range", range: payload.range },
        {
          signal,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      return {
        network: payload.network,
        data: data?.data,
      };
    } catch (error) {
      if (axios.isCancel(error)) throw error;
      return rejectWithValue(error?.response?.data?.message || "API request failed");
    }
  }
);
//
export const fetchTotalAdsCount = createAsyncThunk(
  "adsgpt/fetchTotalAdsCount",
  async (payload, { rejectWithValue, signal }) => {
    try {
      const { data } = await axios.post(
        `${HOST_URL}/network-name/get-ads-count`,
        payload,
        {
          signal,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      return {
        network: payload.network,
        data,
      };
    } catch (error) {
      if (axios.isCancel(error)) throw error;
      return rejectWithValue(error?.response?.data?.message || "API request failed");
    }
  }
);
//source api
  export const fetchAdSourceCount = createAsyncThunk(
    "adsgpt/fetchAdSourceCount",
    async (payload, { rejectWithValue, signal }) => {
      try {
        const { data } = await axios.post(
          `${HOST_URL}/networks-source/source-counts`,
          payload,
          {
            signal,
            headers: {
              "Content-Type": "application/json"
            },
          }
        );
        data.network=payload.network;
        return data;
      } catch (error) {
        if (axios.isCancel(error)) throw error;
        return rejectWithValue(error.response.data.message);
      }
    }
  );

  //position api
  export const fetchAdPositionCount = createAsyncThunk(
    "adsgpt/fetchAdPositionCount",
    async (payload, { rejectWithValue, signal }) => {
      try {
        const { data } = await axios.post(
          `${HOST_URL}/networks-position/position-counts`,
          payload,
          {
            signal,
            headers: {
              "Content-Type": "application/json"
            },
          }
        );
        data.network=payload.network;
        return data;
      } catch (error) {
        if (axios.isCancel(error)) throw error;
        return rejectWithValue(error.response.data.message);
      }
    }
  );

  //graph-ad-count
  export const fetchAdsGraphCount = createAsyncThunk(
    "adsgpt/fetchAdsGraphCount",
    async (payload, { rejectWithValue, signal }) => {
      try {
        const { data } = await axios.post(
          `${HOST_URL}/networks-graph/ad-count-graph`,
          payload,
          {
            signal,
            headers: {
              "Content-Type": "application/json"
            },
          }
        );
        data.network=payload.network;
        return data;
      } catch (error) {
        if (axios.isCancel(error)) throw error;
        return rejectWithValue(error.response.data.message);
      }
    }
  );

  
  //tiktotk ads count
  export const fetchTiktokAdsCount = createAsyncThunk(
    "adsgpt/fetchTiktokAdsCount",
    async (payload, { rejectWithValue, signal }) => {
      try {
        const { data } = await axios.post(
          `${TIKTOK_HOST}/v1/tiktok-guest/tiktok-ads-count`,
          payload,
          {
            signal,
            headers: {
              "Content-Type": "application/json"
            },
          }
        );
        data.body.network=payload.network;
        return data?.body;
      } catch (error) {
        if (axios.isCancel(error)) throw error;
        return rejectWithValue(error.response.data.message);
      }
    }
  );

  export const fetchTiktokAdsGraphCount = createAsyncThunk(
    "adsgpt/fetchTiktokAdsGraphCount",
    async (payload, { rejectWithValue, signal }) => {
      try {
        const { data } = await axios.post(
          `${TIKTOK_HOST}/v1/tiktok-guest/tiktok-ads-count-graph`,
          payload,
          {
            signal,
            headers: {
              "Content-Type": "application/json"
            },
          }
        );
        data.body.network=payload.network;
        return data?.body;
      } catch (error) {
        if (axios.isCancel(error)) throw error;
        return rejectWithValue(error.response.data.message);
      }
    }
  );

export const fetchGeneratedMedia = createAsyncThunk(
  "adsgpt/fetchGeneratedMedia",
  async ({ userId, type, from, to, page = 1, limit = 20 }, { rejectWithValue }) => {
    try {
      const token = Cookies.get("token");

      let url = `${ADSGPT_URL}/adsgpt/generated-media/${userId}?type=${type}&page=${page}&limit=${limit}`;

      if (from && to) {
        url += `&from=${from}&to=${to}`;
      }

      const { data } = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return {
        data: data?.data || [],
        hasMore: data?.hasMore || false,
        page: data?.page || page,
        spending: data?.spending || null,
      };
    } catch (error) {
      return rejectWithValue(
        error?.response?.data?.message || "Failed to fetch generated media"
      );
    }
  }
);

export const fetchUsersWithGeneratedMedia = createAsyncThunk(
  "adsgpt/fetchUsersWithGeneratedMedia",
  async ({ from, to } = {}, { rejectWithValue }) => {
    try {
      const token = Cookies.get("token");
      if (!token) throw new Error("No authentication token found!");

      let url = `${ADSGPT_URL}/adsgpt/generated-media/users-with-generated-media`;

      if (from && to) {
        url += `?from=${from}&to=${to}`;
      }

      const { data } = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      return data?.data || [];

    } catch (error) {
      return rejectWithValue(
        error?.response?.data?.message || "Failed to fetch users with media"
      );
    }
  }
);



export const fetchUserUsageCost = createAsyncThunk(
  "adsgpt/fetchUserUsageCost",
  async ({ userId, groupBy = "day", from, to }, { rejectWithValue }) => {
    try {
      if (!userId) return;

      const token = Cookies.get("token");
      if (!token) throw new Error("No authentication token found!");

      const { data } = await axios.get(
        `${HOST_URL}/adsgpt-users/get-user-usage/${userId}`,
        {
          params: { groupBy, from, to },
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );

      return data?.data;
    } catch (error) {
      return rejectWithValue(
        error?.response?.data?.message || "Failed to fetch usage cost"
      );
    }
  }
);
export const fetchGeneratedMediaSpendingReport = createAsyncThunk(
  "adsgpt/fetchGeneratedMediaSpendingReport",
  async ({ from, to } = {}, { rejectWithValue }) => {
    try {
      const token = Cookies.get("token");
      if (!token) throw new Error("No authentication token found!");

      let url = `${ADSGPT_URL}/adsgpt/generated-media/spending-report`;

      if (from && to) {
        url += `?from=${from}&to=${to}`;
      }

      const { data } = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return data?.data || [];
    } catch (error) {
      return rejectWithValue(
        error?.response?.data?.message || "Failed to fetch spending report"
      );
    }
  }
);
