/**
 * Image Preserver Service
 *
 * Extracts embedded images (markdown and HTML img tags) from story content
 * before sending to the LLM, replaces them with robust placeholders, and
 * restores them after the LLM response comes back.
 *
 * This prevents the LLM from stripping or mangling image references during
 * rewrites (third-person, continue, instruction, etc.).
 */

// Regex patterns for both image formats
// Support both standard markdown image syntax and variants with spaces:
// ![alt](url) and ![alt] (url)
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\s*\(([^)]+)\)/g;
const HTML_IMAGE_RE = /<img[^>]+>/gi;

// Also catch stale [IMAGE_X] placeholders left over from previous client-side
// extraction attempts (before the server-side preserver existed).
const STALE_PLACEHOLDER_RE = /\[IMAGE_(\d+)\]/g;

// Dedicated WG placeholders we use during the current request
const WG_PLACEHOLDER_RE = /\[WG_IMAGE_(\d+)\]/g;

// Placeholder template — uses a dedicated marker that won't collide with
// stale client-side placeholders like [IMAGE_X].
// HTML comments (<!-- -->) get stripped by LLMs, so use plain text markers.
const PLACEHOLDER_TEMPLATE = (idx) => `[WG_IMAGE_${idx}]`;

export class ImagePreserver {
  constructor() {
    /** @type {{ original: string, placeholder: string }[]} */
    this.saved = [];
  }

  /**
   * Scan `text` for all embedded images (markdown + HTML <img>),
   * replace each with a unique placeholder, and store the originals.
   * Also handles stale [IMAGE_X] placeholders from previous client-side attempts.
   *
   * @param {string} text  The full story content
   * @returns {string}     Text with images replaced by placeholders
   */
  preserve(text) {
    if (!text) return text;

    this.saved = [];
    let idx = 0;
    let result = text;

    // --- Extract markdown images ![alt](url) ---
    result = result.replace(MARKDOWN_IMAGE_RE, (match) => {
      const placeholder = PLACEHOLDER_TEMPLATE(idx);
      this.saved.push({ original: match, placeholder, type: 'markdown' });
      idx++;
      return placeholder;
    });

    // --- Extract HTML <img ...> tags ---
    result = result.replace(HTML_IMAGE_RE, (match) => {
      const placeholder = PLACEHOLDER_TEMPLATE(idx);
      this.saved.push({ original: match, placeholder, type: 'html' });
      idx++;
      return placeholder;
    });

    // --- Fallback: catch stale [IMAGE_X] placeholders from old client-side logic ---
    // These are preserved as-is (they'll be restored by the client's fallback).
    // Do NOT remap placeholders we generated in this request (WG_IMAGE_*)
    result = result.replace(STALE_PLACEHOLDER_RE, (match) => {
      const placeholder = PLACEHOLDER_TEMPLATE(idx);
      this.saved.push({ original: match, placeholder, type: 'stale' });
      idx++;
      return placeholder;
    });

    return result;
  }

  /**
   * Restore original images into the LLM's response by finding each
   * surviving placeholder.  Placeholders the LLM removed are collected
   * and returned separately so the caller can decide how to handle them
   * (e.g. append at the end of the document).
   *
   * @param {string} response  The raw LLM response text
   * @returns {{ text: string, missing: { original: string, placeholder: string }[] }}
   *   - text:    response with placeholders restored
   *   - missing: images whose placeholder was not found (lost by the LLM)
   */
  restore(response) {
    if (!response) return { text: response || '', missing: [...this.saved] };

    let text = response;
    const missing = [];

    for (const item of this.saved) {
      if (text.includes(item.placeholder)) {
        text = text.split(item.placeholder).join(item.original);
      } else {
        missing.push(item);
      }
    }

    return { text, missing };
  }

  /**
   * Convenience: run preserve → (prompt-building happens) → restore.
   * `missing` images are appended to the end of the restored text.
   *
   * @param {string} rawContent    Original story content with embedded images
   * @param {string} llmResponse   Response from the LLM
   * @returns {string}             Final content with images restored (missing ones appended)
   */
  process(rawContent, llmResponse) {
    this.preserve(rawContent);
    const { text, missing } = this.restore(llmResponse);

    // Append any images the LLM removed at the end
    if (missing.length > 0) {
      const appended = missing.map((m) => m.original).join('\n');
      return text ? `${text}\n\n${appended}` : appended;
    }

    return text;
  }

  /** Reset saved images (e.g. between generations) */
  reset() {
    this.saved = [];
  }
}