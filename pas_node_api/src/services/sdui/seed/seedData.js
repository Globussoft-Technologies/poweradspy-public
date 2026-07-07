'use strict';

// ── SVG stubs ────────────────────────────────────────────────────────────────
const svgSearch = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
const svgGrid = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`;
const svgCalendar = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
const svgSort = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="9" y2="18"/></svg>`;
const svgAdType = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><polyline points="8 21 12 17 16 21"/></svg>`;

const CREATED_AT = '2026-03-13T11:33:18.71Z';

// ── SEARCHBAR ─────────────────────────────────────────────────────────────────

function buildSearchbar() {
  return [
    {
      _id: 'search_input',
      config_type: 'searchbar',
      title: 'SEARCH INPUT',
      rank: 1,
      collapsed_by_default: false,
      visible: true,
      icon: { type: 'svg', value: svgSearch },
      meta: 'Primary search input for keywords, advertisers, or domains.',
      display_mode: 'input',
      created_at: CREATED_AT,
      flag: true,
      filters: [{
        _id: 'search_input_config',
        group_id: 'search_input',
        label: 'Search Input',
        type: 'autocomplete',
        rank: 1,
        query_param: 'q',
        multi_select: false,
        visible: true,
        platform_applicability: 'all',
        placeholder: 'Search keyword, advertiser, or domain...',
        min_length: 2,
        max_length: 120,
        debounce_ms: 300,
        autosuggest: true,
        suggestion_sources: [
          {
            id: 'word_suggest',
            rank: 1,
            label: 'Word Suggestions',
            method: 'GET',
            endpoint: '/suggest',
            env_key: 'VITE_SUGGEST_API_BASE_URL',
            query_params: { query: 'lastWord', limit: 5, list: 'google', fuzzy: false },
            query_param_config: [
              { name: 'query', type: 'string', required: true, default: 'lastWord', label: 'Search Query', hint: 'The search term — auto-filled from user input' },
              { name: 'limit', type: 'number', required: true, default: 5, label: 'Result Limit', hint: 'Max number of suggestions returned' },
              { name: 'list', type: 'string', required: true, default: 'google', label: 'Suggestion List', hint: 'Which suggestion source list to use (e.g. google)' },
              { name: 'fuzzy', type: 'boolean', required: false, default: false, label: 'Fuzzy Match', hint: 'Enable fuzzy/approximate matching' },
            ],
            response_key: 'suggestions',
            display_field: 'word',
            min_chars_to_trigger: 3,
            on_select_action: 'replacePartialWord',
          },
          {
            id: 'category_suggest',
            rank: 2,
            label: 'Category Suggestions',
            method: 'POST',
            endpoint: '/search',
            env_key: 'VITE_CAT_SEARCH_API_BASE_URL',
            request_body: { query: 'string', top_k: 5 },
            response_key: 'matches',
            display_field: "major_category + ' > ' + sub_category",
            min_chars_to_trigger: 3,
            on_select_action: 'setSelCategories',
          },
        ],
        search_variants: [
          { rank: 1, id: 'basic_shortcut', label: 'Basic + Keyboard Shortcut', trigger_mechanism: 'Keyboard: Ctrl+K', key_ui_elements: '⌘K badge on right of input; clear (×) button appears once text entered' },
          { rank: 2, id: 'filter_chips', label: 'Filter Chips', trigger_mechanism: 'Chips below bar toggled by user', key_ui_elements: 'Removable chip pills showing active filters under the input' },
          { rank: 3, id: 'autocomplete_dropdown', label: 'Autocomplete Dropdown', trigger_mechanism: '3+ chars typed', key_ui_elements: 'Dropdown split into Suggestions section and Recent History section' },
          { rank: 4, id: 'scoped_search', label: 'Scoped / Contextual Search', trigger_mechanism: 'Click caret badge', key_ui_elements: "Scope badge on left of input (e.g. 'in: Design'); click caret to cycle scopes" },
          { rank: 5, id: 'voice_input', label: 'Voice Input', trigger_mechanism: 'Click mic icon', key_ui_elements: 'Mic icon on right; click simulates transcription state' },
          { rank: 6, id: 'loading_state', label: 'Loading State', trigger_mechanism: 'Async fetch in flight', key_ui_elements: 'Spinner replaces clear button while results are fetching' },
          { rank: 7, id: 'rich_results', label: 'Rich Result Rows', trigger_mechanism: 'Results returned', key_ui_elements: 'Each row: thumbnail icon + highlighted match text + path + type badge' },
          { rank: 8, id: 'boolean_search', label: 'Boolean / Advanced', trigger_mechanism: 'AND / OR / NOT buttons', key_ui_elements: 'Operator buttons below input + field selector dropdown (type, author, etc.)' },
          { rank: 9, id: 'command_palette', label: 'Command Palette', trigger_mechanism: '⌘/ shortcut', key_ui_elements: 'Fuzzy match list with keyboard shortcut hints per item on the right' },
        ],
      }],
    },
    {
      _id: 'search_type',
      config_type: 'searchbar',
      title: 'SEARCH TYPE',
      rank: 2,
      collapsed_by_default: false,
      visible: true,
      icon: { type: 'none', value: null },
      meta: 'Scopes the search to keyword, advertiser, domain, or precise match.',
      display_mode: 'tab_toggle',
      created_at: CREATED_AT,
      flag: true,
      filters: [{
        _id: 'search_type_selector',
        group_id: 'search_type',
        label: 'Search Type',
        type: 'radio',
        rank: 1,
        query_param: 'searchType',
        multi_select: false,
        visible: true,
        platform_applicability: 'all',
        options: [
          { _id: 'st_keyword', filter_id: 'search_type_selector', label: 'Keyword', value: 'keyword', rank: 1, selected_by_default: true },
          { _id: 'st_advertiser', filter_id: 'search_type_selector', label: 'Advertiser', value: 'advertiser', rank: 2, selected_by_default: false },
          { _id: 'st_domain', filter_id: 'search_type_selector', label: 'Domain Search', value: 'domain', rank: 3, selected_by_default: false },
          { _id: 'st_precise', filter_id: 'search_type_selector', label: 'Precise Search', value: 'precise', rank: 4, selected_by_default: false },
        ],
      }],
    },
  ];
}

// ── NAVBAR ────────────────────────────────────────────────────────────────────

function buildNavbar() {
  const pfm = {
    facebook: ['category','category_new','engagement','cta','ad_type','ad_position','language','gender','age','meta_ads_lib','verified','country','state','city','ecommerce_platform','funnel','marketing_platform','source','affiliate_network','search_by_image'],
    instagram: ['category','category_new','engagement','cta','ad_type','language','verified','country','state','city','ecommerce_platform','funnel','marketing_platform','source','affiliate_network','search_by_image'],
    youtube: ['category','category_new','engagement','cta','ad_type','ad_position','language','verified','country','state','city','ecommerce_platform','funnel','marketing_platform','source','affiliate_network','search_by_image','views_range'],
    google: ['category','category_new','ad_type','ad_position','language','country','state','city','ecommerce_platform','funnel','marketing_platform','source','affiliate_network','search_by_image'],
    gdn: ['category','category_new','language','image_size','country','state','city','ecommerce_platform','funnel','marketing_platform','source','affiliate_network','search_by_image'],
    native: ['category','category_new','ad_type','native_network','language','country','state','city','ecommerce_platform','funnel','marketing_platform','source','affiliate_network','search_by_image'],
    linkedin: ['category','category_new','engagement','cta','ad_type','language','verified','country','state','city','ecommerce_platform','funnel','marketing_platform','source','affiliate_network','search_by_image'],
    reddit: ['category','category_new','engagement','cta','ad_type','language','country','state','city','ecommerce_platform','funnel','marketing_platform','source','affiliate_network','search_by_image'],
    quora: ['category','category_new','cta','ad_type','language','country','state','city','ecommerce_platform','funnel','marketing_platform','source','affiliate_network','search_by_image'],
    pinterest: ['category','category_new','ad_type','language','country','state','city','ecommerce_platform','funnel','marketing_platform','affiliate_network','search_by_image'],
    tiktok: ['category','category_new','engagement','cta','ad_type','language','country','state','city','ecommerce_platform','funnel','marketing_platform','source','affiliate_network','search_by_image'],
  };

  return [
    // 1. Platforms
    {
      _id: 'platforms',
      config_type: 'navbar',
      title: 'PLATFORMS',
      rank: 1,
      collapsed_by_default: false,
      visible: true,
      icon: { type: 'svg', value: svgGrid },
      meta: 'Select which ad platforms to include in results. All platforms selected by default.',
      display_mode: 'icon_pill',
      created_at: CREATED_AT,
      flag: true,
      filters: [{
        _id: 'platform_selector',
        group_id: 'platforms',
        label: 'Platforms',
        type: 'icon_toggle',
        rank: 1,
        query_param: 'platforms',
        multi_select: true,
        visible: true,
        platform_applicability: 'all',
        platform_filter_matrix: pfm,
        options: [
          { _id: 'fb', filter_id: 'platform_selector', label: 'FB', value: 'facebook', rank: 1, selected_by_default: true, icon_url: 'https://img.icons8.com/?size=100&id=uLWV5A9vXIPu&format=png', icon_type: 'url' },
          { _id: 'ig', filter_id: 'platform_selector', label: 'IG', value: 'instagram', rank: 2, selected_by_default: true, icon_url: 'https://img.icons8.com/?size=100&id=32323&format=png', icon_type: 'url' },
          { _id: 'yt', filter_id: 'platform_selector', label: 'YT', value: 'youtube', rank: 3, selected_by_default: true, icon_url: 'https://img.icons8.com/?size=100&id=19318&format=png', icon_type: 'url' },
          { _id: 'ggl', filter_id: 'platform_selector', label: 'GGL', value: 'google', rank: 4, selected_by_default: true, icon_url: 'https://img.icons8.com/?size=100&id=17949&format=png', icon_type: 'url' },
          { _id: 'gdn', filter_id: 'platform_selector', label: 'GDN', value: 'gdn', rank: 5, selected_by_default: true, icon_url: 'https://img.icons8.com/?size=100&id=60984&format=png', icon_type: 'url' },
          { _id: 'ntv', filter_id: 'platform_selector', label: 'NTV', value: 'native', rank: 6, selected_by_default: true, icon_url: 'https://img.icons8.com/?size=100&id=82757&format=png', icon_type: 'url' },
          { _id: 'li', filter_id: 'platform_selector', label: 'IN', value: 'linkedin', rank: 7, selected_by_default: true, icon_url: 'https://img.icons8.com/?size=100&id=13930&format=png', icon_type: 'url' },
          { _id: 'rd', filter_id: 'platform_selector', label: 'RD', value: 'reddit', rank: 8, selected_by_default: true, icon_url: 'https://img.icons8.com/?size=100&id=12195&format=png', icon_type: 'url' },
          { _id: 'qr', filter_id: 'platform_selector', label: 'QR', value: 'quora', rank: 9, selected_by_default: true, icon_url: 'https://img.icons8.com/?size=100&id=10903&format=png', icon_type: 'url' },
          { _id: 'pt', filter_id: 'platform_selector', label: 'PT', value: 'pinterest', rank: 10, selected_by_default: true, icon_url: 'https://img.icons8.com/?size=100&id=12244&format=png', icon_type: 'url' },
          { _id: 'tt', filter_id: 'platform_selector', label: 'TT', value: 'tiktok', rank: 11, selected_by_default: true, icon_url: 'https://img.icons8.com/?size=100&id=118640&format=png', icon_type: 'url' },
        ],
      }],
    },
    // 2. Date Filter
    {
      _id: 'date_filter',
      config_type: 'navbar',
      title: 'DATE',
      rank: 2,
      collapsed_by_default: false,
      visible: true,
      icon: { type: 'svg', value: svgCalendar },
      meta: 'Filter ads by when they were first seen or last active. Choose a preset range or set a custom window.',
      display_mode: 'dropdown',
      created_at: CREATED_AT,
      flag: true,
      filters: [
        {
          _id: 'date_preset',
          group_id: 'date_filter',
          label: 'Date Preset',
          type: 'date_preset',
          rank: 1,
          query_param: 'datePreset',
          multi_select: false,
          visible: true,
          platform_applicability: 'all',
          options: [
            { _id: 'dp_all_time', filter_id: 'date_preset', label: 'All Time', value: 'all_time', rank: 1, selected_by_default: true },
            { _id: 'dp_today', filter_id: 'date_preset', label: 'Today', value: 'today', rank: 2, selected_by_default: false },
            { _id: 'dp_yesterday', filter_id: 'date_preset', label: 'Yesterday', value: 'yesterday', rank: 3, selected_by_default: false },
            { _id: 'dp_last_7', filter_id: 'date_preset', label: 'Last 7 Days', value: 'last_7_days', rank: 4, selected_by_default: false },
            { _id: 'dp_last_14', filter_id: 'date_preset', label: 'Last 14 Days', value: 'last_14_days', rank: 5, selected_by_default: false },
            { _id: 'dp_last_30', filter_id: 'date_preset', label: 'Last 30 Days', value: 'last_30_days', rank: 6, selected_by_default: false },
            { _id: 'dp_last_90', filter_id: 'date_preset', label: 'Last 90 Days', value: 'last_90_days', rank: 7, selected_by_default: false },
            { _id: 'dp_this_month', filter_id: 'date_preset', label: 'This Month', value: 'this_month', rank: 8, selected_by_default: false },
            { _id: 'dp_last_month', filter_id: 'date_preset', label: 'Last Month', value: 'last_month', rank: 9, selected_by_default: false },
            { _id: 'dp_this_year', filter_id: 'date_preset', label: 'This Year', value: 'this_year', rank: 10, selected_by_default: false },
          ],
        },
        {
          _id: 'date_range_custom',
          group_id: 'date_filter',
          label: 'Custom Date Range',
          type: 'date_range_custom',
          rank: 2,
          query_param: 'dateRange',
          multi_select: false,
          visible: true,
          platform_applicability: 'all',
          min_field: 'startDate',
          max_field: 'endDate',
          default_mode: 'current_date',
          format: 'YYYY-MM-DD',
        },
      ],
    },
    // 3. Sorting
    {
      _id: 'sorting',
      config_type: 'navbar',
      title: 'SORT BY',
      rank: 3,
      collapsed_by_default: false,
      visible: true,
      icon: { type: 'svg', value: svgSort },
      meta: 'Choose the field to sort results by, and whether to show highest or lowest values first.',
      display_mode: 'dropdown',
      created_at: CREATED_AT,
      flag: true,
      filters: [
        {
          _id: 'sort_by',
          group_id: 'sorting',
          label: 'Sort By',
          type: 'radio',
          rank: 1,
          query_param: 'sortBy',
          multi_select: false,
          visible: true,
          platform_applicability: 'all',
          options: [
            { _id: 'sb_newest', filter_id: 'sort_by', label: 'Newest', value: '-created_at', rank: 1, selected_by_default: true },
            { _id: 'sb_last_seen', filter_id: 'sort_by', label: 'Last Seen', value: '-last_seen_at', rank: 2, selected_by_default: false },
            { _id: 'sb_impressions', filter_id: 'sort_by', label: 'Impressions', value: '-impressions', rank: 3, selected_by_default: false },
            { _id: 'sb_popularity', filter_id: 'sort_by', label: 'Popularity', value: '-popularity_score', rank: 4, selected_by_default: false },
            { _id: 'sb_engagement', filter_id: 'sort_by', label: 'Engagement', value: '-engagement_score', rank: 5, selected_by_default: false },
            { _id: 'sb_running_days', filter_id: 'sort_by', label: 'Ad Running Days', value: '-running_days', rank: 6, selected_by_default: false },
            { _id: 'sb_domain_reg', filter_id: 'sort_by', label: 'Domain Registration Date', value: '-domain_reg_date', rank: 7, selected_by_default: false },
          ],
        },
        {
          _id: 'sort_direction',
          group_id: 'sorting',
          label: 'Sort Direction',
          type: 'segmented_control',
          rank: 2,
          query_param: 'sortDir',
          multi_select: false,
          visible: true,
          platform_applicability: 'all',
          options: [
            { _id: 'sd_desc', filter_id: 'sort_direction', label: 'Descending', value: 'desc', rank: 1, selected_by_default: true },
            { _id: 'sd_asc', filter_id: 'sort_direction', label: 'Ascending', value: 'asc', rank: 2, selected_by_default: false },
          ],
        },
      ],
    },
    // 4. Ad Type (navbar)
    {
      _id: 'ad_type',
      config_type: 'navbar',
      title: 'AD TYPE',
      rank: 4,
      collapsed_by_default: false,
      visible: true,
      icon: { type: 'svg', value: svgAdType },
      meta: 'Filter by ad creative format. Available options change based on selected platform.',
      display_mode: 'dropdown',
      created_at: CREATED_AT,
      flag: true,
      filters: [{
        _id: 'ad_types',
        group_id: 'ad_type',
        label: 'Ad Types',
        type: 'checkbox',
        rank: 1,
        query_param: 'adTypes',
        multi_select: true,
        visible: true,
        platform_applicability: 'all',
        options: [
          { _id: 'at_image', filter_id: 'ad_types', label: 'Image', value: 'Image', rank: 1, selected_by_default: false, platform_applicability: ['facebook','instagram','google','gdn','native','linkedin','reddit','quora','pinterest','tiktok'] },
          { _id: 'at_video', filter_id: 'ad_types', label: 'Video', value: 'Video', rank: 2, selected_by_default: false, platform_applicability: ['facebook','instagram','youtube','native','linkedin','reddit','pinterest','tiktok'] },
          { _id: 'at_carousel', filter_id: 'ad_types', label: 'Carousel', value: 'Carousel', rank: 3, selected_by_default: false, platform_applicability: ['facebook','instagram','linkedin'] },
          { _id: 'at_story', filter_id: 'ad_types', label: 'Story', value: 'Story', rank: 4, selected_by_default: false, platform_applicability: ['facebook','instagram'] },
          { _id: 'at_reel', filter_id: 'ad_types', label: 'Reel', value: 'Reel', rank: 5, selected_by_default: false, platform_applicability: ['facebook','instagram'] },
          { _id: 'at_text', filter_id: 'ad_types', label: 'Text', value: 'Text', rank: 6, selected_by_default: false, platform_applicability: ['google','native','reddit','quora'] },
          { _id: 'at_native_ad', filter_id: 'ad_types', label: 'Native Ad', value: 'NativeAd', rank: 7, selected_by_default: false, platform_applicability: ['native'] },
        ],
      }],
    },
  ];
}

// ── SIDEBAR ───────────────────────────────────────────────────────────────────

function buildSidebar() {
  return [
    // 1. Category (nested_select)
    // Options start empty — populated dynamically via POST /internal/category/sync
    // which is triggered by GDN existQuery after every write to the master
    // `category` ES index. The seeder preserves existing options on re-seed.
    (() => {
      return {
        _id: 'category', config_type: 'sidebar', title: 'CATEGORY', rank: 1,
        collapsed_by_default: false, visible: true,
        icon: { type: 'none', value: null },
        meta: 'Filter ads by product or service category. Supports two-level nested selection.',
        display_mode: 'accordion', created_at: CREATED_AT, flag: true,
        filters: [{ _id: 'categories', group_id: 'category', label: 'Categories', type: 'nested_select', rank: 1, query_param: 'categories', multi_select: true, visible: true, platform_applicability: 'all', options: [] }],
      };
    })(),

    // 2. Engagement (range sliders)
    (() => {
      const sliders = [
        { id: 'likes_range', label: 'Likes', qp: 'likes', min: 0, max: 10000000, step: 1000, unit: null, loose_ends: 'right', slider_scale: 'exponential', pin_mode: 'double', platforms: ['facebook','instagram','youtube','linkedin','reddit'] },
        { id: 'shares_range', label: 'Shares', qp: 'shares', min: 0, max: 1000000, step: 500, unit: null, loose_ends: 'right', slider_scale: 'exponential', pin_mode: 'double', platforms: ['facebook'] },
        { id: 'comments_range', label: 'Comments', qp: 'comments', min: 0, max: 1000000, step: 500, unit: null, loose_ends: 'right', slider_scale: 'exponential', pin_mode: 'double', platforms: ['facebook','instagram','youtube','linkedin','reddit'] },
        { id: 'impressions_range', label: 'Impressions', qp: 'impressions', min: 0, max: 100000000, step: 10000, unit: null, loose_ends: 'right', slider_scale: 'exponential', pin_mode: 'double', platforms: ['facebook','instagram','linkedin'] },
        { id: 'popularity_score', label: 'Popularity Score', qp: 'popularity', min: 0, max: 100, step: 1, unit: null, loose_ends: 'none', slider_scale: 'linear', pin_mode: 'single', platforms: ['facebook','instagram','linkedin'] },
        { id: 'avg_ad_budget', label: 'Avg. Ad Budget', qp: 'avgBudget', min: 0, max: 100000, step: 100, unit: 'USD', loose_ends: 'right', slider_scale: 'exponential', pin_mode: 'double', platforms: ['facebook','instagram'] },
      ];
      const filters = sliders.map((s, i) => ({
        _id: s.id, group_id: 'engagement', label: s.label, type: 'range_slider',
        rank: i + 1, query_param: s.qp, multi_select: false, visible: true,
        platform_applicability: s.platforms,
        min: s.min, max: s.max, step: s.step, default_min: s.min, default_max: s.max,
        unit: s.unit, loose_ends: s.loose_ends, slider_scale: s.slider_scale, pin_mode: s.pin_mode,
      }));
      return { _id: 'engagement', config_type: 'sidebar', title: 'ENGAGEMENT', rank: 2, collapsed_by_default: false, visible: true, icon: { type: 'none', value: null }, meta: 'Filter ads by engagement metrics: likes, shares, comments, impressions, popularity, and budget.', display_mode: 'accordion', created_at: CREATED_AT, flag: true, filters };
    })(),

    // 3. CTA
    (() => {
      const ctas = [
        { id: 'cta_shop_now', label: 'Shop Now', value: 'shop_now' }, { id: 'cta_learn_more', label: 'Learn More', value: 'learn_more' },
        { id: 'cta_sign_up', label: 'Sign Up', value: 'sign_up' }, { id: 'cta_download', label: 'Download', value: 'download' },
        { id: 'cta_get_quote', label: 'Get Quote', value: 'get_quote' }, { id: 'cta_book_now', label: 'Book Now', value: 'book_now' },
        { id: 'cta_contact_us', label: 'Contact Us', value: 'contact_us' }, { id: 'cta_watch_more', label: 'Watch More', value: 'watch_more' },
        { id: 'cta_apply_now', label: 'Apply Now', value: 'apply_now' }, { id: 'cta_subscribe', label: 'Subscribe', value: 'subscribe' },
        { id: 'cta_install_now', label: 'Install Now', value: 'install_now' }, { id: 'cta_get_offer', label: 'Get Offer', value: 'get_offer' },
        { id: 'cta_send_message', label: 'Send Message', value: 'send_message' }, { id: 'cta_donate_now', label: 'Donate Now', value: 'donate_now' },
        { id: 'cta_register', label: 'Register', value: 'register' }, { id: 'cta_order_now', label: 'Order Now', value: 'order_now' },
      ];
      return { _id: 'cta', config_type: 'sidebar', title: 'CALL TO ACTION', rank: 3, collapsed_by_default: false, visible: true, icon: { type: 'none', value: null }, meta: 'Filter ads by call-to-action button text.', display_mode: 'accordion', created_at: CREATED_AT, flag: true, filters: [{ _id: 'cta_filter', group_id: 'cta', label: 'Call to Action', type: 'chip_multi_select', rank: 1, query_param: 'cta', multi_select: true, visible: true, platform_applicability: ['facebook','instagram','youtube','linkedin','reddit','quora'], options: ctas.map((o, i) => ({ _id: o.id, filter_id: 'cta_filter', label: o.label, value: o.value, rank: i + 1, selected_by_default: false })) }] };
    })(),

    // 4. Language
    (() => {
      const langs = [
        { id: 'lang_en', label: 'English', value: 'en' }, { id: 'lang_es', label: 'Spanish', value: 'es' },
        { id: 'lang_fr', label: 'French', value: 'fr' }, { id: 'lang_de', label: 'German', value: 'de' },
        { id: 'lang_pt', label: 'Portuguese', value: 'pt' }, { id: 'lang_hi', label: 'Hindi', value: 'hi' },
        { id: 'lang_ar', label: 'Arabic', value: 'ar' }, { id: 'lang_zh_cn', label: 'Chinese (Simplified)', value: 'zh-CN' },
        { id: 'lang_zh_tw', label: 'Chinese (Traditional)', value: 'zh-TW' }, { id: 'lang_ja', label: 'Japanese', value: 'ja' },
        { id: 'lang_id', label: 'Indonesian', value: 'id' }, { id: 'lang_ms', label: 'Malay', value: 'ms' },
        { id: 'lang_ko', label: 'Korean', value: 'ko' }, { id: 'lang_ru', label: 'Russian', value: 'ru' },
        { id: 'lang_it', label: 'Italian', value: 'it' }, { id: 'lang_nl', label: 'Dutch', value: 'nl' },
        { id: 'lang_tr', label: 'Turkish', value: 'tr' }, { id: 'lang_pl', label: 'Polish', value: 'pl' },
        { id: 'lang_sv', label: 'Swedish', value: 'sv' }, { id: 'lang_no', label: 'Norwegian', value: 'no' },
        { id: 'lang_da', label: 'Danish', value: 'da' }, { id: 'lang_th', label: 'Thai', value: 'th' },
        { id: 'lang_vi', label: 'Vietnamese', value: 'vi' }, { id: 'lang_fi', label: 'Finnish', value: 'fi' },
      ];
      return { _id: 'language', config_type: 'sidebar', title: 'LANGUAGE', rank: 4, collapsed_by_default: false, visible: true, icon: { type: 'none', value: null }, meta: 'Filter ads by the language they are written in.', display_mode: 'accordion', created_at: CREATED_AT, flag: true, filters: [{ _id: 'language_filter', group_id: 'language', label: 'Language', type: 'combobox', rank: 1, query_param: 'language', multi_select: true, visible: true, platform_applicability: ['facebook','instagram','youtube','gdn','native','linkedin','reddit','quora','pinterest','google'], options: langs.map((l, i) => ({ _id: l.id, filter_id: 'language_filter', label: l.label, value: l.value, rank: i + 1, selected_by_default: false })) }] };
    })(),

    // 5. Gender
    { _id: 'gender', config_type: 'sidebar', title: 'GENDER', rank: 5, collapsed_by_default: false, visible: true, icon: { type: 'none', value: null }, meta: 'Filter Facebook ads by target gender.', display_mode: 'accordion', created_at: CREATED_AT, flag: true, filters: [{ _id: 'gender_filter', group_id: 'gender', label: 'Gender', type: 'radio', rank: 1, query_param: 'gender', multi_select: false, visible: true, platform_applicability: ['facebook'], options: [{ _id: 'g_all', filter_id: 'gender_filter', label: 'All', value: 'all', rank: 1, selected_by_default: true }, { _id: 'g_male', filter_id: 'gender_filter', label: 'Male', value: 'male', rank: 2, selected_by_default: false }, { _id: 'g_female', filter_id: 'gender_filter', label: 'Female', value: 'female', rank: 3, selected_by_default: false }] }] },

    // 6. Age
    (() => {
      const ages = [{ id: 'age_13_17', label: '13–17', value: '13-17' }, { id: 'age_18_24', label: '18–24', value: '18-24' }, { id: 'age_25_34', label: '25–34', value: '25-34' }, { id: 'age_35_44', label: '35–44', value: '35-44' }, { id: 'age_45_54', label: '45–54', value: '45-54' }, { id: 'age_55_64', label: '55–64', value: '55-64' }, { id: 'age_65_plus', label: '65+', value: '65+' }];
      return { _id: 'age', config_type: 'sidebar', title: 'AGE', rank: 6, collapsed_by_default: false, visible: true, icon: { type: 'none', value: null }, meta: 'Filter Facebook ads by target age range.', display_mode: 'accordion', created_at: CREATED_AT, flag: true, filters: [{ _id: 'age_filter', group_id: 'age', label: 'Age Range', type: 'chip_multi_select', rank: 1, query_param: 'ageRange', multi_select: true, visible: true, platform_applicability: ['facebook'], options: ages.map((a, i) => ({ _id: a.id, filter_id: 'age_filter', label: a.label, value: a.value, rank: i + 1, selected_by_default: false })) }] };
    })(),

    // 7. Meta Ads Library
    { _id: 'meta_ads_lib', config_type: 'sidebar', title: 'META ADS LIB', rank: 7, collapsed_by_default: false, visible: true, icon: { type: 'none', value: null }, meta: 'Show only ads that appear in the Meta Ads Library.', display_mode: 'accordion', created_at: CREATED_AT, flag: true, filters: [{ _id: 'meta_ads_lib_filter', group_id: 'meta_ads_lib', label: 'Meta Ads Library', type: 'toggle_switch', rank: 1, query_param: 'metaAdsLib', multi_select: false, visible: true, platform_applicability: ['facebook'] }] },

    // 8. Verified
    { _id: 'verified', config_type: 'sidebar', title: 'VERIFIED', rank: 8, collapsed_by_default: false, visible: true, icon: { type: 'none', value: null }, meta: 'Show only ads from verified accounts.', display_mode: 'accordion', created_at: CREATED_AT, flag: true, filters: [{ _id: 'verified_filter', group_id: 'verified', label: 'Verified Only', type: 'toggle_switch', rank: 1, query_param: 'verifiedOnly', multi_select: false, visible: true, platform_applicability: ['facebook','instagram','youtube','linkedin'] }] },

    // 9. Country
    (() => {
      const countries = [
        { id: 'ctry_us', label: 'United States', value: 'US' }, { id: 'ctry_gb', label: 'United Kingdom', value: 'GB' },
        { id: 'ctry_ca', label: 'Canada', value: 'CA' }, { id: 'ctry_au', label: 'Australia', value: 'AU' },
        { id: 'ctry_in', label: 'India', value: 'IN' }, { id: 'ctry_de', label: 'Germany', value: 'DE' },
        { id: 'ctry_fr', label: 'France', value: 'FR' }, { id: 'ctry_br', label: 'Brazil', value: 'BR' },
        { id: 'ctry_sg', label: 'Singapore', value: 'SG' }, { id: 'ctry_ae', label: 'UAE', value: 'AE' },
        { id: 'ctry_jp', label: 'Japan', value: 'JP' }, { id: 'ctry_cn', label: 'China', value: 'CN' },
        { id: 'ctry_id', label: 'Indonesia', value: 'ID' }, { id: 'ctry_my', label: 'Malaysia', value: 'MY' },
        { id: 'ctry_it', label: 'Italy', value: 'IT' }, { id: 'ctry_kr', label: 'South Korea', value: 'KR' },
        { id: 'ctry_se', label: 'Sweden', value: 'SE' }, { id: 'ctry_no', label: 'Norway', value: 'NO' },
        { id: 'ctry_dk', label: 'Denmark', value: 'DK' }, { id: 'ctry_pl', label: 'Poland', value: 'PL' },
        { id: 'ctry_tr', label: 'Turkey', value: 'TR' }, { id: 'ctry_za', label: 'South Africa', value: 'ZA' },
        { id: 'ctry_ng', label: 'Nigeria', value: 'NG' }, { id: 'ctry_il', label: 'Israel', value: 'IL' },
        { id: 'ctry_sa', label: 'Saudi Arabia', value: 'SA' }, { id: 'ctry_ar', label: 'Argentina', value: 'AR' },
        { id: 'ctry_mx', label: 'Mexico', value: 'MX' }, { id: 'ctry_ph', label: 'Philippines', value: 'PH' },
        { id: 'ctry_th', label: 'Thailand', value: 'TH' }, { id: 'ctry_vn', label: 'Vietnam', value: 'VN' },
      ];
      return { _id: 'country', config_type: 'sidebar', title: 'COUNTRY', rank: 9, collapsed_by_default: false, visible: true, icon: { type: 'none', value: null }, meta: 'Filter ads by the country they are targeted to.', display_mode: 'accordion', created_at: CREATED_AT, flag: true, filters: [{ _id: 'country_filter', group_id: 'country', label: 'Country', type: 'combobox', rank: 1, query_param: 'countries', multi_select: true, visible: true, platform_applicability: 'all', options: countries.map((c, i) => ({ _id: c.id, filter_id: 'country_filter', label: c.label, value: c.value, rank: i + 1, selected_by_default: false })) }] };
    })(),

    // 10. State
    { _id: 'state', config_type: 'sidebar', title: 'STATE', rank: 10, collapsed_by_default: false, visible: true, icon: { type: 'none', value: null }, meta: 'Filter ads by state/province. Options are dynamically fetched based on selected country.', display_mode: 'accordion', created_at: CREATED_AT, flag: true, filters: [{ _id: 'state_filter', group_id: 'state', label: 'State', type: 'combobox', rank: 1, query_param: 'states', multi_select: true, visible: true, platform_applicability: 'all', depends_on: 'countries' }] },

    // 11. City
    { _id: 'city', config_type: 'sidebar', title: 'CITY', rank: 11, collapsed_by_default: false, visible: true, icon: { type: 'none', value: null }, meta: 'Filter ads by city. Options are dynamically fetched based on selected state.', display_mode: 'accordion', created_at: CREATED_AT, flag: true, filters: [{ _id: 'city_filter', group_id: 'city', label: 'City', type: 'combobox', rank: 1, query_param: 'cities', multi_select: true, visible: true, platform_applicability: 'all', depends_on: 'states' }] },

    // 12. Ecommerce Platform
    (() => {
      const eps = [{ id: 'ep_shopify', label: 'Shopify', value: 'shopify' }, { id: 'ep_woocommerce', label: 'WooCommerce', value: 'woocommerce' }, { id: 'ep_magento', label: 'Magento', value: 'magento' }, { id: 'ep_bigcommerce', label: 'BigCommerce', value: 'bigcommerce' }, { id: 'ep_wix', label: 'Wix', value: 'wix' }, { id: 'ep_squarespace', label: 'Squarespace', value: 'squarespace' }, { id: 'ep_prestashop', label: 'PrestaShop', value: 'prestashop' }, { id: 'ep_opencart', label: 'OpenCart', value: 'opencart' }, { id: 'ep_salesforce', label: 'Salesforce Commerce', value: 'salesforce_commerce' }, { id: 'ep_custom', label: 'Custom', value: 'custom' }];
      return { _id: 'ecommerce_platform', config_type: 'sidebar', title: 'ECOMMERCE PLATFORM', rank: 12, collapsed_by_default: false, visible: true, icon: { type: 'none', value: null }, meta: 'Filter ads by the ecommerce platform used on the landing page.', display_mode: 'accordion', created_at: CREATED_AT, flag: true, filters: [{ _id: 'ecommerce_platform_filter', group_id: 'ecommerce_platform', label: 'Ecommerce Platform', type: 'checkbox', rank: 1, query_param: 'ecommercePlatform', multi_select: true, visible: true, platform_applicability: 'all', options: eps.map((e, i) => ({ _id: e.id, filter_id: 'ecommerce_platform_filter', label: e.label, value: e.value, rank: i + 1, selected_by_default: false })) }] };
    })(),

    // 13. Funnel
    (() => {
      const funnels = [{ id: 'fn_landing_page', label: 'Landing Page', value: 'landing_page' }, { id: 'fn_sales_page', label: 'Sales Page', value: 'sales_page' }, { id: 'fn_webinar', label: 'Webinar', value: 'webinar' }, { id: 'fn_lead_gen', label: 'Lead Generation', value: 'lead_gen' }, { id: 'fn_free_trial', label: 'Free Trial', value: 'free_trial' }, { id: 'fn_product_page', label: 'Product Page', value: 'product_page' }, { id: 'fn_quiz_funnel', label: 'Quiz Funnel', value: 'quiz_funnel' }, { id: 'fn_membership', label: 'Membership', value: 'membership' }, { id: 'fn_upsell', label: 'Upsell', value: 'upsell' }, { id: 'fn_book_a_call', label: 'Book a Call', value: 'book_a_call' }];
      return { _id: 'funnel', config_type: 'sidebar', title: 'FUNNEL TYPE', rank: 13, collapsed_by_default: false, visible: true, icon: { type: 'none', value: null }, meta: 'Filter ads by the type of funnel used on the destination page.', display_mode: 'accordion', created_at: CREATED_AT, flag: true, filters: [{ _id: 'funnel_filter', group_id: 'funnel', label: 'Funnel Type', type: 'checkbox', rank: 1, query_param: 'funnelType', multi_select: true, visible: true, platform_applicability: 'all', options: funnels.map((f, i) => ({ _id: f.id, filter_id: 'funnel_filter', label: f.label, value: f.value, rank: i + 1, selected_by_default: false })) }] };
    })(),

    // 14. Marketing Platform
    (() => {
      const mps = [{ id: 'mp_clickfunnels', label: 'ClickFunnels', value: 'clickfunnels' }, { id: 'mp_kartra', label: 'Kartra', value: 'kartra' }, { id: 'mp_gohighlevel', label: 'GoHighLevel', value: 'gohighlevel' }, { id: 'mp_hubspot', label: 'HubSpot', value: 'hubspot' }, { id: 'mp_mailchimp', label: 'Mailchimp', value: 'mailchimp' }, { id: 'mp_activecampaign', label: 'ActiveCampaign', value: 'activecampaign' }, { id: 'mp_kajabi', label: 'Kajabi', value: 'kajabi' }, { id: 'mp_teachable', label: 'Teachable', value: 'teachable' }, { id: 'mp_leadpages', label: 'Leadpages', value: 'leadpages' }, { id: 'mp_unbounce', label: 'Unbounce', value: 'unbounce' }, { id: 'mp_instapage', label: 'Instapage', value: 'instapage' }, { id: 'mp_wordpress', label: 'WordPress', value: 'wordpress' }];
      return { _id: 'marketing_platform', config_type: 'sidebar', title: 'MARKETING PLATFORM', rank: 14, collapsed_by_default: false, visible: true, icon: { type: 'none', value: null }, meta: 'Filter ads by the marketing automation or page-building platform detected.', display_mode: 'accordion', created_at: CREATED_AT, flag: true, filters: [{ _id: 'marketing_platform_filter', group_id: 'marketing_platform', label: 'Marketing Platform', type: 'checkbox', rank: 1, query_param: 'marketingPlatform', multi_select: true, visible: true, platform_applicability: 'all', options: mps.map((m, i) => ({ _id: m.id, filter_id: 'marketing_platform_filter', label: m.label, value: m.value, rank: i + 1, selected_by_default: false })) }] };
    })(),

    // 15. Traffic Source
    (() => {
      const sources = [{ id: 'src_direct', label: 'Direct', value: 'direct' }, { id: 'src_organic', label: 'Organic', value: 'organic' }, { id: 'src_paid_search', label: 'Paid Search', value: 'paid_search' }, { id: 'src_referral', label: 'Referral', value: 'referral' }, { id: 'src_email', label: 'Email', value: 'email' }, { id: 'src_social', label: 'Social', value: 'social' }, { id: 'src_affiliate', label: 'Affiliate', value: 'affiliate' }];
      return { _id: 'source', config_type: 'sidebar', title: 'TRAFFIC SOURCE', rank: 15, collapsed_by_default: false, visible: true, icon: { type: 'none', value: null }, meta: 'Filter ads by the detected traffic source type.', display_mode: 'accordion', created_at: CREATED_AT, flag: true, filters: [{ _id: 'source_filter', group_id: 'source', label: 'Traffic Source', type: 'checkbox', rank: 1, query_param: 'trafficSource', multi_select: true, visible: true, platform_applicability: 'all', options: sources.map((s, i) => ({ _id: s.id, filter_id: 'source_filter', label: s.label, value: s.value, rank: i + 1, selected_by_default: false })) }] };
    })(),

    // 16. Affiliate Network
    (() => {
      const networks = [{ id: 'an_clickbank', label: 'ClickBank', value: 'clickbank' }, { id: 'an_maxbounty', label: 'MaxBounty', value: 'maxbounty' }, { id: 'an_cj', label: 'CJ Affiliate', value: 'cj_affiliate' }, { id: 'an_shareasale', label: 'ShareASale', value: 'shareasale' }, { id: 'an_rakuten', label: 'Rakuten', value: 'rakuten' }, { id: 'an_impact', label: 'Impact', value: 'impact' }, { id: 'an_flexoffers', label: 'FlexOffers', value: 'flexoffers' }, { id: 'an_jvzoo', label: 'JVZoo', value: 'jvzoo' }, { id: 'an_warriorplus', label: 'WarriorPlus', value: 'warriorplus' }, { id: 'an_digistore24', label: 'Digistore24', value: 'digistore24' }, { id: 'an_partnerstack', label: 'PartnerStack', value: 'partnerstack' }, { id: 'an_awin', label: 'Awin', value: 'awin' }];
      return { _id: 'affiliate_network', config_type: 'sidebar', title: 'AFFILIATE NETWORK', rank: 16, collapsed_by_default: false, visible: true, icon: { type: 'none', value: null }, meta: 'Filter ads by the affiliate network detected on the landing page.', display_mode: 'accordion', created_at: CREATED_AT, flag: true, filters: [{ _id: 'affiliate_network_filter', group_id: 'affiliate_network', label: 'Affiliate Network', type: 'checkbox', rank: 1, query_param: 'affiliateNetwork', multi_select: true, visible: true, platform_applicability: 'all', options: networks.map((n, i) => ({ _id: n.id, filter_id: 'affiliate_network_filter', label: n.label, value: n.value, rank: i + 1, selected_by_default: false })) }] };
    })(),

    // 17. Search by Image
    (() => {
      const imgFilters = [
        { id: 'text_in_image', label: 'Text in Image', type: 'text_input', qp: 'textInImage', placeholder: 'Search for text appearing in ad creatives...' },
        { id: 'brand_in_image', label: 'Brand in Image', type: 'autocomplete', qp: 'brandInImage', placeholder: 'Search for brand names in ad visuals...' },
        { id: 'object_in_image', label: 'Object in Image', type: 'autocomplete', qp: 'objectInImage', placeholder: 'Search for objects detected in ad images...' },
        { id: 'celebrity_in_image', label: 'Celebrity in Image', type: 'autocomplete', qp: 'celebrityInImage', placeholder: 'Search for celebrities appearing in ads...' },
      ];
      const filters = imgFilters.map((f, i) => ({ _id: f.id, group_id: 'search_by_image', label: f.label, type: f.type, rank: i + 1, query_param: f.qp, multi_select: false, visible: true, platform_applicability: 'all', placeholder: f.placeholder, min_length: 2, max_length: 120, debounce_ms: 300 }));
      return { _id: 'search_by_image', config_type: 'sidebar', title: 'SEARCH BY IMAGE', rank: 17, collapsed_by_default: false, visible: true, icon: { type: 'none', value: null }, meta: 'Search for ads containing specific text, brands, objects, or celebrities in the creative.', display_mode: 'accordion', created_at: CREATED_AT, flag: true, filters };
    })(),

    // 18. Ad Position
    (() => {
      const positions = [
        { id: 'pos_feed', label: 'Feed', value: 'FEED', platforms: ['facebook'] }, { id: 'pos_story', label: 'Story', value: 'STORY', platforms: ['facebook'] },
        { id: 'pos_marketplace', label: 'Marketplace', value: 'MARKETPLACE', platforms: ['facebook'] }, { id: 'pos_videofeed', label: 'Video Feed', value: 'VIDEOFEED', platforms: ['facebook'] },
        { id: 'pos_preroll', label: 'Pre-roll', value: 'preroll', platforms: ['youtube'] }, { id: 'pos_midroll', label: 'Mid-roll', value: 'midroll', platforms: ['youtube'] },
        { id: 'pos_postroll', label: 'Post-roll', value: 'postroll', platforms: ['youtube'] }, { id: 'pos_bumper', label: 'Bumper', value: 'bumper', platforms: ['youtube'] },
        { id: 'pos_top', label: 'Top', value: 'top', platforms: ['google'] }, { id: 'pos_bottom', label: 'Bottom', value: 'bottom', platforms: ['google'] },
        { id: 'pos_side', label: 'Side', value: 'side', platforms: ['google'] },
      ];
      return { _id: 'ad_position', config_type: 'sidebar', title: 'AD POSITION', rank: 18, collapsed_by_default: false, visible: true, icon: { type: 'none', value: null }, meta: 'Filter Facebook, YouTube and Google ads by their position in the page or video.', display_mode: 'accordion', created_at: CREATED_AT, flag: true, filters: [{ _id: 'ad_position_filter', group_id: 'ad_position', label: 'Ad Position', type: 'checkbox', rank: 1, query_param: 'adPosition', multi_select: true, visible: true, platform_applicability: ['facebook','youtube','google'], options: positions.map((p, i) => ({ _id: p.id, filter_id: 'ad_position_filter', label: p.label, value: p.value, rank: i + 1, selected_by_default: false, platform_applicability: p.platforms })) }] };
    })(),

    // 19. Image Size
    (() => {
      const sizes = [{ id: 'is_300x250', label: '300×250', value: '300x250' }, { id: 'is_728x90', label: '728×90', value: '728x90' }, { id: 'is_160x600', label: '160×600', value: '160x600' }, { id: 'is_300x600', label: '300×600', value: '300x600' }, { id: 'is_320x50', label: '320×50', value: '320x50' }, { id: 'is_970x90', label: '970×90', value: '970x90' }, { id: 'is_468x60', label: '468×60', value: '468x60' }, { id: 'is_250x250', label: '250×250', value: '250x250' }, { id: 'is_200x200', label: '200×200', value: '200x200' }, { id: 'is_336x280', label: '336×280', value: '336x280' }];
      return { _id: 'image_size', config_type: 'sidebar', title: 'IMAGE SIZE', rank: 19, collapsed_by_default: false, visible: true, icon: { type: 'none', value: null }, meta: 'Filter GDN display ads by banner image dimensions.', display_mode: 'accordion', created_at: CREATED_AT, flag: true, filters: [{ _id: 'image_size_filter', group_id: 'image_size', label: 'Image Size', type: 'checkbox', rank: 1, query_param: 'imageSize', multi_select: true, visible: true, platform_applicability: ['gdn'], options: sizes.map((s, i) => ({ _id: s.id, filter_id: 'image_size_filter', label: s.label, value: s.value, rank: i + 1, selected_by_default: false })) }] };
    })(),

    // 20. Native Network
    (() => {
      const networks = [{ id: 'nn_taboola', label: 'Taboola', value: 'taboola' }, { id: 'nn_outbrain', label: 'Outbrain', value: 'outbrain' }, { id: 'nn_mgid', label: 'MGID', value: 'mgid' }, { id: 'nn_revcontent', label: 'RevContent', value: 'revcontent' }, { id: 'nn_content_ad', label: 'Content.ad', value: 'content_ad' }, { id: 'nn_yahoo_gemini', label: 'Yahoo Gemini', value: 'yahoo_gemini' }, { id: 'nn_sharethrough', label: 'Sharethrough', value: 'sharethrough' }, { id: 'nn_triplelift', label: 'TripleLift', value: 'triplelift' }];
      return { _id: 'native_network', config_type: 'sidebar', title: 'NATIVE NETWORK', rank: 20, collapsed_by_default: false, visible: true, icon: { type: 'none', value: null }, meta: 'Filter native ads by the ad network they run on.', display_mode: 'accordion', created_at: CREATED_AT, flag: true, filters: [{ _id: 'native_network_filter', group_id: 'native_network', label: 'Native Network', type: 'checkbox', rank: 1, query_param: 'nativeNetwork', multi_select: true, visible: true, platform_applicability: ['native'], options: networks.map((n, i) => ({ _id: n.id, filter_id: 'native_network_filter', label: n.label, value: n.value, rank: i + 1, selected_by_default: false })) }] };
    })(),

    // 21. Video Views
    { _id: 'views_range', config_type: 'sidebar', title: 'VIDEO VIEWS', rank: 21, collapsed_by_default: false, visible: true, icon: { type: 'none', value: null }, meta: 'Filter YouTube ads by the number of views on the video.', display_mode: 'accordion', created_at: CREATED_AT, flag: true, filters: [{ _id: 'views_range_filter', group_id: 'views_range', label: 'Video Views', type: 'range_slider', rank: 1, query_param: 'views', multi_select: false, visible: true, platform_applicability: ['youtube'], min: 0, max: 1000000000, step: 10000, default_min: 0, default_max: 1000000000, loose_ends: 'right', slider_scale: 'exponential', pin_mode: 'double' }] },
  ];
}

/**
 * Build all 27 SDUI documents (2 searchbar + 4 navbar + 21 sidebar).
 */
function buildSDUIDocuments() {
  return [...buildSearchbar(), ...buildNavbar(), ...buildSidebar()];
}

module.exports = { buildSDUIDocuments };
