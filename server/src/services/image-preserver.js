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

// Import shared regex patterns
import {
  MARKDOWN_IMAGE_RE,
  HTML_IMAGE_RE,
  WG_PLACEHOLDER_RE
} from '../../../shared/regex-patterns.js';

// Placeholder template — uses a dedicated marker.
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

    return result;
  }

  /**
   * Restore original images into the LLM's response by finding each
   * surviving placeholder.  Placeholders the LLM removed are collected
   * and returned separately so the caller can decide how to handle them
   * (e.g. append at the end of the document).
   *
   * Uses a single regex pass with a placeholder→original map for O(n) performance.
   * Only the first occurrence of each placeholder is replaced; subsequent
   * duplicates are removed to prevent image duplication.
   *
   * @param {string} response  The raw LLM response text
   * @returns {{ text: string, missing: { original: string, placeholder: string }[] }}
   *   - text:    response with placeholders restored
   *   - missing: images whose placeholder was not found (lost by the LLM)
   */
  restore(response) {
    if (!response) return { text: response || '', missing: [...this.saved] };

    const placeholderMap = new Map();
    for (const item of this.saved) {
      placeholderMap.set(item.placeholder, item.original);
    }

    // Track which placeholders have been replaced (to handle duplicates)
    const replacedPlaceholders = new Set();

    // Track which placeholders were found
    const foundPlaceholders = new Set();

    // Reset lastIndex to avoid issues from previous calls
    WG_PLACEHOLDER_RE.lastIndex = 0;

    // Single regex pass to replace all placeholders
    const result = response.replace(WG_PLACEHOLDER_RE, (match) => {
      if (!placeholderMap.has(match)) {
        return match; // Not one of ours, leave unchanged
      }

      foundPlaceholders.add(match);

      if (replacedPlaceholders.has(match)) {
        // This placeholder appeared more than once - only replace the first occurrence
        // Return empty string for subsequent occurrences to avoid duplication
        return '';
      }

      replacedPlaceholders.add(match);
      return placeholderMap.get(match);
    });

    // Detect missing: placeholders that were saved but not found in response
    const missing = this.saved.filter((item) => !foundPlaceholders.has(item.placeholder));

    return { text: result, missing };
  }

  /**
   * Restore preserved images back into the LLM response.
   *
   * Surviving placeholders are replaced with the original image markup.
   * Placeholders the LLM removed (missing images) are appended at the end.
   * If the LLM returned empty or whitespace-only content, the original
   * response is returned as-is and nothing is restored.
   *
   * @param {string} llmResponse  Raw text returned by the LLM
   * @returns {{ finalContent: string, imagesRestored: boolean, imagesPreserved: number, imagesMissing: number }}
   */
  restoreImages(llmResponse) {
    // Guard against empty/failed LLM response
    const hasContent = llmResponse && llmResponse.trim().length > 0;
    if (!hasContent || this.saved.length === 0) {
      return {
        finalContent: llmResponse || '',
        imagesRestored: false,
        imagesPreserved: 0,
        imagesMissing: 0
      };
    }

    const { text: restoredContent, missing } = this.restore(llmResponse);

    // Build final content with missing images appended at the end
    let finalContent = restoredContent;
    if (missing.length > 0) {
      finalContent += '\n\n' + missing.map((m) => m.original).join('\n');
    }

    console.log(
      `[ImagePreserver] Restored ${this.saved.length} image(s), ${missing.length} missing`
    );
    return {
      finalContent,
      imagesRestored: true,
      imagesPreserved: this.saved.length,
      imagesMissing: missing.length
    };
  }
}
