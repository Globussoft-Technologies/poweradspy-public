'use strict';

const { getDB } = require('../db');

// Simple in-memory cache for UI config
const uiCache = new Map();
const UI_CACHE_KEY = 'ui_config_main';

function processHeaderElement(config, element) {
  const header = config.header;
  switch (element.component) {
    case 'search_dropdown':
      header.search_types.push({
        id: element._id,
        label: element.label_ui,
        unique_identifier: element.unique_identifier,
        api_field: element.query_value,
        meta: element.meta,
        meta_type: element.meta_type,
      });
      break;
    case 'platform_button':
      header.platforms.push({
        id: element._id,
        label: element.label_ui,
        unique_identifier: element.unique_identifier,
        selected_by_default: element.selected_by_default,
        meta: element.meta,
        meta_type: element.meta_type,
      });
      break;
    case 'sort_option':
      header.sorting.push({
        id: element._id,
        label: element.label_ui,
        unique_identifier: element.unique_identifier,
        default: element.default,
        query_sort: element.query_sort,
      });
      break;
    case 'feature_button':
      header.features.push({
        id: element._id,
        label: element.label_ui,
        unique_identifier: element.unique_identifier,
        route: element.route,
        meta: element.meta,
        meta_type: element.meta_type,
      });
      break;
    case 'search_config':
      header.search_config = {
        placeholder: element.placeholder,
        min_length: element.min_length,
        max_length: element.max_length,
        debounce_ms: element.debounce_ms,
        autosuggest: element.autosuggest,
      };
      break;
    case 'brand_logo':
      header.brand = {
        name: element.label_ui,
        logo_svg: element.meta,
        logo_type: element.meta_type,
      };
      break;
  }
}

function processSidebarElement(config, element) {
  const sidebar = config.sidebar_filters;
  switch (element.component) {
    case 'filter_group':
      sidebar.push({
        id: element._id,
        label: element.label_ui,
        unique_identifier: element.unique_identifier,
        collapsed_by_default: element.collapsed_by_default,
        filters: [],
      });
      break;
    case 'filter_option': {
      const group = sidebar.find(g => g.unique_identifier === element.group_identifier);
      if (group) {
        group.filters.push({
          id: element._id,
          label: element.label_ui,
          unique_identifier: element.unique_identifier,
          query_value: element.query_value,
        });
      }
      break;
    }
  }
}

async function loadUIFromMongo() {
  const db = await getDB();
  const elements = await db.collection('ui_elements').find({ enabled: true }).toArray();

  // Sort by section then rank
  elements.sort((a, b) => {
    if (a.section !== b.section) return a.section < b.section ? -1 : 1;
    return a.rank - b.rank;
  });

  const config = {
    header: { search_types: [], platforms: [], sorting: [], features: [] },
    sidebar_filters: [],
  };

  for (const element of elements) {
    if (element.section === 'header') processHeaderElement(config, element);
    else if (element.section === 'sidebar_filters') processSidebarElement(config, element);
  }

  return config;
}

/**
 * GET /api/ui/config
 */
async function getUIConfiguration() {
  const cached = uiCache.get(UI_CACHE_KEY);
  if (cached) return cached;
  const config = await loadUIFromMongo();
  uiCache.set(UI_CACHE_KEY, config);
  return config;
}

module.exports = { getUIConfiguration };
