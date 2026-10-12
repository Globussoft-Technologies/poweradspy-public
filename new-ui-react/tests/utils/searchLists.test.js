import { describe, expect, it } from 'vitest';

import { resolveSearchTerms } from '../../src/utils/searchLists';

const list = {
  searchIn: 'keyword',
  query: 'flipkart, amazon, canon',
  terms: ['flipkart', 'amazon', 'canon'],
};

describe('resolveSearchTerms', () => {
  it('returns the terms while the query and search type still match', () => {
    expect(resolveSearchTerms(list, 'flipkart, amazon, canon', 'keyword')).toEqual(['flipkart', 'amazon', 'canon']);
  });

  it('ignores the list once the search bar shows a different query', () => {
    expect(resolveSearchTerms(list, 'running shoes', 'keyword')).toBeNull();
  });

  it('ignores the list for a different search type', () => {
    expect(resolveSearchTerms(list, 'flipkart, amazon, canon', 'advertiser')).toBeNull();
  });

  it('returns null when there is no list', () => {
    expect(resolveSearchTerms(null, 'running shoes', 'keyword')).toBeNull();
  });
});
