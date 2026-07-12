/**
 * Image Cacher Service
 *
 * Scans character card text fields for external image URLs (Markdown and HTML),
 * downloads them, stores them locally via AssetManager with content-hash filenames,
 * and rewrites the card data to reference the local paths.
 *
 * Used during character import/create/update to build a local gallery.
 */

import crypto from 'crypto';
import sharp from 'sharp';
import { AssetManager } from './asset-manager.js';
import { MARKDOWN_IMAGE_RE, HTML_IMAGE_RE } from '../../../shared/regex-patterns.js';
import { IMAGE_MIME_TYPES_MAP, mimeTypeToExt } from '../../../shared/mime-types.js'

// ── Configuration ─────────────────────────────────────────────────────

const DOWNLOAD_TIMEOUT_MS = 15_000;       // 15 s per image
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_CONCURRENT_DOWNLOADS = 3;

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hex digest of a buffer.
 */
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Extract all image URLs (Markdown and HTML) from a single text string.
 * Returns a Set of unique URLs.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
function extractImageUrls(text) {
  const urls = new Set();

  if (!text || typeof text !== 'string') return urls;

  // Markdown: ![alt](url)
  let m;
  MARKDOWN_IMAGE_RE.lastIndex = 0;
  while ((m = MARKDOWN_IMAGE_RE.exec(text)) !== null) {
    urls.add(m[2]); // capture group 2 is the URL
  }

  // HTML: <img src="..." ...>
  HTML_IMAGE_RE.lastIndex = 0;
  while ((m = HTML_IMAGE_RE.exec(text)) !== null) {
    const tag = m[0];
    // Extract src attribute
    const srcMatch = tag.match(/src\s*=\s*["']([^"']+)["']/i);
    if (srcMatch) {
      urls.add(srcMatch[1]);
    }
  }

  return urls;
}

/**
 * Collect all image URLs from every text field of a character card.
 *
 * @param {object} cardData  — normalized V2 card data (has .data sub-object)
 * @returns {Set<string>}
 */
function collectAllImageUrls(cardData) {
  const data = cardData?.data;
  if (!data) return new Set();

  const fields = [
    data.description,
    data.personality,
    data.scenario,
    data.first_mes,
    data.mes_example,
    data.creator_notes,
    data.system_prompt,
    data.post_history_instructions,
    ...(Array.isArray(data.alternate_greetings) ? data.alternate_greetings : []),
  ];

  const all = new Set();
  for (const field of fields) {
    for (const url of extractImageUrls(field)) {
      all.add(url);
    }
  }
  return all;
}

/**
 * Collect all image URLs from a lorebook's entry content fields.
 *
 * @param {object} lorebookData  — lorebook with .entries[].content fields
 * @returns {Set<string>}
 */
function collectLorebookImageUrls(lorebookData) {
  if (!lorebookData?.entries || !Array.isArray(lorebookData.entries)) {
    return new Set();
  }

  const all = new Set();

  // Scan entry content and comment fields
  for (const entry of lorebookData.entries) {
    if (entry.content) {
      for (const url of extractImageUrls(entry.content)) {
        all.add(url);
      }
    }
    if (entry.comment) {
      for (const url of extractImageUrls(entry.comment)) {
        all.add(url);
      }
    }
  }

  // Also scan lorebook description
  if (lorebookData.description) {
    for (const url of extractImageUrls(lorebookData.description)) {
      all.add(url);
    }
  }

  return all;
}

/**
 * Download a single image from a URL.
 *
 * @param {string} url
 * @returns {Promise<{ buffer: Buffer, mimeType: string } | null>}
 *   Returns null if the download fails or the content is not a valid image.
 */
async function downloadImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WritersGuild/2.0)',
        'Accept': 'image/*',
      },
    });

    if (!response.ok) {
      console.warn(`[ImageCacher] Download failed (${response.status}): ${url}`);
      return null;
    }

    // Validate Content-Type
    const contentType = response.headers.get('content-type') || '';
    const mimeType = contentType.split(';')[0].trim().toLowerCase();
    
    if (!IMAGE_MIME_TYPES_MAP[mimeType]) {
      console.warn(`[ImageCacher] Skipping non-image Content-Type "${mimeType}": ${url}`);
      return null;
    }

    // Read body with size limit
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_IMAGE_SIZE_BYTES) {
        console.warn(`[ImageCacher] Image too large (>${MAX_IMAGE_SIZE_BYTES} bytes): ${url}`);
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }

    const buffer = Buffer.concat(chunks);
    return { buffer, mimeType };
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`[ImageCacher] Timeout downloading: ${url}`);
    } else {
      console.warn(`[ImageCacher] Error downloading ${url}: ${err.message}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Internal: generic caching pipeline ────────────────────────────────

/**
 * Internal: download, convert, and store images for any entity.
 *
 * @param {string}   entityId
 * @param {Set<string>} urls      — image URLs to cache
 * @param {string}   dataRoot
 * @param {string}   entityType   — 'characters' or 'lorebooks'
 * @param {string}   [label]      — human-readable label for log messages
 * @param {object}   [options]
 * @param {number}   [options.concurrency]
 * @returns {Promise<Map<string, string>>}
 */
async function cacheImageSet(entityId, urls, dataRoot, entityType, label, options = {}) {
  const assetManager = new AssetManager(dataRoot, entityType);
  const concurrency = options.concurrency ?? MAX_CONCURRENT_DOWNLOADS;

  if (urls.size === 0) {
    return new Map();
  }

  console.log(`[ImageCacher] Found ${urls.size} external image(s) in ${entityType.slice(0, -1)} "${label || entityId}"`);

  const meta = await assetManager.readMetadata(entityId);
  const cachedUrls = new Set(meta.images.map(i => i.originalUrl));
  const newEntries = [];
  const urlArray = [...urls];
  const imageMap = new Map();

  for (let i = 0; i < urlArray.length; i += concurrency) {
    const batch = urlArray.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        if (cachedUrls.has(url)) {
          const existing = meta.images.find(img => img.originalUrl === url);
          if (existing) {
            imageMap.set(url, `/api/assets/${entityType}/${entityId}/${existing.filename}`);
          }
          return;
        }

        const result = await downloadImage(url);
        if (!result) {
          console.warn(`[ImageCacher] Could not cache image: ${url}`);
          return;
        }

        const { buffer, mimeType } = result;

        let finalBuffer = buffer;
        let finalMimeType = mimeType;
        if (['image/jpeg', 'image/jpg', 'image/png', 'image/gif'].includes(mimeType)) {
          try {
            finalBuffer = await sharp(buffer).webp({ animated: true }).toBuffer();
            finalMimeType = 'image/webp';
          } catch (err) {
            console.warn(`[ImageCacher] WebP conversion failed for ${url}: ${err.message}`);
          }
        }

        const hash = sha256(finalBuffer);
        const ext = mimeTypeToExt(finalMimeType);
        const filename = `${hash}.${ext}`;
        const localPath = `/api/assets/${entityType}/${entityId}/${filename}`;

        await assetManager.writeFileOnly(entityId, filename, finalBuffer);
        newEntries.push({ originalUrl: url, hash, filename, mimeType: finalMimeType });
        imageMap.set(url, localPath);
      })
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('[ImageCacher] Unexpected error in download batch:', result.reason);
      }
    }
  }

  if (newEntries.length > 0) {
    const allImages = [...meta.images, ...newEntries];
    await assetManager.writeMetadata(entityId, { images: allImages });
  }

  console.log(`[ImageCacher] Cached ${imageMap.size}/${urls.size} image(s) for ${entityType.slice(0, -1)} "${label || entityId}"`);
  return imageMap;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Download all external images referenced in a character card, store them
 * locally via AssetManager, and return a mapping of original URL → local path.
 *
 * Only downloads images that are not already cached (by checking metadata).
 * Does NOT modify cardData — call rewriteImageUrls() separately.
 *
 * @param {string}   characterId
 * @param {object}   cardData   — normalized V2 card data
 * @param {string}   dataRoot   — resolved data root path
 * @param {object}   [options]
 * @param {number}   [options.concurrency]  — max parallel downloads (default 3)
 * @returns {Promise<Map<string, string>>}
 *   Map where key = original URL, value = local path (e.g. "/api/assets/characters/{id}/{hash}.jpg")
 */
export async function cacheExternalImages(characterId, cardData, dataRoot, options = {}) {
  const urls = collectAllImageUrls(cardData);
  const label = cardData.data?.name || characterId;
  return cacheImageSet(characterId, urls, dataRoot, 'characters', label, options);
}

/**
 * Download all external images referenced in a lorebook's entry content,
 * store them locally, and return a mapping of original URL → local path.
 *
 * @param {string}   lorebookId
 * @param {object}   lorebookData  — lorebook with .entries[].content fields
 * @param {string}   dataRoot
 * @param {object}   [options]
 * @param {number}   [options.concurrency]
 * @returns {Promise<Map<string, string>>}
 *   Map where key = original URL, value = local path (e.g. "/api/assets/lorebooks/{id}/{hash}.webp")
 */
export async function cacheLorebookImages(lorebookId, lorebookData, dataRoot, options = {}) {
  const urls = collectLorebookImageUrls(lorebookData);
  const label = lorebookData.name || lorebookId;
  return cacheImageSet(lorebookId, urls, dataRoot, 'lorebooks', label, options);
}

/**
 * Rewrite all image URLs in the card data text fields using the provided map.
 *
 * @param {object}              cardData   — normalized V2 card data (mutated in place)
 * @param {Map<string, string>} imageMap   — original URL → local path
 * @returns {object}  — the same cardData object (mutated), for chaining
 */
export function rewriteImageUrls(cardData, imageMap) {
  if (!imageMap || imageMap.size === 0) return cardData;
  if (!cardData?.data) return cardData;

  const data = cardData.data;

  // Build a single-pass replacement function
  function replaceUrls(text) {
    if (!text || typeof text !== 'string') return text;

    // Replace each original URL in the text with its local path
    for (const [originalUrl, localPath] of imageMap) {
      // Escape URL for regex special characters
      const escaped = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(escaped, 'g'), localPath);
    }
    return text;
  }

  // Apply to all text fields
  const fields = [
    'description',
    'personality',
    'scenario',
    'first_mes',
    'mes_example',
    'creator_notes',
    'system_prompt',
    'post_history_instructions',
  ];

  for (const field of fields) {
    if (data[field] !== undefined) {
      data[field] = replaceUrls(data[field]);
    }
  }

  // Alternate greetings (array of strings)
  if (Array.isArray(data.alternate_greetings)) {
    data.alternate_greetings = data.alternate_greetings.map(g => replaceUrls(g));
  }

  return cardData;
}

/**
 * Collect all image URLs from a card's text fields (utility, used externally).
 *
 * @param {object} cardData
 * @returns {Set<string>}
 */
export function extractCardImageUrls(cardData) {
  return collectAllImageUrls(cardData);
}

/**
 * Collect all image URLs from a lorebook's entry content (utility, used externally).
 *
 * @param {object} lorebookData
 * @returns {Set<string>}
 */
export function extractLorebookImageUrls(lorebookData) {
  return collectLorebookImageUrls(lorebookData);
}

/**
 * Rewrite all image URLs in a lorebook's entry content using the provided map.
 *
 * @param {object}              lorebookData  — lorebook with .entries[].content (mutated in place)
 * @param {Map<string, string>} imageMap      — original URL → local path
 * @returns {object}  — the same lorebookData object (mutated), for chaining
 */
export function rewriteLorebookImageUrls(lorebookData, imageMap) {
  if (!imageMap || imageMap.size === 0) return lorebookData;
  if (!lorebookData?.entries || !Array.isArray(lorebookData.entries)) return lorebookData;

  function replaceUrls(text) {
    if (!text || typeof text !== 'string') return text;
    for (const [originalUrl, localPath] of imageMap) {
      const escaped = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(escaped, 'g'), localPath);
    }
    return text;
  }

  // Rewrite in each entry's content and comment
  for (const entry of lorebookData.entries) {
    if (entry.content) {
      entry.content = replaceUrls(entry.content);
    }
    if (entry.comment) {
      entry.comment = replaceUrls(entry.comment);
    }
  }

  // Also rewrite in lorebook description
  if (lorebookData.description) {
    lorebookData.description = replaceUrls(lorebookData.description);
  }

  return lorebookData;
}