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
  const assetManager = new AssetManager(dataRoot);
  const concurrency = options.concurrency ?? MAX_CONCURRENT_DOWNLOADS;

  // Collect all unique image URLs from the card
  const urls = collectAllImageUrls(cardData);
  if (urls.size === 0) {
    return new Map();
  }

  console.log(`[ImageCacher] Found ${urls.size} external image(s) in character "${cardData.data?.name || characterId}"`);

  // Load existing metadata to skip already-cached images
  const meta = await assetManager.readMetadata(characterId);
  const cachedUrls = new Set(meta.images.map(i => i.originalUrl));

  // We collect new metadata entries in-memory, then write metadata.json
  // once at the end to avoid race conditions between parallel downloads.
  const newEntries = [];

  // Download in batches with concurrency limit
  const urlArray = [...urls];
  const imageMap = new Map();

  for (let i = 0; i < urlArray.length; i += concurrency) {
    const batch = urlArray.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        // Skip if already cached
        if (cachedUrls.has(url)) {
          const existing = meta.images.find(img => img.originalUrl === url);
          if (existing) {
            const localPath = `/api/assets/characters/${characterId}/${existing.filename}`;
            imageMap.set(url, localPath);
          }
          return;
        }

        const result = await downloadImage(url);
        if (!result) {
          console.warn(`[ImageCacher] Could not cache image: ${url}`);
          return;
        }

        const { buffer, mimeType } = result;

        // Convert to WebP for space savings (JPEG, PNG, GIF → WebP)
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
        const localPath = `/api/assets/characters/${characterId}/${filename}`;

        // Write file directly — metadata is collected and written in bulk at the end
        await assetManager.writeFileOnly(characterId, filename, finalBuffer);

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

  // Write complete metadata once — merges existing cached entries with new ones
  if (newEntries.length > 0) {
    const allImages = [...meta.images, ...newEntries];
    await assetManager.writeMetadata(characterId, { images: allImages });
  }

  console.log(`[ImageCacher] Cached ${imageMap.size}/${urls.size} image(s) for character "${cardData.data?.name || characterId}"`);
  return imageMap;
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