'use strict';

const networks = require('../../config/networks');
const { rejected } = require('./responses');

function normalizePostOwnerName(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function getRejectedPostOwnerNames(network) {
  const names = networks[network]?.insertion?.rejectedPostOwnerNames;
  return Array.isArray(names) ? names : [];
}

function rejectConfiguredPostOwner(ad, network) {
  if (!network || !ad || typeof ad !== 'object') return null;

  const owner = ad.post_owner ?? ad.post_owner_name;
  const normalizedOwner = normalizePostOwnerName(owner);
  if (!normalizedOwner) return null;

  const blocked = getRejectedPostOwnerNames(network)
    .some((name) => normalizePostOwnerName(name) === normalizedOwner);
  if (!blocked) return null;

  return rejected(422, 'Ad rejected because its post owner is blocked for this network.', {
    field: 'post_owner',
    hint: `Remove "${String(owner).trim()}" from networks.${network}.insertion.rejectedPostOwnerNames only if this advertiser should be allowed.`,
  });
}

module.exports = {
  normalizePostOwnerName,
  getRejectedPostOwnerNames,
  rejectConfiguredPostOwner,
};
