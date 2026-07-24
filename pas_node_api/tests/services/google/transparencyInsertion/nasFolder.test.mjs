import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { TYPE_SUBFOLDER } = require('../../../../src/insertion/helpers/nasClient');
const { extensionFromUrl } = require('../../../../src/insertion/helpers/mediaUpload');

describe('Google Transparency NAS folder', () => {
  it('adds only the TEXT-image folder and leaves existing folders unchanged', () => {
    expect(TYPE_SUBFOLDER.GT_TEXT).toBe('adT/');
    expect(TYPE_SUBFOLDER.IMAGE).toBe('adImage/');
    expect(TYPE_SUBFOLDER.VIDEO).toBe('adVideo/');
    expect(TYPE_SUBFOLDER.OTHERMULTIMEDIA).toBe('otherMultiMedia/');
  });

  it('uses a real URL image extension as the download fallback', () => {
    expect(extensionFromUrl('https://cdn.example/creative/photo.jpg?token=1')).toBe('jpg');
    expect(extensionFromUrl('https://cdn.example/creative/no-extension')).toBe('webp');
  });
});
