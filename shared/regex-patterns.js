/**
 * Shared regex patterns for markdown and HTML image handling
 * Used by both server-side (image-preserver.js) and client-side (StoryEditor.vue) code
 */

// Regex pattern for markdown images: ![alt](url) and ![alt] (url)
// Uses balanced-parentheses URL capture to handle URLs with ) e.g. File_(2020).jpg
// No whitespace allowed in URL portion, horizontal whitespace only between ] and (
export const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\][ \t]*\(([^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)/g;

// Regex pattern for normalizing markdown image spacing: ![alt] (url) -> ![alt](url)
// Only matches when there's horizontal whitespace between ] and ( (requires at least one space)
export const MARKDOWN_IMAGE_NORMALIZE_RE = /!\[([^\]]*)\][ \t]+\(([^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)/g;

// Regex pattern for HTML <img ...> tags
export const HTML_IMAGE_RE = /<img[^>]+>/gi;

// Regex pattern for WG placeholders: [WG_IMAGE_X]
export const WG_PLACEHOLDER_RE = /\[WG_IMAGE_(\d+)\]/g;