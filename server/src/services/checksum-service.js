/**
 * Checksum Service
 *
 * Computes SHA-256 checksums over canonical JSON representations of
 * characters and lorebooks. Used for duplicate detection, change tracking,
 * and collision prevention.
 *
 * Normalization rules (field in/exclusion) are defined in
 * tasks/character-and-lorebook-checksum-fields.md and frozen for the
 * lifetime of a schema version.
 */

import crypto from 'crypto';

/**
 * Stable JSON serializer with deterministic key ordering.
 * Also strips top-level keys not in the provided allowlist.
 */
function canonicalStringify(obj, allowedKeys = null) {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map((v) => canonicalStringify(v, allowedKeys)).join(',') + ']';
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    const pairs = [];
    for (const key of keys) {
      if (allowedKeys && !allowedKeys.has(key)) continue;
      const value = obj[key];
      if (value === undefined || value === null) continue;
      pairs.push(JSON.stringify(key) + ':' + canonicalStringify(value, allowedKeys));
    }
    return '{' + pairs.join(',') + '}';
  }
  return String(obj);
}

/**
 * Build a sorted array of entry objects for deterministic lorebook hashing.
 * Entries are sorted by their keys array (lexicographically) to ensure
 * the same content always produces the same entry order.
 */
function sortedEntries(entries, allowedEntryKeys) {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  // Build a comparable key per entry (copy to avoid mutating originals)
  const withKey = entries.map((entry) => {
    const keys = Array.isArray(entry.keys) ? [...entry.keys] : [];
    return { entry, sortKey: JSON.stringify(keys.sort()) };
  });

  withKey.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  return withKey.map(({ entry }) => JSON.parse(canonicalStringify(entry, allowedEntryKeys)));
}

// ─── Character field allowlists ──────────────────────────────────────────────

/** Fields always included in character checksums. */
const CHAR_INCLUDE = new Set([
  'name',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'system_prompt',
  'post_history_instructions',
  'tags',
  'creator_notes',
  'creator',
  'character_version'
]);

/** Keys inside `extensions` that are included (allowlist approach). */
const CHAR_EXT_ALLOWLIST = new Set([
  'depth_prompt',
  'talkativeness',
  'fav',
  'avatar',
  'chub' // excluded per user decision, but kept in allowlist for clarity
]);

/** Character data top-level keys that appear in card.data. */
const CHAR_DATA_INCLUDE = new Set(['spec', 'spec_version', 'data']);

// ─── Lorebook field allowlists ───────────────────────────────────────────────

const LORE_INCLUDE = new Set([
  'name',
  'description',
  'scanDepth',
  'tokenBudget',
  'recursiveScanning'
]);

/** Entry keys included in lorebook checksums. */
const LORE_ENTRY_INCLUDE = new Set([
  'keys',
  'secondaryKeys',
  'content',
  'constant',
  'position',
  'caseSensitive',
  'matchWholeWords',
  'useRegex',
  'probability',
  'useProbability',
  'depth',
  'scanDepth',
  'selective',
  'selectiveLogic',
  'insertionOrder',
  'group',
  'preventRecursion',
  'delayUntilRecursion'
]);

/**
 * Compute character checksum from the normalized card data.
 *
 * @param {Object} cardData - The full character card (spec + data wrapper).
 * @returns {string} Hex SHA-256 digest.
 */
export function computeCharacterChecksum(cardData) {
  const inner = cardData?.data || cardData;
  const payload = {};

  // 1. Copy allowed scalar fields from inner.data
  for (const key of CHAR_INCLUDE) {
    if (inner[key] !== undefined && inner[key] !== null) {
      payload[key] = inner[key];
    }
  }

  // 2. Handle extensions via allowlist
  if (inner.extensions && typeof inner.extensions === 'object') {
    const extFiltered = {};
    for (const key of CHAR_EXT_ALLOWLIST) {
      if (key === 'chub') continue; // explicitly excluded per user decision
      if (inner.extensions[key] !== undefined) {
        extFiltered[key] = inner.extensions[key];
      }
    }
    if (Object.keys(extFiltered).length > 0) {
      payload.extensions = extFiltered;
    }
  }

  // 3. Include `ursceal_lorebook_id` ONLY for internal/current checksums
  //    (caller must inject it before calling if appropriate)
  if (inner.extensions?.ursceal_lorebook_id !== undefined) {
    if (!payload.extensions) payload.extensions = {};
    payload.extensions.ursceal_lorebook_id = inner.extensions.ursceal_lorebook_id;
  }

  const json = canonicalStringify(payload);
  return crypto.createHash('sha256').update(json, 'utf8').digest('hex');
}

/**
 * Compute character origin checksum (pre-rewrite).
 * Excludes ursceal_lorebook_id since it's not part of source content.
 */
export function computeCharacterOriginChecksum(cardData) {
  const inner = cardData?.data || cardData;

  // Clone and strip lorebook_id if present
  const cleaned = JSON.parse(JSON.stringify(inner));
  if (cleaned.extensions?.ursceal_lorebook_id !== undefined) {
    delete cleaned.extensions.ursceal_lorebook_id;
  }
  const wrapped = { ...(cardData.data ? cardData : {}), data: cleaned };

  return computeCharacterChecksum(wrapped);
}

/**
 * Compute lorebook checksum from normalized lorebook data.
 *
 * @param {Object} lorebookData - Normalized lorebook (entries array).
 * @returns {string} Hex SHA-256 digest.
 */
export function computeLorebookChecksum(lorebookData) {
  const payload = {};

  // 1. Scalar fields
  for (const key of LORE_INCLUDE) {
    if (lorebookData[key] !== undefined && lorebookData[key] !== null) {
      payload[key] = lorebookData[key];
    }
  }

  // 2. Entries sorted deterministically
  if (Array.isArray(lorebookData.entries) && lorebookData.entries.length > 0) {
    payload.entries = sortedEntries(lorebookData.entries, LORE_ENTRY_INCLUDE);
  }

  // 3. Extensions (included as-is for lorebooks per field list)
  if (lorebookData.extensions && typeof lorebookData.extensions === 'object') {
    const keys = Object.keys(lorebookData.extensions).sort();
    const filtered = {};
    for (const key of keys) {
      if (key === 'id' || key === 'create_date') continue;
      filtered[key] = lorebookData.extensions[key];
    }
    if (Object.keys(filtered).length > 0) {
      payload.extensions = filtered;
    }
  }

  const json = canonicalStringify(payload);
  return crypto.createHash('sha256').update(json, 'utf8').digest('hex');
}

/**
 * Check whether an entity's stored state has changed since last import.
 *
 * @param {Object} entity - Row with import_internal_checksum and current_checksum.
 * @returns {boolean} True if entity has been edited since import.
 */
export function hasChangedSinceImport(entity) {
  return (
    entity.import_internal_checksum != null &&
    entity.current_checksum !== entity.import_internal_checksum
  );
}
