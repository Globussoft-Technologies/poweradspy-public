import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import uploadServiceModule from '../../../../src/services/admob/landers/uploadService.js';

const require = createRequire(import.meta.url);
const repo = require('../../../../src/services/admob/landers/repository.js');
const nasService = require('../../../../src/landers/helpers/nasService.js');

const { uploadAdmobBlackhatContent } = uploadServiceModule;

const originalRepoFns = {
  getAdByLanderApiId: repo.getAdByLanderApiId,
};

const originalNasFns = {
  uploadToNAS: nasService.uploadToNAS,
  deleteTempFile: nasService.deleteTempFile,
};

afterEach(() => {
  Object.assign(repo, originalRepoFns);
  Object.assign(nasService, originalNasFns);
  vi.restoreAllMocks();
});

describe('admob upload_admob_blackhat', () => {
  it('stores screenshot and zip under the internal PAS ad id supplied in the DS-facing ad_id field', async () => {
    repo.getAdByLanderApiId = vi.fn(async () => ({ id: 2084, ad_id: '393b2a99a0d23d76912d7dbf' }));
    nasService.uploadToNAS = vi.fn(async (localFilePath, adId) => {
      const ext = String(localFilePath).endsWith('.zip') ? 'zip' : 'png';
      return `/pas-dev/stream/admob/whiteHatAd/202608/${adId}.${ext}`;
    });
    nasService.deleteTempFile = vi.fn(async () => {});

    const result = await uploadAdmobBlackhatContent(
      {
        body: {
          ad_id: '2084',
          status: '2',
          country_iso: 'IN',
        },
        files: {
          media: [{ path: 'C:\\temp\\lander.png' }],
          zip: [{ path: 'C:\\temp\\lander.zip' }],
        },
      },
      { sql: {} },
      { error() {} },
    );

    expect(repo.getAdByLanderApiId).toHaveBeenCalledWith({}, '2084');
    expect(nasService.uploadToNAS).toHaveBeenNthCalledWith(1, 'C:\\temp\\lander.png', 2084, 2, 'admob');
    expect(nasService.uploadToNAS).toHaveBeenNthCalledWith(2, 'C:\\temp\\lander.zip', 2084, 2, 'admob');
    expect(result).toEqual(expect.objectContaining({
      code: 200,
      id: 2084,
      image_path: '/pas-dev/stream/admob/whiteHatAd/202608/2084.png',
      html_path: '/pas-dev/stream/admob/whiteHatAd/202608/2084.zip',
    }));
  });

  it('rejects uploads when ad_id is missing because the internal PAS id cannot be resolved', async () => {
    repo.getAdByLanderApiId = vi.fn(async () => ({ id: 2084 }));
    nasService.uploadToNAS = vi.fn(async () => '/pas-dev/stream/admob/whiteHatAd/202608/2084.png');

    const result = await uploadAdmobBlackhatContent(
      {
        body: { status: '2' },
        files: { media: [{ path: 'C:\\temp\\lander.png' }] },
      },
      { sql: {} },
      { error() {} },
    );

    expect(result).toEqual({ code: 400, message: 'ad_id is required' });
    expect(repo.getAdByLanderApiId).not.toHaveBeenCalled();
    expect(nasService.uploadToNAS).not.toHaveBeenCalled();
  });

  it('rejects uploads when the supplied DS-facing ad_id does not exist in mob_ads', async () => {
    repo.getAdByLanderApiId = vi.fn(async () => null);
    nasService.uploadToNAS = vi.fn(async () => '/pas-dev/stream/admob/whiteHatAd/202608/2084.png');

    const result = await uploadAdmobBlackhatContent(
      {
        body: {
          ad_id: '2084',
          status: '2',
        },
        files: { media: [{ path: 'C:\\temp\\lander.png' }] },
      },
      { sql: {} },
      { error() {} },
    );

    expect(result).toEqual({ code: 400, message: 'ad not found' });
    expect(repo.getAdByLanderApiId).toHaveBeenCalledWith({}, '2084');
    expect(nasService.uploadToNAS).not.toHaveBeenCalled();
  });
});
