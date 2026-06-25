# Intelligence Component Test Suite

This directory contains comprehensive test cases for all components in the Search Intelligence dashboard.

## Test Files

### 1. **AllSearches.test.jsx**
Tests for the All Searches tab component with 90-day activity log.

**Coverage:** 40+ tests
- Component rendering and tab navigation
- Filter options and default filter application
- Search data fetching and display
- Activity type detection (Keyword, Advertiser, Domain)
- Summary statistics with platforms, searches, and activity counts
- Platform filtering (single and comma-separated values)
- Date range filtering
- User email filtering
- Filter reset and application
- Pagination controls
- PDF export data preparation

### 2. **KeywordTrends.test.jsx**
Tests for the Keyword Trends tab showing top keywords, advertisers, and domains.

**Coverage:** 30+ tests
- Trend chart display and data fetching
- Growth rate calculation (45-day vs 45-day comparison)
- Search volume and growth rate sorting
- Tab switching (Keywords, Advertisers, Domains)
- Search filter with autocomplete
- Tooltip display for truncated labels
- Period information display
- PDF export data preparation

### 3. **Projects.test.jsx**
Tests for the Projects tab showing project activity and member management.

**Coverage:** 30+ tests
- Project activity table rendering
- Member activity data (add_member, delete_member, export_competitors)
- Exported competitors as badge pills
- Project type labels with color coding
- Date range filtering
- User email filtering
- Active filter chips
- Pagination and data display
- PDF export with member and competitor data

### 4. **SearchIntelligence.test.jsx**
Tests for the main SearchIntelligence container component.

**Coverage:** 15+ tests
- Tab navigation (Top Users, All Searches, Keyword Trends, Projects)
- Tab switching and state management
- Export button functionality
- Child component rendering
- Export data collection from active tabs

### 5. **TopUsers.test.jsx**
Tests for the Top Users statistics component.

**Coverage:** 50+ tests
- Stats cards (Total Searches, Active Users, Unique Keywords, High-Volume Flags)
- Preset and custom date period selection
- User filtering and search
- Flagged-only filter toggle
- Sorting by search count
- Avatar and platform display
- Export data callback
- PDF export preparation

## Key Features Tested

- ✅ Data Fetching & API Integration
- ✅ Authorization token handling
- ✅ Filtering & Search functionality
- ✅ Data Display and formatting
- ✅ Tab Management
- ✅ PDF Export capabilities
- ✅ Error handling
- ✅ Loading states

## Running Tests

```bash
npm test tests/components/Pas/Intelligence
```
