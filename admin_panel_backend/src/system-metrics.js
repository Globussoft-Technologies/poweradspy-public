require('dotenv').config();
const axios = require('axios');
const dayjs = require('dayjs');
const dayjsTz = require('dayjs/plugin/timezone');
const dayjsUtc = require('dayjs/plugin/utc');
const PROMETHEUS_URL = `${process.env.PROMETHEUS_URL}/api/v1/query_range`;
const {adCountAcrossSelectedNetworks, getDomainMetrics, fetchAccountGeo} = require('../utils/db-query-metrics')
const cache = require("../utils/cache")

dayjs.extend(dayjsTz);
dayjs.extend(dayjsUtc);
const mode = process.env.NODE_ENV === "production" ? "prod": "dev";
const Qnetworks = process.env.NETWORKS ? process.env.NETWORKS.split(',') : [];

function getInitialAndFinalTimestamps(range, format = null) {
  if (!range?.from || !range?.to) {
    throw new Error('Invalid date range');
  }

  const timeZone = 'Asia/Kolkata';

  const fromDate = dayjs.tz(range.from, timeZone).startOf('day');
  const toDate = dayjs.tz(range.to, timeZone).endOf('day');

  if (format === "ISO") {
    return {
      from: fromDate.toISOString(),
      to: toDate.toISOString()
    };
  }
  if (format === "IST") {
    return {
      from: fromDate.format(),
      to: toDate.format()
    };
  }
  return {
    from: fromDate.unix(),
    to: toDate.unix()
  };
}

  async function queryRange(promql, start, end, step = '1h') {
    const url = `${PROMETHEUS_URL}?query=${encodeURIComponent(promql)}&start=${start}&end=${end}&step=${step}`;
    try {
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error('Error querying Prometheus:', error.message);
        throw error;
    }
}

async function instantQuery(promql) {
  const url = `${process.env.PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(promql)}`;
  try {
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error('Error during instantQuery:', error.message);
    throw error;
  }
}

// Get system names and their ad counts
async function systemsNames(req, res){
  const { range,platform } = req.body;

  if (!range?.from || !range?.to) {
    return res.status(400).json({ error: 'Missing date range' });
  }

  const currentFrom = dayjs(range.from);
  const currentTo = dayjs(range.to);
  const diffDays = currentTo.diff(currentFrom, 'day') + 1;

  const previousRange = {
    from: currentFrom.subtract(diffDays, 'day').format('YYYY-MM-DD'),
    to: currentFrom.subtract(1, 'day').format('YYYY-MM-DD'),
  };
  const cacheKey = `systemsNames_${currentFrom.toISOString()}_${currentTo.toISOString()}_${previousRange.from}_${previousRange.to}_${platform}`;

        const cachedResult = cache.get(cacheKey);
        if (cachedResult) {
            return res.json(cachedResult);
        }

  try {
    const [currentResults, previousResults] = await Promise.all([
      Promise.all(Qnetworks.map(nw => adCountAcrossSelectedNetworks(range, [nw],null,platform))),
      Promise.all(Qnetworks.map(nw => adCountAcrossSelectedNetworks(previousRange, [nw],null,platform)))
    ]);
    const flattenResults = arr => arr.flat().filter(e => e.system_name); 

    const current = flattenResults(currentResults);
    const previous = flattenResults(previousResults);

    const getGroupedData = (data) => {
      const map = {};
      for (const { system_name, network,  unqiue_ads } of data) {
        const key = `${system_name}_${network}`;
        map[key] = (map[key] || 0) +  unqiue_ads;
      }
      return map;
    };

    const currentMap = getGroupedData(current);
    const previousMap = getGroupedData(previous);

    const systems = [...new Set(current.map(e => e.system_name))];
    const response = [];

    for (const system of systems) {
      const netStats = [];

      for (const network of Qnetworks) {
        const key = `${system}_${network}`;
        const currentAds = currentMap[key] || 0;
        const previousAds = previousMap[key] || 0;

        let percentage = 0;
        let change = 'no_change';

        if (previousAds === 0 && currentAds > 0) {
          percentage = 100;
          change = 'increase';
        } else if (currentAds === 0 && previousAds > 0) {
          percentage = -100;
          change = 'decrease';
        } else if (previousAds > 0) {
          percentage = +(((currentAds - previousAds) / previousAds) * 100).toFixed(2);
          change = percentage > 0 ? 'increase' : percentage < 0 ? 'decrease' : 'no_change';
        }

        netStats.push({ network, percentage, change });
      }

      response.push({ systemName: system, network: netStats });
    }
    response.sort((a, b) => {
      const sumA = a.network.reduce((acc, n) => acc + n.percentage, 0);
      const sumB = b.network.reduce((acc, n) => acc + n.percentage, 0);
      return sumA - sumB;
    });
    cache.set(cacheKey, response);
    res.json(response);
  } catch (error) {
    console.error('Comparison error:', error);
    res.status(500).json({ error: 'Failed to compare performance' });
  }
}


//Get system analytics
async function systemsAnalytics(req, res) {
  const { range, searchTerm, steps, platform } = req.body;

  if (!range?.from || !range?.to || !steps) {
    return res.status(400).json({ error: 'Missing required fields in request body' });
  }

  const { from, to } = getInitialAndFinalTimestamps(range);
  const step = `${steps}h`;
  const knownNetworks = ['facebook', 'instagram', 'gtext', 'gdn', 'native', 'linkedin', 'reddit', 'tiktok', 'pinterest','youtube','quora'];

  const cacheKey = `systemsAnalytics_${from}_${to}_${platform}`;
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    return res.json(cachedResult);
  }

  try {
    const [adCountsResults, prometheusResults] = await Promise.all([
      Promise.all(Qnetworks.map(network => 
        adCountAcrossSelectedNetworks(range, [network], "systemsAnalytics", platform)
          .catch(error => {
            console.error(`Error fetching data for ${network}:`, error);
            return null;
          }))
      ),
      fetchPrometheusData(from, to, step)
        .catch(error => {
          console.error('Error fetching Prometheus data:', error);
          return [];
        })
    ]);

    const validAdCountsResults = adCountsResults.filter(result => result !== null);

    if (validAdCountsResults.length === 0) {
      return res.status(500).json({ error: 'Failed to fetch data from all networks' });
    }

    const { adCounts, systemMetrics, query3Results } = processAdCounts(validAdCountsResults, knownNetworks);
  
    if (adCounts.length === 0) {
      return res.json([]);
    }
    if (Array.isArray(prometheusResults)) {
      processPrometheusData(prometheusResults, systemMetrics);
    }

    const { summary, detailedBySystem } = generateSummaryAndDetails(adCounts, systemMetrics, knownNetworks, query3Results);

    const responseData = {
      summary,
      detailsData: Object.values(detailedBySystem),
      accountActivities: query3Results
    };

    cache.set(cacheKey, responseData);
    return res.json(responseData);

  } catch (error) {
    console.error('Error in systemsAnalytics:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch system analytics',
      details: error.message 
    });
  }
}

async function fetchPrometheusData(from, to, step) {
  try {
    const queries = {
      cpu: `max_over_time(cpu_utilization[${step}])`,
      ram: `max_over_time(ram_utilization[${step}])`,
      accounts:`scroll_plugin_counter_total{mode="prod"}`
    };

    const results = await Promise.all(
      Object.entries(queries).map(async ([key, query]) => {
        try {
          const url = `${PROMETHEUS_URL}?query=${encodeURIComponent(query)}&start=${from}&end=${to}&step=${step}`;
          const { data } = await axios.get(url);
          return { key, data: data?.data?.result || [] };
        } catch (error) {
          console.error(`Error fetching ${key} from Prometheus:`, error);
          return { key, data: [] };
        }
      })
    );

    return results.filter(result => result !== null);
  } catch (error) {
    console.error('Error in fetchPrometheusData:', error);
    return [];
  }
}

function processPrometheusData(results = [], systemMetrics = {}) {
  try {
    if (!Array.isArray(results)) {
      console.error('Prometheus results is not an array:', results);
      return;
    }

    const cpuData = results.find(r => r?.key === 'cpu')?.data || [];
    const ramData = results.find(r => r?.key === 'ram')?.data || [];
    const accountsData = results.find(r => r?.key === 'accounts')?.data || [];


    systemMetrics.accounts = accountsData;

 
    for (const entry of cpuData) {
      if (!entry?.metric?.server_name) continue;
      
      const serverName = entry.metric.server_name;
      if (!systemMetrics[serverName]) {
        systemMetrics[serverName] = { 
          ram: [], 
          cpu: [], 
          performance: [], 
          adsByDay: {} 
        };
      }
      
      systemMetrics[serverName].cpu = (entry.values || []).map(([ts, val]) => ({
        date: parseInt(ts),
        value: parseFloat(val)
      })).filter(e => e.date !== 0);
    }

    for (const entry of ramData) {
      if (!entry?.metric?.server_name) continue;
      
      const serverName = entry.metric.server_name;
      if (!systemMetrics[serverName]) {
        systemMetrics[serverName] = { 
          ram: [], 
          cpu: [], 
          performance: [], 
          adsByDay: {} 
        };
      }
      
      systemMetrics[serverName].ram = (entry.values || []).map(([ts, val]) => ({
        date: parseInt(ts),
        value: parseFloat(val)
      })).filter(e => e.date !== 0);
    }

  
    const coreCount = 12;
    for (const [serverName, metrics] of Object.entries(systemMetrics)) {
      if (serverName === 'accounts') continue; // Skip accounts key
      metrics.performance = (metrics.cpu || []).map(({ date }) => {
        const ads = metrics.adsByDay[dayjs.unix(date).startOf('day').unix()] || 0;
        return { 
          value: +(ads / coreCount).toFixed(2), 
          date 
        };
      });
    }
  } catch (error) {
    console.error('Error in processPrometheusData:', error);
  }
}
function processAdCounts(adCountsResults, knownNetworks) {
  const adCounts = [];
  const systemMetrics = {};
  const adCountsByDay = {};

  for (const result of adCountsResults.flat()) {
    const { network, query, query2, query3 } = result;
    const totalAdsMap = {};
  
    for (const item of (query3 || [])) {
      const key = item.account_id || item.system_id || '';
      if (key) {
        totalAdsMap[key] = item.total_ads;
      }
    }
  
    for (const row of query) {
      const { system_name, account_id, unqiue_ads, account_name } = row;
      const systemKey = system_name || 'NULL_SYSTEM';
      
      const lookupKey = account_id && account_id !== "N/A" ? account_id : system_name;
      const total_ads = totalAdsMap[lookupKey] || 0;
      const updated_ads = total_ads - (unqiue_ads || 0);
      
      adCounts.push({
        system_name: system_name,
        account_name: account_name || "N/A",
        network: network,
        account_id: account_id || "N/A",
        unqiue_ads: unqiue_ads || 0,
        total_ads: total_ads,
        updated_ads: updated_ads
      });
    }
  
    for (const row of query2 || []) {
      const { system_name, ad_date, ads_count } = row;
      const ts = dayjs(ad_date).startOf('day').unix();
  
      const systemKey = system_name || 'NULL_SYSTEM';
      
      if (!adCountsByDay[systemKey]) {
        adCountsByDay[systemKey] = {};
      }
  
      adCountsByDay[systemKey][ts] = (adCountsByDay[systemKey][ts] || 0) + ads_count;
    }
  }

  for (const [systemName, dayData] of Object.entries(adCountsByDay)) {
    systemMetrics[systemName] = {
      ram: [],
      cpu: [],
      performance: [],
      adsByDay: dayData,
      isNullSystem: systemName === 'NULL_SYSTEM'
    };
  }

  return { adCounts, systemMetrics };
}

function generateSummaryAndDetails(adCounts, systemMetrics, knownNetworks) {
  const detailedBySystem = {};
  const accountIds = new Set();
  const networkAccounts = {};
  const networkSystems = {};
  const uniqueSystems = new Set();

  for (const net of knownNetworks) {
    networkAccounts[net] = new Set();
    networkSystems[net] = new Set();
  }

 
  for (const { system_name, account_name, network, total_ads, updated_ads, account_id, unqiue_ads } of adCounts) {
    const normNetwork = knownNetworks.includes(network) ? network : 'native';
    const systemKey = system_name || 'NULL_SYSTEM';

    uniqueSystems.add(systemKey);

    if (!detailedBySystem[systemKey]) {
      detailedBySystem[systemKey] = {
        systemName: system_name,
        ...Object.fromEntries(knownNetworks.map(n => [n, 0])),
        ram: [],
        cpu: [],
        performance: [],
        accounts: [],
        adsByDay: []
      };
    }

    detailedBySystem[systemKey][normNetwork] += total_ads;

    const accountData = {
      account: account_name,
      account_id: account_id,
      system: 'Active',
      network: normNetwork,
      unique_ads: unqiue_ads,
      total_ads: total_ads,
      updated_ads: updated_ads
    };

    const isDuplicate = detailedBySystem[systemKey].accounts.some(acc => 
      acc.account_id === accountData.account_id && acc.network === accountData.network
    );

    if (!isDuplicate) {
      detailedBySystem[systemKey].accounts.push(accountData);
    }

    if (account_id && account_id !== "N/A") {
      const uniqueKey = `${account_id}_${normNetwork}`;
      networkAccounts[normNetwork].add(uniqueKey);
      accountIds.add(uniqueKey);
    }
    networkSystems[normNetwork].add(systemKey);
  }


  const prometheusAccounts = systemMetrics.accounts || [];

  const adCountsAccountKeys = new Set(
    adCounts
      .filter(item => item.account_id && item.account_id !== "N/A")
      .map(item => `${item.account_id}_${item.network}`)
  );

  for (const entry of prometheusAccounts) {
    const { metric } = entry;
    const { account_id, account_name, server_name, network } = metric;

   
    if (!Qnetworks.includes(network) || ['youtube', 'gtext', 'gdn', 'native'].includes(network)) {
      continue;
    }

    const uniqueKey = `${account_id}_${network}`;
    if (adCountsAccountKeys.has(uniqueKey)) {
      continue;
    }

    const systemKey = server_name || 'NULL_SYSTEM';

  
    if (!detailedBySystem[systemKey]) {
      detailedBySystem[systemKey] = {
        systemName: server_name,
        ...Object.fromEntries(knownNetworks.map(n => [n, 0])),
        ram: [],
        cpu: [],
        performance: [],
        accounts: [],
        adsByDay: []
      };
      uniqueSystems.add(systemKey);
    }

    const accountData = {
      account: account_name || "N/A",
      account_id: account_id || "N/A",
      system: 'Inactive',
      network: network,
      unique_ads: 0,
      total_ads: 0,
      updated_ads: 0
    };

   
    const isDuplicate = detailedBySystem[systemKey].accounts.some(acc => 
      acc.account_id === accountData.account_id && acc.network === accountData.network
    );

    if (!isDuplicate) {
      detailedBySystem[systemKey].accounts.push(accountData);
      networkAccounts[network].add(uniqueKey);
      accountIds.add(uniqueKey);
      networkSystems[network].add(systemKey);
    }
  }


  for (const [sys, data] of Object.entries(detailedBySystem)) {
    const metrics = systemMetrics[sys] || {};
    data.adsByDay = Object.entries(metrics.adsByDay || {}).map(([ts, val]) => ({
      timestamp: parseInt(ts),
      value: val
    }));
    data.performance = metrics.performance || [];
    data.cpu = metrics.cpu || [];
    data.ram = metrics.ram || [];
  }


  const networksWithData = knownNetworks.filter(net => 
    networkAccounts[net].size > 0 || networkSystems[net].size > 0
  );

  const summary = {
    totalNetworks: networksWithData.length,
    totalSystems: uniqueSystems.size,
    totalAccounts: accountIds.size
  };

  for (const net of knownNetworks) {
    summary[net] = {
      accounts: networkAccounts[net].size,
      systems: networkSystems[net].size
    };
  }

  return { summary, detailedBySystem: Object.values(detailedBySystem) };
}

// Get account metrics
async function accountsMetrics(req, res) {
  const { range, steps, platform } = req.body;
  if (!range?.from || !range?.to || !steps) return res.status(400).json({ error: 'Missing required fields' });
  const { from, to } = getInitialAndFinalTimestamps(range);
  const step = `${steps}h`;
  const cacheKey = `accountMetrics_${from}_${to}_${platform}`;
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) return res.json(cachedResult);

  try {
    const filtered = arr => arr.filter(p => !['gdn','native','gtext','youtube'].includes(p));
    const validNetworks = filtered(Qnetworks); 
    const adCountsResults = await Promise.all(validNetworks.map(network => adCountAcrossSelectedNetworks(range, [network], 'accountMetrics', platform).catch(() => null)));
    const validNetworkResults = adCountsResults.filter(result => result !== null).flat();
    const allAccounts = new Map();
    
    validNetworkResults.forEach(networkResult => {
      if (!networkResult.query || !networkResult.query3) return;
      const accountInfoMap = {};
      networkResult.query.forEach(account => {
        if (account.account_id) accountInfoMap[account.account_id.toString()] = {
          account_name: account.account_name || null, 
          system_name: account.system_name || 'Unknown',
          unique_ads: account.unqiue_ads || 0
        };
      });
      networkResult.query3.forEach(account => {
        const accountId = account.account_id?.toString();
        if (!accountId || !accountInfoMap[accountId]) return;
        const accountInfo = accountInfoMap[accountId];
        allAccounts.set(accountId, {
          account_name: accountInfo.account_name, 
          account_id: accountId,
          network: networkResult.network.toLowerCase(),
          system_name: accountInfo.system_name,
          unique_ads: accountInfo.unique_ads,
          total_ads: account.total_ads || 0,
          updated_ads: Math.max(0, (account.total_ads || 0) - accountInfo.unique_ads)
        });
      });
    });

    const prometheusData = await fetchPrometheusMetrics(from, to, step);
    const { adsData, cpuData, heartbeatData, accountsData } = prometheusData;
    const cpuMap = createCpuMap(cpuData);
    const heartbeatMap = createHeartbeatMap(heartbeatData);
    accountsData.forEach(({ metric }) => {
      const accountId = metric.account_id?.toString();
      if (!accountId || !validNetworks.includes(metric.network?.toLowerCase())) return;
      
      const compositeKey = `${accountId}_${metric.server_name || 'Unknown'}`;
      if (!allAccounts.has(accountId)) {
        allAccounts.set(accountId, {
          account_name: metric.account_name || null,
          account_id: accountId,
          network: metric.network.toLowerCase(),
          system_name: metric.server_name || 'Unknown',
          unique_ads: 0,
          total_ads: 0,
          updated_ads: 0,
          // Store composite key for heartbeat lookup
          compositeKey
        });
      }
    });
  

    const defaultPerformance = generateDefaultPerformance(from, to, step);
    // const accountMetrics = processMetricsWithFallback(adsData, cpuMap, new Map([...allAccounts].map(([_, acc]) => [`${acc.account_name || 'Unknown'}_${acc.network}_${acc.system_name}`, acc])), defaultPerformance, heartbeatMap);
    const accountMetrics = processMetricsWithFallback(
      adsData, 
      cpuMap, 
      new Map([...allAccounts].map(([_, acc]) => [
        `${acc.account_name || 'Unknown'}_${acc.network}_${acc.system_name}`, 
        acc
      ])), 
      defaultPerformance, 
      heartbeatMap
    );
    const response = [...allAccounts.values()].map(account => {
      const metricsKey = `${account.account_name || 'Unknown'}_${account.network}_${account.system_name}`;
    const heartbeatKey = account.compositeKey || `${account.account_id}_${account.system_name}`;
    
      // const key = `${account.account_name || 'Unknown'}_${account.network}_${account.system_name}`;
      // const metrics = accountMetrics.get(key) || { performance: defaultPerformance, rawAdsByDay: {}, heartbeatStatus: [], isActive: false };
      const metrics = accountMetrics.get(metricsKey) || { 
        performance: defaultPerformance, 
        rawAdsByDay: {}, 
        heartbeatStatus: [], 
        isActive: false 
      };
      const heartbeatInfo = heartbeatMap.get(heartbeatKey) || { 
        statusData: [], 
        isAlert: true 
      };
      metrics.heartbeatStatus = heartbeatInfo.statusData;
      metrics.isActive = !heartbeatInfo.isAlert;
      const adsByDay = Object.entries(metrics.rawAdsByDay).map(([timestamp, value]) => ({ timestamp: parseInt(timestamp, 10), value: Math.round(value) })).sort((a, b) => a.timestamp - b.timestamp);
      const heartbeatStatus = metrics.heartbeatStatus.map(item => ({ timestamp: item.timestamp, active: item.active, value: item.active ? 1 : 0 }));
      const currentTime = Math.floor(Date.now() / 1000);
      const lastHeartbeat = metrics.heartbeatStatus.sort((a, b) => b.timestamp - a.timestamp)[0];
      const isInactive = !lastHeartbeat || (currentTime - lastHeartbeat.timestamp) > 1800 || !lastHeartbeat.active;
      let alert = { isActive: metrics.isActive, lastHeartbeat: metrics.heartbeatStatus[0]?.timestamp || null, message: null, color: null };
      if (account.total_ads === 0 && metrics.isActive) { alert.message = 'Account is active but has no ads'; alert.color = 'yellow'; } else if (isInactive) { alert.message = 'Account is inactive'; alert.color = 'red'; }
      return {
        account_id: account.account_id,
        account: account.account_name,
        system: account.system_name,
        network: account.network.charAt(0).toUpperCase() + account.network.slice(1),
        ads: account.total_ads,
        unique_ads: account.unique_ads,
        updated_ads: account.updated_ads,
        performance: metrics.performance.map(p => ({ value: p.value ? Math.round(p.value * 100) / 100 : 0, date: p.date })),
        adsByDay,
        heartbeatStatus,
        alert
      };
    }).filter(item => item !== null);

    // ── Country + IP enrichment (System-Info table columns) ──────────────────
    // IP is sourced only from the DB (per the schema); country prefers the
    // Prometheus `country` label (cleaner + consistent, e.g. "United States")
    // and falls back to the DB user-table value for accounts not currently
    // emitting the metric. Looked up per network, keyed by account_id. Failures
    // are swallowed inside fetchAccountGeo so the table still renders without geo.
    const promCountryMap = new Map();
    accountsData.forEach(({ metric }) => {
      const id = metric.account_id?.toString();
      if (id && metric.country && !promCountryMap.has(id)) promCountryMap.set(id, metric.country);
    });
    const idsByNetwork = {};
    for (const r of response) {
      const net = (r.network || '').toLowerCase();
      if (!net || !r.account_id) continue;
      (idsByNetwork[net] ||= new Set()).add(String(r.account_id));
    }
    const geoEntries = await Promise.all(
      Object.entries(idsByNetwork).map(async ([net, set]) => [net, await fetchAccountGeo(net, [...set])])
    );
    const geoByNetwork = Object.fromEntries(geoEntries);
    for (const r of response) {
      const net = (r.network || '').toLowerCase();
      const g = geoByNetwork[net]?.get(String(r.account_id));
      r.country = promCountryMap.get(String(r.account_id)) || g?.country || null;
      r.ip_address = g?.ip || null;
    }

    cache.set(cacheKey, response);
    return res.json(response);
  } catch (error) {
    console.error('Failed to process metrics:', error);
    return res.status(500).json({ error: 'Internal server error', details: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
}

function createHeartbeatMap(heartbeatData) {
  const heartbeatMap = new Map();
  const currentTime = Math.floor(Date.now() / 1000);
  const alertThreshold = 300; // 5 minutes in seconds

  heartbeatData.forEach(({ metric, values = [] }) => {
    const accountId = metric.account_id;
    const systemName = metric.server_name;
    if (!accountId || !systemName) return;

    // Key combines account_id and system_name to handle multiple systems per account
    const compositeKey = `${accountId}_${systemName}`;
    
    // Find the most recent heartbeat in the last 5 minutes
    const latestHeartbeat = values.reduce((latest, [timestamp, value]) => {
      const ts = parseInt(timestamp, 10);
      const isActive = parseFloat(value) > 0;
      return (ts > latest.timestamp) ? { timestamp: ts, active: isActive } : latest;
    }, { timestamp: 0, active: false });

    const isActive = latestHeartbeat.active && (currentTime - latestHeartbeat.timestamp) <= alertThreshold;
    
    heartbeatMap.set(compositeKey, {
      statusData: [{
        timestamp: latestHeartbeat.timestamp,
        active: isActive,
        value: isActive ? 1 : 0
      }],
      isAlert: !isActive
    });
  });

  return heartbeatMap;
}

function generateDefaultPerformance(from, to, step) {
  const performance = [];
  const stepInSeconds = parseInt(step) * 3600; 
  let current = from;
  while (current <= to) {
    performance.push({ value: 0, date: current });
    current += stepInSeconds;
  }
  return performance;
}

function processMetricsWithFallback(adsData, cpuMap, validKeys, defaultPerformance, heartbeatMap) {
  const accountMetrics = new Map();
  validKeys.forEach((account, key) => {
    const heartbeatInfo = heartbeatMap.get(account.account_id) || { statusData: [], isAlert: true };
    accountMetrics.set(key, { performance: JSON.parse(JSON.stringify(defaultPerformance)), rawAdsByDay: {}, heartbeatStatus: heartbeatInfo.statusData, isActive: !heartbeatInfo.isAlert });
  });
  for (const { metric, values = [] } of adsData) {
    if (metric.server_name === null) continue;
    const normNetwork = metric.network.toLowerCase();
    const key = `${metric.account_name || 'Unknown'}_${normNetwork}_${metric.server_name}`;
    if (!validKeys.has(key)) continue;
    const cpuSeries = cpuMap[metric.server_name] || [];
    const metricEntry = accountMetrics.get(key);
    for (let idx = 0; idx < values.length; idx++) {
      const [ts, val] = values[idx];
      const adsCount = parseFloat(val);
      const cpuVal = cpuSeries[idx]?.value || 1;
      const perf = Math.round(adsCount / cpuVal * 100) / 100;
      const timestamp = parseInt(ts, 10);
      if (metricEntry.performance[idx]) {
        metricEntry.performance[idx].value = perf;
        metricEntry.performance[idx].date = timestamp;
      }
      const dayTimestamp = Math.floor(timestamp / 86400) * 86400;
      metricEntry.rawAdsByDay[dayTimestamp] = (metricEntry.rawAdsByDay[dayTimestamp] || 0) + adsCount;
    }
  }
  return accountMetrics;
}

async function fetchPrometheusMetrics(from, to, step) {
  const queries = [
    ['ads', `max by (account_name, network, server_name) (increase(scroll_plugin_counter_total{mode="prod"}[${step}]))`],
    ['cpu', `max_over_time(cpu_utilization[${step}])`],
    ['heartbeat', `increase(account_active_hb_total[100s]) > 0`],
    ['accounts', `scroll_plugin_counter_total{mode="prod"}`]
  ];
  
  const results = await Promise.all(queries.map(async ([key, query]) => {
    let queryUrl = query;
    if (key === 'heartbeat') {
      queryUrl = `${PROMETHEUS_URL}?query=${encodeURIComponent(query)}&start=${Math.floor(Date.now() / 1000) - 300}&end=${Math.floor(Date.now() / 1000)}&step=15s`;
    } else {
      queryUrl = `${PROMETHEUS_URL}?query=${encodeURIComponent(query)}&start=${from}&end=${to}&step=${step}`;
    }
    const { data } = await axios.get(queryUrl);
    return { key, data: data.data.result };
  }));
  
  return {
    adsData: results[0].data,
    cpuData: results[1].data,
    heartbeatData: results[2].data,
    accountsData: results[3].data
  };
}



function createCpuMap(cpuData) {
  const cpuMap = Object.create(null);
  for (const { metric: { server_name }, values = [] } of cpuData) {
    cpuMap[server_name] = values.map(([ts, val]) => ({ date: parseInt(ts, 10), value: parseFloat(val) }));
  }
  return cpuMap;
}


//Get account names
async function accountsNameList(req, res) {
  const { range, mode, steps } = req.body;

  if (!range?.from || !range?.to || !steps || !mode) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const from = dayjs(range.from).unix();
  const to = dayjs(range.to).unix();
  const step = `${steps}h`;

  const query = `sum by (account_name) (increase(scroll_plugin_counter_total[${step}]))`;

  const cacheKey = `accountsNameList_${from}_${to}_${steps}_${mode}`;

  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    return res.json(cachedResult);
  }

  try {
    const url = `${PROMETHEUS_URL}?query=${encodeURIComponent(query)}&start=${from}&end=${to}&step=${step}`;
    const { data } = await axios.get(url);

    const accounts = new Set();

    for (const result of data.data?.result || []) {
      const name = result.metric?.account_name || 'na';
      accounts.add(name);
    }

    const result = { accounts: [...accounts] };

    cache.set(cacheKey, result);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch Prometheus data' });
  }
}

// Get system details
async function systemsDetails(req, res) {
  try {
    const { range, system, steps, network, mode } = req.body;

    if (!range?.from || !range?.to || !steps || !system) {
      return res.status(400).json({ error: 'Missing required fields in request body' });
    }

    const { from, to } = getInitialAndFinalTimestamps(range, 'ISO');
    const cacheKey = `systemsDetails_${system}_${from}_${to}_${steps}_${network}_${mode}`;
    
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
      return res.json(cachedResult);
    }

    const detailsQuery = `system_details{server_name="${system}"}`;
    const detailsResp = await instantQuery(detailsQuery);
    
    const defaultDetails = {
      hostname: system,
      os: 'unknown',
      platform: 'unknown',
      cpu_model: 'unknown',
      cpu_cores: 0,
      disk_storage: { value: 0.0, unit: 'GB' },
      total_ram: { value: 0.0, unit: 'GB' },
      alerts: {
        high_cpu: false,
        high_ram: false,
        high_disk: false,
      },
    };

    const details = detailsResp.data.result?.reduce((acc, resItem) => {
      const m = resItem.metric || {};
      return {
        ...acc,
        hostname: m.hostname || system,
        os: m.os || 'unknown',
        platform: m.platform || 'unknown',
        cpu_model: m.cpu_model || 'unknown',
        cpu_cores: parseInt(m.cpu_cores || 0),
        disk_storage: { value: parseFloat(m.total_storage_gb || 0), unit: 'GB' },
        total_ram: { value: parseFloat(m.total_ram_gb || 0), unit: 'GB' },
        alerts: {
          high_cpu: m.is_cpu_usage_high === 'True',
          high_ram: m.is_ram_usage_high === 'True',
          high_disk: m.is_disk_usage_high === 'True',
        },
      };
    }, defaultDetails);

    const getMetricStats = async (metricName) => {
      try {
        const query = `${metricName}{server_name="${system}"}`;
        const resp = await queryRange(query, from, to, `${steps}h`);
        
        if (!resp.data.result?.length) return null;
        
        const values = resp.data.result[0].values
          .map(v => parseFloat(v[1]))
          .filter(v => !isNaN(v));
        
        if (!values.length) return null;
        
        values.sort((a, b) => a - b);
        
        return {
          min: values[0],
          max: values[values.length - 1],
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          '25%': values[Math.floor(values.length * 0.25)],
          '50%': values[Math.floor(values.length * 0.5)],
          '75%': values[Math.floor(values.length * 0.75)],
          current: values[values.length - 1] 
        };
      } catch (err) {
        console.warn(`Error fetching ${metricName}:`, err.message);
        return null;
      }
    };

    const checkSystemStatus = async () => {
      try {
        const hbQuery = `irate(system_active_hb_total{server_name="${system}"}[90s])`;
        const recentStart = dayjs().subtract(1, 'hour').toISOString();
        const recentEnd = dayjs().toISOString();
        
        const hbResp = await queryRange(hbQuery, recentStart, recentEnd, '90s');
        const values = hbResp.data.result?.[0]?.values || [];
        
        const isActive = values.some(v => parseFloat(v[1]) > 0);
        const lastActive = values.filter(v => parseFloat(v[1]) > 0).pop();
        
        return {
          status: isActive ? 'active' : 'inactive',
          lastActive: lastActive ? parseInt(lastActive[0]) : null,
          uptime: isActive ? dayjs().diff(dayjs(lastActive[0] * 1000), 'second') : 0
        };
      } catch (err) {
        console.warn('Heartbeat query failed:', err.message);
        return {
          status: 'inactive',
          lastActive: null,
          uptime: 0
        };
      }
    };

    const getNetworkUsage = async () => {
      try {
        const query = `network_usage_total{server_name="${system}"}`;
        const resp = await queryRange(query, dayjs().subtract(1, 'hour').toISOString(), dayjs().toISOString(), '1m');
        
        if (!resp.data.result?.length) return 0;
        
        const values = resp.data.result[0].values
          .map(v => parseFloat(v[1]))
          .filter(v => !isNaN(v));
        
        return values.length ? Math.max(...values) : 0;
      } catch (err) {
        console.warn('Network usage query failed:', err.message);
        return 0;
      }
    };

    const [cpuStats, ramStats, statusInfo, netVal] = await Promise.all([
      getMetricStats('cpu_utilization'),
      getMetricStats('ram_utilization'),
      checkSystemStatus(),
      getNetworkUsage()
    ]);

    const nowTs = Math.floor(Date.now() / 1000);
    
    const response = {
      start: from,
      end: to,
      steps,
      server_name: system,
      network,
      mode,
      system_info: details,
      metrics: {
        cpu: { 
          unit: '%', 
          values: cpuStats || { 
            min: 0, max: 0, avg: 0, '25%': 0, '50%': 0, '75%': 0, current: 0 
          } 
        },
        ram: { 
          unit: '%', 
          values: ramStats || { 
            min: 0, max: 0, avg: 0, '25%': 0, '50%': 0, '75%': 0, current: 0 
          } 
        },
        network: { 
          unit: 'MB', 
          max: netVal,
          current: netVal 
        },
        uptime: { 
          unit: 'seconds', 
          last: statusInfo.uptime, 
          last_timestamp: statusInfo.lastActive || nowTs, 
          status: statusInfo.status 
        },
      },
      last_updated: nowTs
    };

    cache.set(cacheKey, response);
    res.json(response);
  } catch (err) {
    console.error('Error in /system/details:', err);
    res.status(500).json({ 
      error: 'Internal server error',
      message: err.message 
    });
  }
}

// Get plugin with chart
async function pluginWithChart(req, res) {
  try {
    const { range, steps, network, system: requestedSystem, platform } = req.body;

    if (!range?.from || !range?.to || !steps || !network || !requestedSystem) {
      return res.status(400).json({ error: 'Missing required fields in request body' });
    }

    const { from, to } = getInitialAndFinalTimestamps(range);
    const start = from;
    const end = to;
    const step = `${steps}h`;

    const cacheKey = `pluginWithChart_${network}_${requestedSystem}_${start}_${end}_${steps}_${platform}`;
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
      return res.json(cachedResult);
    }

    const sqlData = (await adCountAcrossSelectedNetworks(range, [network], null, platform))
      .filter(item => item.system_name === requestedSystem);
    
    if (sqlData.length === 0) {
      return res.status(404).json({ 
        error: 'No data found for the specified system',
        requestedSystem,
        network
      });
    }

    const sqlAccountMap = new Map();
    sqlData.forEach(item => {
      sqlAccountMap.set(item.account_id.toString(), {
        system_name: item.system_name,
        network: item.network,
        account_name: item.account_name || null, 
        total_ads: item.unqiue_ads
      });
    });

    const accountIds = Array.from(sqlAccountMap.keys()).join('|');
    const promQL = `sum by(plugin_id, account_id, country) (
      scroll_plugin_counter_total{
        network="${network}",
        server_name="${requestedSystem}",
        account_id=~"${accountIds}",
        mode="${mode}"
      }
    )`;

    const params = {
      query: promQL,
      start,
      end,
      step
    };

    const prometheusRes = await axios.get(PROMETHEUS_URL, { params });
    const results = prometheusRes.data.data.result;

    const prometheusAccountMap = new Map();
    results.forEach(series => {
      const account_id = series.metric.account_id;
      prometheusAccountMap.set(account_id, {
        plugin_id: series.metric.plugin_id,
        country: series.metric.country
      });
    });

    const response = {
      system: requestedSystem,
      network,
      total_ad_count: 0,
      plugin_count: 0,
      accounts: []
    };

    sqlAccountMap.forEach((sqlAccount, account_id) => {
      const prometheusData = prometheusAccountMap.get(account_id) || {};
      
      const account = {
        ...sqlAccount,
        account_id, 
        plugin_id: prometheusData.plugin_id || null,
        country: prometheusData.country || null,
        ad_types: {},
        messages: {
          inserted: 0,
          updated: 0,
          undefined: 0,
          failed: 0
        }
      };

      response.accounts.push(account);
      response.total_ad_count += sqlAccount.total_ads;
    });

    response.plugin_count = new Set(
      response.accounts.map(a => a.plugin_id).filter(Boolean)
    ).size;

    response.metadata = {
      sql_account_count: sqlAccountMap.size,
      prometheus_account_count: prometheusAccountMap.size,
      accounts_missing_prometheus_data: Array.from(sqlAccountMap.keys())
        .filter(id => !prometheusAccountMap.has(id))
        .map(id => ({
          account_id: id,
          account_name: sqlAccountMap.get(id).account_name 
        }))
    };

    cache.set(cacheKey, response);
    return res.json(response);
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ 
      error: 'Internal Server Error',
      details: err.message 
    });
  }
}


class SystemStatus {
  constructor(uptime_changes = false, cpu_changes = false, ram_changes = false, final_status = 'stopped') {
    this.uptime_changes = uptime_changes;
    this.cpu_changes = cpu_changes;
    this.ram_changes = ram_changes;
    this.final_status = final_status;
  }
}

class ActiveResponse {
  constructor(start, end, mode, active_systems, inactive_systems, all_status) {
    this.start = start;
    this.end = end;
    this.mode = mode;
    this.active_systems = active_systems;
    this.inactive_systems = inactive_systems;
    this.all_status = all_status;
  }
}

// Get system active details
async function systemActive(req, res) {
  const { range, network, mode, platform } = req.body;

  if (!range?.from || !range?.to || !network) {
    return res.status(400).json({ error: 'Missing required fields in request body' });
  }

  const { from, to } = getInitialAndFinalTimestamps(range, 'ISO');
  const cacheKey = `systemActive_${network}_${from}_${to}_${platform}`;
  const cachedResult = cache.get(cacheKey);
  if (cachedResult && Date.now() - cachedResult.cachedAt < 5000) {
    return res.json(cachedResult.response);
  }

  try {
    const [systemsFromAds, pluginResult] = await Promise.all([
      adCountAcrossSelectedNetworks(range, [network], "systemActive",platform),
      queryRange(`scroll_plugin_counter_total{network="${network}",mode="${mode}"}`, from, to)
        .catch(err => {
          console.error('Plugin query failed:', err);
          return { data: { result: [] } };
        })
    ]);
    const pluginSystems = new Set(
      pluginResult.data.result
        .map(res => res.metric.server_name)
        .filter(Boolean)
    );

    const allSystemsToCheck = [...new Set([...systemsFromAds, ...pluginSystems])];

    const recentStart = dayjs().subtract(30, 'minute').toISOString();
    const recentEnd = dayjs().toISOString();
    const hbQuery = `irate(system_active_hb_total{server_name=~"${allSystemsToCheck.join('|')}"}[90s])`;
    
    const hbResult = await queryRange(hbQuery, recentStart, recentEnd, '90s')
      .catch(err => {
        console.error('Heartbeat query failed:', err);
        return { data: { result: [] } };
      });

    const activeSystems = new Set(
      hbResult.data.result
        .filter(res => res.values?.some(v => parseFloat(v[1]) > 0))
        .map(res => res.metric.server_name)
    );

    const allStatus = Object.fromEntries(
      allSystemsToCheck.map(system => [
        system,
        new SystemStatus(
          false,
          false,
          false,
          activeSystems.has(system) ? 'running' : 'stopped'
        )
      ])
    );

    const finalActive = systemsFromAds.filter(s => activeSystems.has(s)).sort();
    const finalInactive = systemsFromAds.filter(s => !activeSystems.has(s)).sort();

    const response = new ActiveResponse(
      from, 
      to, 
      mode, 
      finalActive, 
      finalInactive, 
      allStatus
    );

    cache.set(cacheKey, {
      response,
      cachedAt: Date.now()
    });

    return res.json(response);

  } catch (error) {
    console.error('System active check failed:', error);
    return res.status(500).json({ error: 'Failed to check system status' });
  }
}

function formatDuration(seconds) {
  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

const systemStateChart = async (req, res) => {
  try {
    const { range, systemName } = req.body;
    if(!range?.from || !range?.to || !systemName) {
      return res.status(400).json({ error: "Missing required fields in request body" });
    }
    const { from, to } = getInitialAndFinalTimestamps(range);
    const step = 135; 

    const prometheusQuery = `increase(system_active_hb_total{server_name="${systemName}"}[135s])`;

    const response = await axios.get(PROMETHEUS_URL, {
      params: {
        query: prometheusQuery,
        start: from,
        end: to,
        step,
      },
    });

    const result = response.data.data.result[0];
    if (!result || !result.values || result.values.length === 0) {
      return res.status(404).json({ error: "No data found for the given system" });
    }

    const values = result.values;
    let timeline = [];
    let totalActive = 0;
    let totalInactive = 0;
    let currentState = parseFloat(values[0][1]) > 0;
    let periodStart = parseInt(values[0][0]);

    for (let i = 1; i < values.length; i++) {
      const [timestampStr, valStr] = values[i];
      const timestamp = parseInt(timestampStr);
      const newState = parseFloat(valStr) > 0;

      if (newState !== currentState) {
        const periodEnd = timestamp - 1; 
        const duration = periodEnd - periodStart + 1;

        if (currentState) totalActive += duration;
        else totalInactive += duration;

        timeline.push({
          category: systemName,
          from: periodStart,
          to: periodEnd,
          name: currentState ? "Active" : "Inactive",
          columnSettings: {
            fill: currentState ? "am5.color(0x4caf50)" : "am5.color(0xcd213b)",
          },
        });

        currentState = newState;
        periodStart = timestamp;
      }
    }

    const lastTimestamp = parseInt(values[values.length - 1][0]);
    const lastDuration = lastTimestamp - periodStart + 1;

    if (currentState) totalActive += lastDuration;
    else totalInactive += lastDuration;

    timeline.push({
      category: systemName,
      from: periodStart,
      to: lastTimestamp,
      name: currentState ? "Active" : "Inactive",
      columnSettings: {
        fill: currentState ? "am5.color(0x4caf50)" : "am5.color(0xcd213b)",
      },
    });

    res.json({
      timeline,
      totalActive: formatDuration(totalActive),
      totalInactive: formatDuration(totalInactive),
    });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

const accountStateChart = async (req, res) => {
  try {
    const { range, accountName,systemName } = req.body;
    if(!range?.from || !range?.to || !accountName || !systemName) {
      return res.status(400).json({ error: "Missing required fields in request body" });
    }
    const { from, to } = getInitialAndFinalTimestamps(range);
    const step = 180; 

    const prometheusQuery = `increase(account_active_hb_total{account_name="${accountName}",server_name="${systemName}"}[100s])`;
    const response = await axios.get(PROMETHEUS_URL, {
      params: {
        query: prometheusQuery,
        start: from,
        end: to,
        step,
      },
    });

    const result = response.data.data.result[0];
    if (!result || !result.values || result.values.length === 0) {
      return res.status(404).json({ error: "No data found for the given account" });
    }

    const values = result.values;
    let timeline = [];
    let totalActive = 0;
    let totalInactive = 0;

    let currentState = parseFloat(values[0][1]) > 0;
    let periodStart = parseInt(values[0][0]);

    for (let i = 1; i < values.length; i++) {
      const [timestampStr, valStr] = values[i];
      const timestamp = parseInt(timestampStr);
      const newState = parseFloat(valStr) > 0;

      if (newState !== currentState) {
        const periodEnd = timestamp - 1; 
        const duration = periodEnd - periodStart + 1;

        if (currentState) totalActive += duration;
        else totalInactive += duration;

        timeline.push({
          category: accountName,
          from: periodStart,
          to: periodEnd,
          name: currentState ? "Active" : "Inactive",
          columnSettings: {
            fill: currentState ? "am5.color(0x4caf50)" : "am5.color(0xcd213b)",
          },
        });
        currentState = newState;
        periodStart = timestamp;
      }
    }

    const lastTimestamp = parseInt(values[values.length - 1][0]);
    const lastDuration = lastTimestamp - periodStart + 1;

    if (currentState) totalActive += lastDuration;
    else totalInactive += lastDuration;

    timeline.push({
      category: accountName,
      from: periodStart,
      to: lastTimestamp,
      name: currentState ? "Active" : "Inactive",
      columnSettings: {
        fill: currentState ? "am5.color(0x4caf50)" : "am5.color(0xcd213b)",
      },
    });

    res.json({
      timeline,
      totalActive: formatDuration(totalActive),
      totalInactive: formatDuration(totalInactive),
    });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getDomainsProcessed = async (req, res) => {
  try {
    const { range } = req.body;

    if (!range?.from || !range?.to) {
      return res.status(400).json({ error: 'Missing required fields in request body' });
    }
    const cacheKey = `domainMetrics-${range.from}-${range.to}`;
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
      return res.status(200).json(cachedResult);
    }
    const domainData = await Promise.all(
      ['facebook','instagram'].map(async (net) => {
        const data = await getDomainMetrics(net, range);
        return data;
      })
    );

    const flatResult = domainData.flat();
    cache.set(cacheKey, flatResult);

    res.status(200).json(flatResult);
  } catch (error) {
    res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


module.exports = {systemsNames, systemsAnalytics, accountsMetrics, accountsNameList, pluginWithChart, systemsDetails, systemActive,systemStateChart,accountStateChart,getDomainsProcessed}