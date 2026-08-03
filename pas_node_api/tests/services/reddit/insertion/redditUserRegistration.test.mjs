import { describe, expect, it, vi } from 'vitest';
import repo from '../../../../src/services/reddit/insertion/repository.js';

function connectionWith(responses) {
  return {
    execute: vi.fn(async () => responses.shift()),
    release: vi.fn(),
  };
}

describe('reddit insertion user registration', () => {
  it('returns an existing reddit_user without inserting another row', async () => {
    const conn = connectionWith([
      [[{ acquired: 1 }]],
      [[{ id: 42 }]],
      [[{ released: 1 }]],
    ]);
    const sql = { getConnection: vi.fn(async () => conn) };

    const result = await repo.getOrCreateUserByRedditId(sql, {
      redditUsername: 'existing-user',
      currentCountry: 'United States',
      ipAddress: '196.51.237.125',
      systemId: 'GBSBHL1214-PC',
    });

    expect(result).toEqual({ code: 200, data: [{ id: 42 }], created: false });
    expect(conn.execute).toHaveBeenCalledTimes(3);
    expect(conn.execute.mock.calls.some(([query]) => query.includes('INSERT INTO reddit_user'))).toBe(false);
    expect(conn.release).toHaveBeenCalledOnce();
  });

  it('registers a newly seen reddit_id and returns its internal user id', async () => {
    const conn = connectionWith([
      [[{ acquired: 1 }]],
      [[]],
      [{ insertId: 73 }],
      [[{ released: 1 }]],
    ]);
    const sql = { getConnection: vi.fn(async () => conn) };

    const result = await repo.getOrCreateUserByRedditId(sql, {
      redditUsername: 'Willowgrill362',
      currentCountry: 'United States',
      ipAddress: '196.51.237.125',
      systemId: 'GBSBHL1214-PC',
    });

    expect(result).toEqual({ code: 200, data: [{ id: 73 }], created: true });
    expect(conn.execute.mock.calls[2][0]).toContain('INSERT INTO reddit_user');
    expect(conn.execute.mock.calls[2][1]).toEqual([
      'Willowgrill362', 'United States', '196.51.237.125', 'GBSBHL1214-PC',
    ]);
    expect(conn.release).toHaveBeenCalledOnce();
  });

  it('releases the connection when the registration lock times out', async () => {
    const conn = connectionWith([[[{ acquired: 0 }]]]);
    const sql = { getConnection: vi.fn(async () => conn) };

    await expect(repo.getOrCreateUserByRedditId(sql, {
      redditUsername: 'new-user',
      currentCountry: 'India',
    })).rejects.toThrow('Timed out while registering reddit_id');

    expect(conn.release).toHaveBeenCalledOnce();
  });
});
