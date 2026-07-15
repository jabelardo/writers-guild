/**
 * Shared utility for rendering text content with embedded images.
 * Converts markdown images (![alt](url)) and HTML <img> tags into safe HTML,
 * preserving line breaks and sanitizing against XSS.
 */
import { MARKDOWN_IMAGE_RE, HTML_IMAGE_RE } from '../../../shared/regex-patterns.js';
import DOMPurify from 'dompurify';

export function renderContent(text) {
  if (!text) return '';

  let html = text;

  // 1. Extract HTML <img> tags before escaping so they survive the pipeline
  const savedImgs = [];
  HTML_IMAGE_RE.lastIndex = 0;
  html = html.replace(HTML_IMAGE_RE, (match) => {
    const marker = `\x00IMG_MARKER_${savedImgs.length}\x00`;
    const enhanced = match.replace('<img', '<img loading="lazy" class="embedded-image"');
    savedImgs.push({ marker, original: enhanced });
    return marker;
  });

  // 2. Escape HTML special chars including quotes (defense before markdown img injection)
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // 3. Convert markdown images to <img> tags
  MARKDOWN_IMAGE_RE.lastIndex = 0;
  html = html.replace(
    MARKDOWN_IMAGE_RE,
    '<img src="$2" alt="$1" class="embedded-image" loading="lazy">'
  );

  // 4. Restore saved HTML <img> tags
  for (const { marker, original } of savedImgs) {
    html = html.replace(marker, original);
  }

  // 5. Preserve line breaks
  html = html.replace(/\n/g, '<br>');

  // 6. Sanitize final HTML against XSS vectors
  html = DOMPurify.sanitize(html);
  return html;
}