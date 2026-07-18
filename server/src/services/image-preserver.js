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
import { MARKDOWN_IMAGE_RE, HTML_IMAGE_RE, WG_PLACEHOLDER_RE } from '../../../shared/regex-patterns.js';

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
  preserve(text, source = 'context') {
    if (!text) return text;

    // Accumulates across calls: a single request preserves images from the
    // character card, lorebook entries AND the story content, so indices must
    // keep counting up rather than restarting per source.
    let idx = this.saved.length;
    let result = text;

    // --- Extract markdown images ![alt](url) ---
    result = result.replace(MARKDOWN_IMAGE_RE, (match) => {
      const placeholder = PLACEHOLDER_TEMPLATE(idx);
      this.saved.push({ original: match, placeholder, type: 'markdown', source });
      idx++;
      return placeholder;
    });

    // --- Extract HTML <img ...> tags ---
    result = result.replace(HTML_IMAGE_RE, (match) => {
      const placeholder = PLACEHOLDER_TEMPLATE(idx);
      this.saved.push({ original: match, placeholder, type: 'html', source });
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
    const missing = this.saved.filter(item => !foundPlaceholders.has(item.placeholder));

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
   * @param {object} [options]
   * @param {boolean} [options.appendMissing=true]
   *   Whether images whose placeholder is absent from the response should be
   *   appended at the end.
   *
   *   True for whole-text rewrites (rewriteThirdPerson), where the model was
   *   given the story and is expected to return all of it — a dropped
   *   placeholder means a lost image that must be recovered.
   *
   *   False for generative types (continue, character, ideate…), where the
   *   model returns NEW text and is never expected to echo the preserved
   *   images back. Appending there would dump every image in the character
   *   card and story onto the end of each generation.
   * @returns {{ finalContent: string, imagesRestored: boolean, imagesPreserved: number, imagesMissing: number }}
   */
  restoreImages(llmResponse, options = {}) {
    const { appendMissing = true } = options;

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

    // Only images that came from the text being rewritten may be recovered.
    // Character card and lorebook images were never part of the story, so
    // appending them would inject the card's gallery into the prose.
    const recoverable = missing.filter(m => m.source === 'story');

    // Build final content with missing images appended at the end
    let finalContent = restoredContent;
    if (appendMissing && recoverable.length > 0) {
      finalContent += '\n\n' + recoverable.map(m => m.original).join('\n');
    }

    console.log(`[ImagePreserver] Restored ${this.saved.length} image(s), ${missing.length} missing`);
    return {
      finalContent,
      imagesRestored: true,
      imagesPreserved: this.saved.length,
      imagesMissing: missing.length
    };
  }
}