import { createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";
import Cookies from "js-cookie";

const PAS_ADMIN_BASEURL = import.meta.env.VITE_ADMIN_BACKEND_URL;
const TIKTOK_HOST = import.meta.env.VITE_ADMIN_TIKTOK_HOST;
const PAS_NODE_BASEURL = import.meta.env.VITE_NODE_USER_ACTIVITY_API; // pas_node_api (v2-api) admin_user_activity base

// NAS storage — capacity (total/free/used) + per-network breakdown + daily growth, from
// pas_node_api (BE-08) GET /api/v1/admin_user_activity/nas-storage. JWT (panel token) via Bearer.
export const fetchNasStorage = createAsyncThunk(
  "nasStorage/fetch",
  async (args, { rejectWithValue }) => {
    try {
      const token = Cookies.get("token");
      const days = (args && args.days) || 30;
      const { data } = await axios.get(`${PAS_NODE_BASEURL}nas-storage?days=${days}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return data?.data ?? data;
    } catch (error) {
      return rejectWithValue(error?.response?.data?.message || error.message);
    }
  }
);

export const fetchNetworkTypesCount = createAsyncThunk(
  "networkTypes/fetchCount",
  async (args, { rejectWithValue, signal }) => {
    try {
      const token = Cookies.get("token"); // Get token from cookies
      // if (!token) throw new Error("No authentication token found!");
      const { data } = await axios.post(
        `${PAS_ADMIN_BASEURL}/networks-types/counts`,
        args,
        {
          signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      data.network = args.network;
      return data;
    } catch (error) {
      if (axios.isCancel(error)) throw error;
      return rejectWithValue(error.response.data.message || error.message);
    }
  }
);

export const fetchNetworksCountries = createAsyncThunk(
  "networksCountries/fetchCount",
  async (args, { rejectWithValue, signal }) => {
    try {
      const token = Cookies.get("token"); // Get token from cookies
      // if (!token) throw new Error("No authentication token found!");
      const { data } = await axios.post(
        `${PAS_ADMIN_BASEURL}/networks-countries/counts`,
        args,
        {
          signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      data.network = args.network;
      return data;
    } catch (error) {
      if (axios.isCancel(error)) throw error;
      return rejectWithValue(error.response.data.message || error.message);
    }
  }
);

export const fetchAdsFromFunnel = createAsyncThunk(
  "adsFromFunnel/fetchCount",
  async ({ network, type = null, range = null, cursor = null, isPrev = false }, { rejectWithValue, signal }) => {
    try {
      const token = Cookies.get("token");

      const payload = {
        network,
        type,
        range,
        search_after: cursor ? { funnel: cursor } : null,
      };

      const { data } = await axios.post(
        `${PAS_ADMIN_BASEURL}/networks-funnel/counts`,
        payload,
        {
          signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      data.network = network;
      return {
        data: data,
        searchAfter: data.search_after?.funnel || null,
        isPrev,
        cursor,
        network,
        type,
        range,
      };
    } catch (error) {
      if (axios.isCancel(error)) throw error;
      return rejectWithValue(error.response?.data?.message || error.message);
    }
  }
);

export const fetchAdsFromEcommerceplatforms = createAsyncThunk(
  "AdsfromEcommerceplatforms/fetchCount",
  async ({ network, type = null, range = null, cursor = null, isPrev = false }, { rejectWithValue, signal }) => {
    try {
      const token = Cookies.get("token");

      const payload = {
        network,
        type,
        range,
        search_after: cursor ? { built_with: cursor } : null,
      };

      const { data } = await axios.post(
        `${PAS_ADMIN_BASEURL}/networks-built_with/counts`,
        payload,
        {
          signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const filteredData = data.data.filter((item) => item.e_commerce !== "");

      data.network = network;
    const dataEcommerce= {
        data: filteredData,
        searchAfter: data.search_after?.built_with || null,
        isPrev,
        cursor,
        network,
        type,
        range,
      };
      return dataEcommerce
    } catch (error) {
      if (axios.isCancel(error)) throw error;
      return rejectWithValue(error.response?.data?.message || error.message);
    }
  }
);
export const fetchTiktokAdsCountryCount = createAsyncThunk(
  "adsgpt/fetchTiktokAdsCountryCount",
  async (payload, { rejectWithValue, signal }) => {
    try {
      const { data } = await axios.post(
        `${TIKTOK_HOST}/v1/tiktok-guest/tiktok-ads-countries`,
        payload,
        {
          signal,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      data.body.network = payload.network;
      return data?.body;
    } catch (error) {
      if (axios.isCancel(error)) throw error;
      return rejectWithValue(error.response.data.message);
    }
  }
);

export const fetchAdsFromAffiliateplatforms = createAsyncThunk(
  "AdsfromAfiliateplatforms/fetchCount",
  async ({ network, type = null, range = null, cursor = null, isPrev = false }, { rejectWithValue, signal }) => {
    try {
      const token = Cookies.get("token");

      const payload = {
        network,
        type,
        range,
        search_after: cursor ? { built_with: cursor } : null,
      };

      const { data } = await axios.post(
        `${PAS_ADMIN_BASEURL}/affiliate_data/counts`,
        payload,
        {
          signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const filteredData = data.data.filter((item) => item.e_commerce !== "");

      data.network = network;
    const dataAffiliate= {
        data: filteredData,
        searchAfter: data.search_after?.built_with || null,
        isPrev,
        cursor,
        network,
        type,
        range,
      };
      return dataAffiliate;
    } catch (error) {
      if (axios.isCancel(error)) throw error;
      return rejectWithValue(error.response?.data?.message || error.message);
    }
  }
);


export const fetchSystemDetails = createAsyncThunk(
  "system/details",
  async (payload, { rejectWithValue, signal }) => {
    try {
      const token = Cookies.get("token");

      const data = await axios.post(
        `${PAS_ADMIN_BASEURL}/system-metrics/system-active`,
        payload,
        { signal }
      );
      return data;
    } catch (error) {
      if (axios.isCancel(error)) throw error;
      return rejectWithValue(error.response?.data?.message || error.message);
    }
  }
);


export const fetchPerticularSystemDetails = createAsyncThunk(
  "perticularsystem/details",
  async (payload, { rejectWithValue, signal }) => {
    try {
      const token = Cookies.get("token");
      const data = await axios.post(
        `${PAS_ADMIN_BASEURL}/system-metrics/system-details
        `,
        payload,
        { signal }
      );
      return data;
    } catch (error) {
      if (axios.isCancel(error)) throw error;
      return rejectWithValue(error.response?.data?.message || error.message);
    }
  }
);


export const fetchPerticularSystemAccountDetails = createAsyncThunk(
  "perticularsystemaccount/details",
  async (payload, { rejectWithValue, signal }) => {
    try {
      const token = Cookies.get("token");
      const data = await axios.post(
        `${PAS_ADMIN_BASEURL}/system-metrics/plugin-with-chart
        `,
        payload,
        { signal }
      );
      return data;
    } catch (error) {
      if (axios.isCancel(error)) throw error;
      return rejectWithValue(error.response?.data?.message || error.message);
    }
  }
);
export const fetchAccountDetails = createAsyncThunk(
  "netwokAccount/details",
  async (args, { rejectWithValue }) => {
    try {
      const token = Cookies.get("token"); // Get token from cookies
      // if (!token) throw new Error("No authentication token found!");
      const { data } = await axios.post(
        `${PAS_ADMIN_BASEURL}/network-account/analytics`,
        args,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      // Ensure deep immutability & modify the response safely
      return data.data;
    } catch (error) {
      return rejectWithValue(error.response.data.message || error.message);
    }
  }
);

export const fetchSystemInsites = createAsyncThunk(
  "SystemInsites/details",
  async (args, { rejectWithValue }) => {
    try {
      const token = Cookies.get("token"); // Get token from cookies
      // if (!token) throw new Error("No authentication token found!");
      const { data } = await axios.post(
        `${PAS_ADMIN_BASEURL}/system-metrics/systems-analytics`,
        args,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      // Ensure deep immutability & modify the response safely
      return data;
    } catch (error) {
      return rejectWithValue(error.response.data.message || error.message);
    }
  }
);

export const fetchSystemInfo = createAsyncThunk(
  "fetchSystemInfo/details",
  async (args, { rejectWithValue }) => {
    try {
      const token = Cookies.get("token"); // Get token from cookies
      // if (!token) throw new Error("No authentication token found!");
      const { data } = await axios.post(
        `${PAS_ADMIN_BASEURL}/system-metrics/systems-names`,
        args,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      // Ensure deep immutability & modify the response safely
      return data;
    } catch (error) {
      return rejectWithValue(error.response.data.message || error.message);
    }
  }
);


// NEW — Crawler dashboard (Grafana-style) overview. Hits the new additive
// backend endpoint; supports a live auto-refresh poll from the UI.
export const fetchDashboardOverview = createAsyncThunk(
  "fetchDashboardOverview/details",
  async (args, { rejectWithValue }) => {
    try {
      const token = Cookies.get("token");
      const { data } = await axios.post(
        `${PAS_ADMIN_BASEURL}/system-metrics/dashboard/overview`,
        args,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      return data;
    } catch (error) {
      return rejectWithValue(error?.response?.data?.message || error.message);
    }
  }
);

// NEW — system drill: per-account breakdown for one system.
export const fetchDashboardSystem = createAsyncThunk(
  "fetchDashboardSystem/details",
  async (args, { rejectWithValue }) => {
    try {
      const token = Cookies.get("token");
      const { data } = await axios.post(
        `${PAS_ADMIN_BASEURL}/system-metrics/dashboard/system`,
        args,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      return data;
    } catch (error) {
      return rejectWithValue(error?.response?.data?.message || error.message);
    }
  }
);

// NEW — all accounts across the fleet (Accounts / Scraping-Now tiles).
export const fetchDashboardAccounts = createAsyncThunk(
  "fetchDashboardAccounts/details",
  async (args, { rejectWithValue }) => {
    try {
      const token = Cookies.get("token");
      const { data } = await axios.post(
        `${PAS_ADMIN_BASEURL}/system-metrics/dashboard/accounts`,
        args,
        { headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } }
      );
      return data;
    } catch (error) {
      return rejectWithValue(error?.response?.data?.message || error.message);
    }
  }
);

// NEW — per-account status timeline (by account_id, reliable).
export const fetchDashboardAccountTimeline = createAsyncThunk(
  "fetchDashboardAccountTimeline/details",
  async (args, { rejectWithValue }) => {
    try {
      const token = Cookies.get("token");
      const { data } = await axios.post(
        `${PAS_ADMIN_BASEURL}/system-metrics/dashboard/account-timeline`,
        args,
        { headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } }
      );
      return data;
    } catch (error) {
      return rejectWithValue(error?.response?.data?.message || error.message);
    }
  }
);

// NEW — discover all platform values present in the data (for the filter).
export const fetchDashboardPlatforms = createAsyncThunk(
  "fetchDashboardPlatforms/details",
  async (args, { rejectWithValue }) => {
    try {
      const token = Cookies.get("token");
      const { data } = await axios.post(
        `${PAS_ADMIN_BASEURL}/system-metrics/dashboard/platforms`,
        args || {},
        { headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } }
      );
      return data;
    } catch (error) {
      return rejectWithValue(error?.response?.data?.message || error.message);
    }
  }
);

// NEW — system data-lineage debug trace.
export const fetchSystemDebug = createAsyncThunk(
  "fetchSystemDebug/details",
  async (args, { rejectWithValue }) => {
    try {
      const token = Cookies.get("token");
      const { data } = await axios.post(
        `${PAS_ADMIN_BASEURL}/system-metrics/dashboard/system-debug`,
        args,
        { headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } }
      );
      return data;
    } catch (error) {
      return rejectWithValue(error?.response?.data?.message || error.message);
    }
  }
);

// NEW — raw metrics exporter (send-metrics) health + freshest snapshot.
export const fetchExporterHealth = createAsyncThunk(
  "fetchExporterHealth/details",
  async (_, { rejectWithValue }) => {
    try {
      const token = Cookies.get("token");
      const { data } = await axios.get(
        `${PAS_ADMIN_BASEURL}/system-metrics/dashboard/exporter-health`,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      return data;
    } catch (error) {
      return rejectWithValue(error?.response?.data?.message || error.message);
    }
  }
);

export const fetchSystemInfoAccounts = createAsyncThunk(
  "fetchSystemInfoAccounts/details",
  async (args, { rejectWithValue }) => {
    try {
      const token = Cookies.get("token"); // Get token from cookies
      // if (!token) throw new Error("No authentication token found!");
      const { data } = await axios.post(
        `${PAS_ADMIN_BASEURL}/system-metrics/accounts-metrics`,
        args,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      // Ensure deep immutability & modify the response safely
      return data;
    } catch (error) {
      return rejectWithValue(error.response.data.message || error.message);
    }
  }
);

export const fetchSystemInfoAccountsList = createAsyncThunk(
  "fetchSystemInfoAccountsList/details",
  async (args, { rejectWithValue }) => {
    try {
      const token = Cookies.get("token"); // Get token from cookies
      // if (!token) throw new Error("No authentication token found!");
      const { data } = await axios.post(
        `${PAS_ADMIN_BASEURL}/system-metrics/accounts-name-list`,
        args,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      // Ensure deep immutability & modify the response safely
      return data;
    } catch (error) {
      return rejectWithValue(error.response.data.message || error.message);
    }
  }
);

export const fetchStatusSystemInfo = createAsyncThunk(
  "fetchStatusSystemInfo/details",
  async (args, { rejectWithValue }) => {
    try {
      const token = Cookies.get("token"); // Get token from cookies
      // if (!token) throw new Error("No authentication token found!");
      const { data } = await axios.post(
        `${PAS_ADMIN_BASEURL}/system-metrics/system-state-chart`,
        args,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      // Ensure deep immutability & modify the response safely
      return data;
    } catch (error) {
      return rejectWithValue(error.response.data.message || error.message);
    }
  }
);
export const fetchStatusAccountInfo = createAsyncThunk(
  "fetchStatusAccountInfo/details",
  async (args, { rejectWithValue }) => {
    try {
      const token = Cookies.get("token"); // Get token from cookies
      // if (!token) throw new Error("No authentication token found!");
      const { data } = await axios.post(
        `${PAS_ADMIN_BASEURL}/system-metrics/account-state-chart`,
        args,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      // Ensure deep immutability & modify the response safely
      return data;
    } catch (error) {
      return rejectWithValue(error.response.data.message || error.message);
    }
  }
);

//domain process api
export const fetchDomaninProcessDetails = createAsyncThunk(
  "netwokDomainProcess/details",
  async (args, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(
        `${PAS_ADMIN_BASEURL}/system-metrics/domains-data`,
        args,
      );
      return data;
    } catch (error) {
      return rejectWithValue(error.response.data.message || error.message);
    }
  }
);