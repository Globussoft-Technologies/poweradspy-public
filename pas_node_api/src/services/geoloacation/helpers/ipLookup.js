'use strict';

/**
 * IP → location lookup via ip-api.com.
 *
 * Same source and field mapping as the PHP stevebauman/location IpApi driver,
 * so the response shape matches the PHP API exactly. isoCode / postalCode /
 * metroCode / areaCode are not filled by that driver either — always null.
 */

const axios = require('axios');

const LOOKUP_URL = 'http://ip-api.com/json/';
const LOOKUP_TIMEOUT_MS = 5000;
const FIELDS = 'status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,currency,isp,org,as,query';

async function lookupIp(ip) {
  const { data } = await axios.get(`${LOOKUP_URL}${encodeURIComponent(ip)}`, {
    params: { fields: FIELDS },
    timeout: LOOKUP_TIMEOUT_MS,
  });

  if (!data || data.status !== 'success') {
    throw new Error(`Location lookup failed for ${ip}: ${data?.message || 'no data'}`);
  }

  return {
    ip: ip || data.query,
    countryName: data.country ?? null,
    countryCode: data.countryCode ?? null,
    regionCode: data.region ?? null,
    regionName: data.regionName ?? null,
    cityName: data.city ?? null,
    zipCode: data.zip ?? null,
    isoCode: null,
    postalCode: null,
    latitude: data.lat != null ? String(data.lat) : null,
    longitude: data.lon != null ? String(data.lon) : null,
    metroCode: null,
    areaCode: null,
  };
}

module.exports = { lookupIp };
