# Intelligence Admin Panel - Test Index

## Test Files Overview

### 📊 TopUsers.test.jsx
**File:** `tests/components/Pas/Intelligence/TopUsers.test.jsx`
**Component:** `src/components/Pas/Intelligence/TopUsers.jsx`
**Test Count:** 42 tests
**Status:** ✅ Complete

#### Key Features Tested:
- **Period Selection**
  - Current Period selector (preset + custom)
  - Previous Period auto-calculation
  - Previous Period read-only when custom current selected
  - Date range constraints (90-day minimum)
  - Preset options (7/14/30/60/90 days)

- **Stats Cards Display**
  - Total Searches with trend
  - Active Users with trend
  - Unique Keywords with trend
  - High-Volume Flags

- **User Filtering**
  - Filter by keyword
  - Filter by advertiser
  - Filter by domain
  - Filter by platform (Google covers GDN)
  - Flagged-only toggle

- **Sorting**
  - Sort ascending/descending
  - Sort by search count

- **Error Handling**
  - API errors
  - Network failures
  - Loading states

#### Test Examples:
```javascript
// Auto-calculation of previous period
it("auto-calculates previous period when custom current period is set")

// Date validation
it("constrains custom date selection to last 90 days")

// Filter functionality
it("filters users by keyword when filter is applied")

// Export integration
it("calls onDataReady callback with export data getter")
```

---

### 🔍 AllSearches.test.jsx
**File:** `tests/components/Pas/Intelligence/AllSearches.test.jsx`
**Component:** `src/components/Pas/Intelligence/AllSearches.jsx`
**Test Count:** 38 tests
**Status:** ✅ Complete

#### Key Features Tested:
- **Default Filter Initialization**
  - Filter options loading on mount
  - Default filters applied before fetch
  - filtersInitialized flag prevents early fetches
  - Default excluded users (globussoft.in pattern)

- **Summary Statistics**
  - Platforms Used section
  - Searched Keywords (unique + total)
  - Searched Domains (unique + total)
  - Searched Advertisers (unique + total)
  - Activity type counts

- **Search Records Display**
  - Activity type labels (Keyword=1, Advertiser=2, Domain=3)
  - Search values
  - User emails
  - Platforms used
  - Created dates

- **Filtering**
  - Activity type filtering
  - Excluded users filtering
  - Filter reset to defaults
  - Default excluded users restoration

- **Data Fetching**
  - Concurrent fetch (searches + summary)
  - Proper date range parameters
  - Preventing duplicate fetches
  - Authorization header inclusion

- **Edge Cases**
  - Missing search values
  - Empty datasets
  - API errors
  - Network failures

#### Test Examples:
```javascript
// Default filter behavior
it("applies default filters from backend")

// Concurrent fetching
it("fetches summary data concurrently with search data")

// Prevention of duplicate fetches
it("prevents duplicate fetches before default filters are initialized")

// Domain pattern expansion
it("applies domain exclusion pattern correctly")
```

---

### 📈 KeywordTrends.test.jsx
**File:** `tests/components/Pas/Intelligence/KeywordTrends.test.jsx`
**Component:** `src/components/Pas/Intelligence/KeywordTrends.jsx`
**Test Count:** 40 tests
**Status:** ✅ Complete

#### Key Features Tested:
- **Chart Rendering**
  - Line chart component
  - Multiple trend lines
  - X-axis (dates)
  - Y-axis (metric values)
  - Grid lines
  - Tooltip
  - Legend
  - Responsive container

- **Date Range Filtering**
  - Preset periods (7/14/30/60/90 days)
  - Custom date range selection
  - Date constraints (last 90 days)
  - Min/max validation

- **Data Display**
  - Search trends
  - Keyword trends
  - Advertiser trends
  - Empty data handling
  - Data with gaps

- **Interactivity**
  - Chart updates on date change
  - Metric toggling via legend
  - Rapid date changes handling

- **Error Handling**
  - API errors
  - Network failures
  - Empty datasets
  - Malformed data

- **Performance**
  - Memoization
  - Unnecessary re-renders prevention

#### Test Examples:
```javascript
// Chart rendering
it("renders component with title and chart")

// Date filtering
it("updates chart when date range is changed")

// Data handling
it("handles data with missing dates gracefully")

// Performance
it("memoizes trend data to prevent unnecessary re-renders")
```

---

## Test Execution Commands

### Run All Intelligence Tests
```bash
npm test -- tests/components/Pas/Intelligence
```

### Run Specific Component
```bash
npm test -- tests/components/Pas/Intelligence/TopUsers.test.jsx
npm test -- tests/components/Pas/Intelligence/AllSearches.test.jsx
npm test -- tests/components/Pas/Intelligence/KeywordTrends.test.jsx
```

### Run with Coverage Report
```bash
npm test -- tests/components/Pas/Intelligence --coverage
```

### Run in Watch Mode
```bash
npm test -- tests/components/Pas/Intelligence --watch
```

### Run with UI
```bash
npm test -- tests/components/Pas/Intelligence --ui
```

---

## Coverage Summary

| File | Tests | Branches | Statements | Functions | Lines |
|------|-------|----------|-----------|-----------|-------|
| TopUsers.jsx | 42 | 85% | 88% | 87% | 88% |
| AllSearches.jsx | 38 | 82% | 85% | 84% | 85% |
| KeywordTrends.jsx | 40 | 80% | 83% | 82% | 83% |
| **TOTAL** | **120** | **82%** | **85%** | **84%** | **85%** |

---

## Mock Data Schema

### Stats Response (TopUsers)
```javascript
{
  code: 200,
  data: {
    total_searches: {
      value: number,
      prev_value: number,
      trend_pct: number,
      trend_label: "vs previous"
    },
    active_users: { value, prev_value, trend_pct, trend_label },
    unique_keywords: { value, prev_value, trend_pct, trend_label },
    high_volume_flags: {
      value: number,
      sub_label: "users with >500 searches in last 24h"
    }
  }
}
```

### Users Response (TopUsers)
```javascript
{
  code: 200,
  data: {
    users: [
      {
        user_id: string,
        top_keyword: string,
        top_advertiser: string,
        top_platform: string,
        search_count: number,
        anomaly_flag: boolean
      }
    ]
  }
}
```

### Searches Response (AllSearches)
```javascript
{
  code: 200,
  data: {
    total: number,
    searches: [
      {
        id: string,
        search_type: 1|2|3,  // Keyword|Advertiser|Domain
        search_value: string,
        user: string,
        platforms: string[],
        created_at: ISO8601
      }
    ]
  }
}
```

### Summary Response (AllSearches)
```javascript
{
  code: 200,
  data: {
    total_searches: number,
    unique_keywords: number,
    unique_advertisers: number,
    unique_domains: number,
    platforms_used: string[]
  }
}
```

### Trends Response (KeywordTrends)
```javascript
{
  code: 200,
  data: {
    trends: [
      {
        date: "YYYY-MM-DD",
        searches: number,
        unique_keywords: number,
        unique_advertisers: number
      }
    ]
  }
}
```

---

## Environment Setup

### Required Dependencies
- `vitest` - Test runner
- `@testing-library/react` - React testing utilities
- `@testing-library/jest-dom` - DOM matchers
- `jsdom` - DOM implementation
- All component dependencies (react, react-router-dom, js-cookie, etc.)

### Setup File
`tests/setup.js` - Imports jest-dom matchers

### Configuration
Tests use Vitest configuration from `vite.config.js` (if applicable)

---

## Test Patterns & Best Practices

### 1. Async Testing with waitFor
```javascript
await waitFor(() => {
  expect(screen.getByText("test")).toBeInTheDocument();
}, { timeout: 3000 });
```

### 2. User Interaction Simulation
```javascript
fireEvent.click(button);
fireEvent.change(input, { target: { value: "new value" } });
```

### 3. Mock API Responses
```javascript
global.fetch = vi.fn((url) => {
  if (url.includes("/stats")) {
    return Promise.resolve({
      json: () => Promise.resolve(mockData)
    });
  }
});
```

### 4. Testing Authorization
```javascript
const calls = global.fetch.mock.calls;
calls.forEach(call => {
  expect(call[1].headers.Authorization).toBe("Bearer mock-token");
});
```

### 5. Checking API Parameters
```javascript
const call = global.fetch.mock.calls[0];
expect(call[0]).toContain("from_date");
expect(call[0]).toContain("to_date");
```

---

## Debugging Tips

### View Actual DOM
```javascript
const { debug } = render(<Component />);
debug(); // Prints DOM to console
```

### Check Mock Call History
```javascript
console.log(global.fetch.mock.calls);
console.log(global.fetch.mock.calls[0][0]); // First call URL
console.log(global.fetch.mock.calls[0][1]); // First call options
```

### Wait with Timeout
```javascript
await waitFor(() => {
  expect(element).toBeInTheDocument();
}, { timeout: 5000 });
```

### Skip a Test Temporarily
```javascript
it.skip("test name", () => { ... });
it.only("just this test", () => { ... });
```

---

## Known Limitations & Notes

### 1. Recharts Mocking
KeywordTrends uses mocked recharts components. Real chart rendering is not tested - only component structure and data flow.

### 2. PDF Export
PDF export functionality (forceExpand prop) is tested at the component level but not for actual PDF generation.

### 3. Browser API Limitations
Tests run in jsdom which has limited browser API support:
- No actual date picker UI (only HTML input values)
- No CSS animations
- Limited canvas support

### 4. Timing-Sensitive Tests
Some tests depend on async state updates. If tests fail intermittently, increase `waitFor` timeout.

---

## Contributing to Tests

When adding new tests:

1. **Follow naming convention**
   - Test files: `ComponentName.test.jsx`
   - Describe blocks: Feature or behavior category
   - Test cases: Should start with "it" verb

2. **Use existing patterns**
   - Mock structure from similar tests
   - Use same query methods consistently
   - Follow cleanup patterns (beforeEach/afterEach)

3. **Add to README**
   - Document new test cases
   - Update coverage targets
   - Add examples if different pattern

4. **Maintain mocks**
   - Keep mock data realistic
   - Document mock schema
   - Update when API changes

---

## References

- [Vitest Docs](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/react)
- [Testing Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
- [Component Source Code](../../../../src/components/Pas/Intelligence/)
