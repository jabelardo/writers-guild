/**
 * Tests for Image Cacher Service
 *
 * Tests URL extraction from card fields, URL rewriting, and
 * the caching pipeline with mocked network and filesystem calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cacheExternalImages, rewriteImageUrls, extractCardImageUrls } from '../image-cacher.js';
import { AssetManager } from '../asset-manager.js';

// ── Helpers ───────────────────────────────────────────────────────────

function makeCard(fields = {}) {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Test',
      description: '',
      personality: '',
      scenario: '',
      first_mes: '',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      ...fields,
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('extractCardImageUrls', () => {
  it('returns empty set for card with no images', () => {
    const card = makeCard({ description: 'plain text' });
    expect([...extractCardImageUrls(card)]).toEqual([]);
  });

  it('extracts markdown image URLs', () => {
    const card = makeCard({ description: '![alt](https://example.com/img.png)' });
    const urls = extractCardImageUrls(card);
    expect([...urls]).toEqual(['https://example.com/img.png']);
  });

  it('extracts HTML img src URLs', () => {
    const card = makeCard({ personality: '<img src="https://host.com/avatar.jpg">' });
    const urls = extractCardImageUrls(card);
    expect([...urls]).toEqual(['https://host.com/avatar.jpg']);
  });

  it('extracts from all text fields', () => {
    const card = makeCard({
      description: '![a](https://a.com/1.png)',
      personality: '![b](https://b.com/2.png)',
      scenario: '<img src="https://c.com/3.jpg">',
      first_mes: '![d](https://d.com/4.png)',
      mes_example: '![e](https://e.com/5.png)',
      creator_notes: '![f](https://f.com/6.png)',
      system_prompt: '![g](https://g.com/7.png)',
      post_history_instructions: '![h](https://h.com/8.png)',
      alternate_greetings: ['![i](https://i.com/9.png)', '<img src="https://j.com/10.jpg">'],
    });
    const urls = extractCardImageUrls(card);
    expect(urls.size).toBe(10);
  });

  it('deduplicates identical URLs across fields', () => {
    const card = makeCard({
      description: '![a](https://x.com/img.png)',
      personality: '![b](https://x.com/img.png)',
    });
    const urls = extractCardImageUrls(card);
    expect(urls.size).toBe(1);
  });

  it('handles null/undefined fields gracefully', () => {
    const card = makeCard({ description: undefined, personality: null });
    const urls = extractCardImageUrls(card);
    expect(urls.size).toBe(0);
  });
});

describe('rewriteImageUrls', () => {
  it('returns cardData unchanged when imageMap is empty', () => {
    const card = makeCard({ description: '![a](https://x.com/img.png)' });
    const result = rewriteImageUrls(card, new Map());
    expect(result.data.description).toBe('![a](https://x.com/img.png)');
  });

  it('rewrites markdown image URLs', () => {
    const card = makeCard({ description: '![portrait](https://ex.com/pic.jpg)' });
    const map = new Map([['https://ex.com/pic.jpg', '/api/assets/characters/abc/def.jpg']]);
    rewriteImageUrls(card, map);
    expect(card.data.description).toBe('![portrait](/api/assets/characters/abc/def.jpg)');
  });

  it('rewrites HTML img src URLs', () => {
    const card = makeCard({ personality: '<img src="https://ex.com/ava.png">' });
    const map = new Map([['https://ex.com/ava.png', '/api/assets/characters/xyz/aaa.png']]);
    rewriteImageUrls(card, map);
    expect(card.data.personality).toBe('<img src="/api/assets/characters/xyz/aaa.png">');
  });

  it('rewrites the same URL everywhere', () => {
    const card = makeCard({
      description: '![a](https://ex.com/img.png)',
      personality: '![b](https://ex.com/img.png)',
    });
    const map = new Map([['https://ex.com/img.png', '/api/assets/abc/img.png']]);
    rewriteImageUrls(card, map);
    expect(card.data.description).toContain('/api/assets/abc/img.png');
    expect(card.data.personality).toContain('/api/assets/abc/img.png');
  });

  it('rewrites URLs in alternate greetings', () => {
    const card = makeCard({
      alternate_greetings: ['Hello ![img](https://ex.com/greet1.png)'],
    });
    const map = new Map([['https://ex.com/greet1.png', '/api/assets/abc/g1.png']]);
    rewriteImageUrls(card, map);
    expect(card.data.alternate_greetings[0]).toContain('/api/assets/abc/g1.png');
  });

  it('handles URLs with special regex characters', () => {
    const card = makeCard({ description: '![a](https://ex.com/pic+(1).jpg)' });
    const map = new Map([['https://ex.com/pic+(1).jpg', '/api/assets/abc/pic.jpg']]);
    rewriteImageUrls(card, map);
    expect(card.data.description).toBe('![a](/api/assets/abc/pic.jpg)');
  });

  it('returns early when cardData has no data sub-object', () => {
    const card = { spec: 'v2' };
    const result = rewriteImageUrls(card, new Map([['x', 'y']]));
    expect(result).toBe(card);
  });
});

describe('cacheExternalImages (mocked fetch + fs)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(AssetManager.prototype, 'readMetadata').mockResolvedValue({ images: [] });
    vi.spyOn(AssetManager.prototype, 'ensureDir').mockResolvedValue('/fake/dir');
    vi.spyOn(AssetManager.prototype, 'writeFileOnly').mockResolvedValue(undefined);
    vi.spyOn(AssetManager.prototype, 'writeMetadata').mockResolvedValue(undefined);
    vi.spyOn(AssetManager.prototype, 'assetPath').mockReturnValue('/fake/file.png');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns empty map when card has no images', async () => {
    const card = makeCard({ description: 'no images' });
    const result = await cacheExternalImages('char-1', card, '/fake/data');
    expect(result.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('downloads and caches a single markdown image', async () => {
    const pngBuffer = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/png' },
      body: {
        getReader() {
          let done = false;
          return {
            read() {
              if (done) return Promise.resolve({ done: true });
              done = true;
              return Promise.resolve({
                done: false,
                value: new Uint8Array(pngBuffer),
              });
            },
            cancel() {},
          };
        },
      },
    });

    const card = makeCard({ description: '![x](https://remote.com/pic.png)' });
    const result = await cacheExternalImages('char-1', card, '/fake/data');

    expect(result.size).toBe(1);
    const localUrl = result.get('https://remote.com/pic.png');
    expect(localUrl).toMatch(/^\/api\/assets\/characters\/char-1\/[a-f0-9]+\.png$/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(AssetManager.prototype.writeMetadata).toHaveBeenCalledTimes(1);
  });

  it('skips already-cached images', async () => {
    vi.spyOn(AssetManager.prototype, 'readMetadata').mockResolvedValue({
      images: [{ originalUrl: 'https://remote.com/pic.png', hash: 'abc', filename: 'abc.png' }],
    });

    const card = makeCard({ description: '![x](https://remote.com/pic.png)' });
    const result = await cacheExternalImages('char-1', card, '/fake/data');

    expect(result.size).toBe(1);
    expect(result.get('https://remote.com/pic.png')).toBe('/api/assets/characters/char-1/abc.png');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not fail on download errors', async () => {
    fetch.mockRejectedValue(new Error('Network error'));
    const card = makeCard({ description: '![x](https://remote.com/pic.png)' });
    const result = await cacheExternalImages('char-1', card, '/fake/data');
    expect(result.size).toBe(0);
  });

  it('handles non-image Content-Type gracefully', async () => {
    fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      body: {
        getReader() {
          let done = false;
          return {
            read() {
              if (done) return Promise.resolve({ done: true });
              done = true;
              return Promise.resolve({ done: false, value: new Uint8Array(Buffer.from('x')) });
            },
            cancel() {},
          };
        },
      },
    });
    const card = makeCard({ description: '![x](https://remote.com/not-img)' });
    const result = await cacheExternalImages('char-1', card, '/fake/data');
    expect(result.size).toBe(0);
  });
});

describe('AssetManager (interface)', () => {
  it('provides all expected methods', () => {
    expect(typeof AssetManager.prototype.ensureDir).toBe('function');
    expect(typeof AssetManager.prototype.writeAsset).toBe('function');
    expect(typeof AssetManager.prototype.readAsset).toBe('function');
    expect(typeof AssetManager.prototype.deleteDir).toBe('function');
    expect(typeof AssetManager.prototype.readMetadata).toBe('function');
    expect(typeof AssetManager.prototype.writeMetadata).toBe('function');
  });
});