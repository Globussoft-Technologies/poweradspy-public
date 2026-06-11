'use strict';

const config = require('../../../config');
const https = require('https');
const http = require('http');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('Invalid JSON from ' + url)); }
      });
    }).on('error', reject);
  });
}

function buildAmemberUrl(status, page, userId) {
  const apiUrl = config.amember.apiUrl || process.env.AMEMBER_API_URL;
  const apiKey = config.amember.apiKey || process.env.AMEMBER_API_KEY;

  if (!apiUrl || !apiKey) return null;

  const base = `${apiUrl}users?_key=${apiKey}&_filter[status]=${status}`;
  if (userId) return `${base}&_filter[user_id]=${userId}`;
  return `${base}&_page=${page}&_size=20`;
}

function parseUsers(result) {
  const userDetails = [];
  for (const [key, res] of Object.entries(result)) {
    if (!isNaN(Number(key))) {
      userDetails.push({
        user_id: res.user_id,
        name: `${res.name_f} ${res.name_l}`,
        email: res.email,
      });
    }
  }
  return userDetails;
}

async function fetchUsers(status, req, logger) {
  const page   = req.query.page   || 1;
  const size   = req.query.size   || 20;
  const userId = req.query.user_id;

  const url = buildAmemberUrl(status, page, userId);
  if (!url) {
    return { code: 503, message: 'aMember API not configured' };
  }

  try {
    const result = await fetchUrl(url);

    const userDetails = parseUsers(result);
    const total = result._total ?? 0;

    if (userDetails.length === 0) {
      return { code: 400, message: 'There is no data' };
    }

    return {
      code:       200,
      message:    'User details fetched successfully',
      totalCount: total,
      page:       Number(page),
      size:       Number(size),
      data:       userDetails,
    };
  } catch (err) {
    logger.error('Error fetching users from aMember', { error: err.message, status });
    return { code: 400, message: `Error occurred: ${err.message}` };
  }
}

async function getActiveUsers(req, logger) {
  return fetchUsers(1, req, logger);
}

async function getExpiredUsers(req, logger) {
  return fetchUsers(2, req, logger);
}

async function getPendingUsers(req, logger) {
  return fetchUsers(0, req, logger);
}

module.exports = { getActiveUsers, getExpiredUsers, getPendingUsers };
