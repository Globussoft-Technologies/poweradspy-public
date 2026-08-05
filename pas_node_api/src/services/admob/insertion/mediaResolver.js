'use strict';

const axios = require('axios');

async function resolveMediaUrl(url) {
  if (!url || !/^https?:\/\/tmpfiles\.org\//i.test(url)) return url;
  const parsed = new URL(url);
  if (parsed.pathname.startsWith('/dl/')) return url;

  const { data } = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 15000,
    maxRedirects: 5,
    responseType: 'text',
  });
  const html = String(data);
  const match = html.match(/<a[^>]*class=["'][^"']*download[^"']*["'][^>]*href=["']([^"']+)["']/i) ||
    html.match(/<img[^>]*id=["']img_preview["'][^>]*src=["']([^"']+)["']/i);
  if (!match?.[1]) {
    const error = new Error('The tmpfiles page did not expose a direct image download URL.');
    error.code = 'TMPFILES_DIRECT_URL_NOT_FOUND';
    throw error;
  }
  return new URL(match[1], url).toString();
}

module.exports = { resolveMediaUrl };
