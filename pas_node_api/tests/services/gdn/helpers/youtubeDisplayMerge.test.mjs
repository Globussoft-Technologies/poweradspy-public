import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const databaseManager = require('../../../../src/database/DatabaseManager');
const { getYoutubeDisplayHits } = require('../../../../src/services/gdn/helpers/youtubeDisplayMerge');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('services/gdn/helpers/youtubeDisplayMerge', () => {
  it.each([
    ['example.com', '*example.com*'],
    ['https://www.example.com/products/42', '*www.example.com*'],
  ])('applies GDN domain search to merged YouTube DISPLAY hits for %s', async (domain, expected) => {
    const search = vi.fn(async () => ({ hits: { total: { value: 0 }, hits: [] } }));
    vi.spyOn(databaseManager, 'getConnections').mockReturnValue({
      elastic: { indexName: 'youtube_ads_data', search },
    });

    await getYoutubeDisplayHits(
      20,
      { field: 'gdn_ad.last_seen', order: 'desc' },
      { domain },
    );

    const request = search.mock.calls[0][0];
    expect(request.body.query.bool.filter).toContainEqual({
      wildcard: { ad_url: expected },
    });
  });
});
