import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeSearchValues } = require('../../../../src/services/common/helpers/esQueryHelpers');

const builderSpecs = [
  ['facebook', require('../../../../src/services/facebook/builders/SearchMixQueryBuilder'), 'setPostOwnerName'],
  ['instagram', require('../../../../src/services/instagram/builders/SearchMixQueryBuilder'), 'setPostOwnerName'],
  ['youtube', require('../../../../src/services/youtube/builders/SearchMixQueryBuilder'), 'setPostOwnerName'],
  ['gdn', require('../../../../src/services/gdn/builders/SearchMixQueryBuilder'), 'setPostOwnerName'],
  ['linkedin', require('../../../../src/services/linkedin/builders/LinkedinSearchQueryBuilder'), 'setPostOwnerName'],
  ['native', require('../../../../src/services/native/builders/NativeSearchQueryBuilder'), 'setPostOwnerName'],
  ['reddit', require('../../../../src/services/reddit/builders/RedditSearchQueryBuilder'), 'setPostOwnerName'],
  ['quora', require('../../../../src/services/quora/builders/QuoraSearchQueryBuilder'), 'setPostOwnerName'],
  ['pinterest', require('../../../../src/services/pinterest/builders/PinterestSearchQueryBuilder'), 'setPostOwnerName'],
  ['google', require('../../../../src/services/google/builders/GoogleSearchQueryBuilder'), 'setPostOwnerName'],
  ['tiktok', require('../../../../src/services/tiktok/builders/TiktokSearchQueryBuilder'), 'setAdvertiser'],
];

describe('multi-value keyword/advertiser contract', () => {
  it('cleans, de-duplicates and caps input at five values', () => {
    expect(normalizeSearchValues([' A ', 'a', 'B', '', 'NA', 'C', 'D', 'E', 'F']))
      .toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  for (const [name, Builder, advertiserSetter] of builderSpecs) {
    it(`${name}: one-item arrays keep the scalar keyword and advertiser query`, () => {
      const scalarKeyword = new Builder().setKeyword('alpha').build().body.query;
      const arrayKeyword = new Builder().setKeyword(['alpha']).build().body.query;
      expect(arrayKeyword).toEqual(scalarKeyword);

      const scalarAdvertiserBuilder = new Builder();
      scalarAdvertiserBuilder[advertiserSetter]('brand');
      const arrayAdvertiserBuilder = new Builder();
      arrayAdvertiserBuilder[advertiserSetter](['brand']);
      expect(arrayAdvertiserBuilder.build().body.query)
        .toEqual(scalarAdvertiserBuilder.build().body.query);

      if (typeof scalarAdvertiserBuilder.setExactSearch === 'function') {
        const exactScalar = new Builder().setExactSearch(true);
        exactScalar[advertiserSetter]('brand');
        const exactArray = new Builder().setExactSearch(true);
        exactArray[advertiserSetter](['brand']);
        expect(exactArray.build().body.query).toEqual(exactScalar.build().body.query);
      }
    });

    it(`${name}: multiple keyword values are bounded OR alternatives`, () => {
      const query = new Builder().setKeyword(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'ignored'])
        .build().body.query;
      const json = JSON.stringify(query);
      expect(json).toContain('alpha');
      expect(json).toContain('epsilon');
      expect(json).not.toContain('ignored');
      expect(json).toContain('minimum_should_match');
    });

    it(`${name}: multiple advertiser values are bounded OR alternatives`, () => {
      const builder = new Builder();
      builder[advertiserSetter](['brand-a', 'brand-b', 'brand-c', 'brand-d', 'brand-e', 'ignored']);
      const json = JSON.stringify(builder.build().body.query);
      expect(json).toContain('brand-a');
      expect(json).toContain('brand-e');
      expect(json).not.toContain('ignored');
      expect(json).toContain('minimum_should_match');
    });
  }

  it('facebook exact multi-advertiser uses one terms filter', () => {
    const FacebookBuilder = builderSpecs[0][1];
    const query = new FacebookBuilder().setExactSearch(true)
      .setPostOwnerName(['Nykaa', 'Myntra']).build().body.query;
    expect(query.bool.filter).toContainEqual({
      terms: {
        'facebook_ad_post_owners.post_owner_lower.keyword': ['nykaa', 'myntra'],
      },
    });
  });

  it('tiktok exact multi-advertiser uses one terms filter', () => {
    const TiktokBuilder = builderSpecs[10][1];
    const query = new TiktokBuilder().setExactSearch(true)
      .setAdvertiser(['Nykaa', 'Myntra']).build().body.query;
    expect(query.bool.filter).toContainEqual({ terms: { post_owner: ['nykaa', 'myntra'] } });
  });

  it('google exact multi-advertiser uses its normalized keyword field', () => {
    const GoogleBuilder = builderSpecs[9][1];
    const query = new GoogleBuilder().setExactSearch(true)
      .setPostOwnerName(['Nykaa', 'Myntra']).build().body.query;
    expect(query.bool.filter).toContainEqual({
      terms: { post_owner_lower: ['nykaa', 'myntra'] },
    });
  });

  it('chatgpt ads preserves one-item arrays and uses terms for exact advertiser lists', () => {
    const Builder = require('../../../../src/services/chatgptads/builders/ChatgptSearchQueryBuilder');
    expect(new Builder().setKeyword(['alpha']).build().body.query)
      .toEqual(new Builder().setKeyword('alpha').build().body.query);
    const query = new Builder().setPostOwnerName(['Nykaa', 'Myntra'], true).build().body.query;
    expect(query.bool.filter).toContainEqual({
      terms: { 'post_owner_name.kw': ['Nykaa', 'Myntra'] },
    });
  });

  it('chatgpt ads parser collapses one item and caps multi-value search input', () => {
    const { parseSearchParams } = require('../../../../src/services/chatgptads/helpers/paramParser');
    expect(parseSearchParams({ keyword: ['alpha'], advertiser: ['brand'] }))
      .toMatchObject({ keyword: 'alpha', advertiser: 'brand' });
    expect(parseSearchParams({ keyword: ['a', 'b', 'c', 'd', 'e', 'ignored'] }).keyword)
      .toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('admob combines advertiser and keyword, and exact advertiser lists use terms', async () => {
    const { searchAds } = require('../../../../src/services/admob/controllers/adSearchController');
    const search = vi.fn(async () => ({ hits: { hits: [], total: { value: 0 } } }));
    await searchAds({ body: {
      keyword: ['shoes', 'dress'],
      advertiser: ['Nykaa', 'Myntra'],
      exact_search: 1,
    } }, { elastic: { indexName: 'mob_search_mix', search } }, { error: vi.fn() });
    const body = search.mock.calls[0][0].body;
    expect(body.query.bool.must).toHaveLength(1);
    expect(body.query.bool.must[0].bool.should).toHaveLength(2);
    expect(body.query.bool.filter).toContainEqual({
      terms: { 'post_owner.keyword': ['nykaa', 'myntra'] },
    });
  });
});
