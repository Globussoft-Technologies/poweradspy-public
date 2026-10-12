import { describe, expect, it } from 'vitest';

import { mapArgsToFilters, normalizeAiSearchArgs } from '../../src/services/aiSearchMapper';

describe('aiSearchMapper > keyword and advertiser lists', () => {
  it('keeps a keyword list as an array and shows it joined in the search bar', () => {
    const mapped = mapArgsToFilters({ keyword: ['flipkart', 'amazon', 'canon'] }, {});

    expect(mapped.searchIn).toBe('keyword');
    expect(mapped.searchTerms).toEqual(['flipkart', 'amazon', 'canon']);
    expect(mapped.searchQuery).toBe('flipkart, amazon, canon');
  });

  it('trims list items and drops empty ones', () => {
    const mapped = mapArgsToFilters({ keyword: [' flipkart ', '', null, 'canon'] }, {});

    expect(mapped.searchTerms).toEqual(['flipkart', 'canon']);
    expect(mapped.searchQuery).toBe('flipkart, canon');
  });

  it('keeps an advertiser list as an array', () => {
    const mapped = mapArgsToFilters({ advertiser: ['Nike', 'Adidas'] }, {});

    expect(mapped.searchIn).toBe('advertiser');
    expect(mapped.searchTerms).toEqual(['Nike', 'Adidas']);
    expect(mapped.searchQuery).toBe('Nike, Adidas');
  });

  it('keeps a single keyword as a string, with no list', () => {
    const mapped = mapArgsToFilters({ keyword: 'running shoes' }, {});

    expect(mapped.searchQuery).toBe('running shoes');
    expect(mapped.searchTerms).toBeNull();
  });

  it('ignores an empty keyword list and falls through to the advertiser', () => {
    const mapped = mapArgsToFilters({ keyword: [], advertiser: 'Apple' }, {});

    expect(mapped.searchIn).toBe('advertiser');
    expect(mapped.searchQuery).toBe('Apple');
    expect(mapped.searchTerms).toBeNull();
  });

  it('drops only the consumed terms from a keyword list', () => {
    const normalized = normalizeAiSearchArgs({
      args: { keyword: ['flipkart', 'amazon', 'canon'] },
      planning: { search_term_role: 'subject', consumed_phrases: ['amazon'] },
    });

    expect(normalized.keyword).toEqual(['flipkart', 'canon']);
  });

  it('removes a keyword list when the planner marks it as an instruction', () => {
    const normalized = normalizeAiSearchArgs({
      args: { keyword: ['flipkart', 'amazon'] },
      planning: { search_term_role: 'instruction' },
    });

    expect(normalized).not.toHaveProperty('keyword');
  });
});
