'use strict';

const { getDB } = require('../db');

const CACHE_KEY = 'sidebar_filters';
const cache = new Map();

function cacheGet(key) { return cache.get(key); }
function cacheSet(key, val) { cache.set(key, val); }
function cacheDelete(key) { cache.delete(key); }

/**
 * Build nested option hierarchy for nested_multiselect filters.
 */
function buildNestedOptions(options) {
  const parentMap = new Map();
  const result = [];

  for (const opt of options) {
    if (!opt.parent_id) {
      parentMap.set(opt._id, opt);
      result.push(opt);
    }
  }
  for (const opt of options) {
    if (opt.parent_id) {
      const parent = parentMap.get(opt.parent_id);
      if (parent) {
        if (!parent.sub_options) parent.sub_options = [];
        parent.sub_options.push(opt);
      }
    }
  }
  return result;
}

/**
 * GET /api/filters
 * Returns all filter groups with nested filters and options (cached).
 */
async function getFilters() {
  const cached = cacheGet(CACHE_KEY);
  if (cached) return cached;

  const result = await loadFiltersFromMongo();
  cacheSet(CACHE_KEY, result);
  return result;
}

async function loadFiltersFromMongo() {
  const db = await getDB();

  // Load all groups sorted by rank
  const groups = await db.collection('filter_groups').find({}).toArray();
  groups.sort((a, b) => a.rank - b.rank);

  for (const group of groups) {
    // Load filters for this group sorted by rank
    const filters = await db.collection('filters').find({ group_id: group._id }).toArray();
    filters.sort((a, b) => a.rank - b.rank);

    for (const filter of filters) {
      // Load options for this filter sorted by rank
      const options = await db.collection('filter_options').find({ filter_id: filter._id }).toArray();
      options.sort((a, b) => a.rank - b.rank);

      if (filter.type === 'nested_multiselect') {
        filter.options = buildNestedOptions(options);
      } else {
        filter.options = options;
      }
    }
    group.filters = filters;
  }

  return groups;
}

/**
 * POST /api/filters/groups
 */
async function createFilterGroup(groupData) {
  const db = await getDB();
  groupData.created_at = new Date();
  await db.collection('filter_groups').insertOne(groupData);
  cacheDelete(CACHE_KEY);
  return groupData;
}

/**
 * GET /api/filters/groups
 */
async function getFilterGroups() {
  const db = await getDB();
  const groups = await db.collection('filter_groups').find({}).toArray();
  groups.sort((a, b) => a.rank - b.rank);
  return groups;
}

/**
 * PUT /api/filters/groups/:id
 */
async function updateFilterGroup(id, groupData) {
  const db = await getDB();
  await db.collection('filter_groups').updateOne(
    { _id: id },
    { $set: {
      title: groupData.title,
      rank: groupData.rank,
      collapsed_by_default: groupData.collapsed_by_default,
      visible: groupData.visible,
      icon: groupData.icon,
    }}
  );
  cacheDelete(CACHE_KEY);
  return { ...groupData, _id: id };
}

/**
 * DELETE /api/filters/groups/:id
 */
async function deleteFilterGroup(id) {
  const db = await getDB();
  await db.collection('filter_groups').deleteOne({ _id: id });
  cacheDelete(CACHE_KEY);
}

module.exports = { getFilters, createFilterGroup, getFilterGroups, updateFilterGroup, deleteFilterGroup };
