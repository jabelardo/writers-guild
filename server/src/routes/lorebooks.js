/**
 * Lorebook API Routes
 */

import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { SqliteStorageService } from '../services/sqliteStorage.js';
import { LorebookParser } from '../services/lorebook-parser.js';
import { cacheLorebookImages, rewriteLorebookImageUrls } from '../services/image-cacher.js';
import { computeLorebookChecksum } from '../services/checksum-service.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Initialize storage service
let storage;

router.use((req, res, next) => {
  if (!storage) {
    storage = new SqliteStorageService(req.app.locals.dataRoot);
  }
  next();
});

/**
 * Perform direct lorebook import checks (collision, duplicate, name disambiguation).
 * Throws AppError on collision or duplicate.
 * Modifies parsed.name in place if name disambiguation is needed.
 * Returns computed checksum.
 */
function checkLorebookImport(storageInstance, parsed, internalChecksum) {
  // 1. Collision check: internal checksum matches any existing lorebook current_checksum
  const collisionMatches = storageInstance.findLorebookByCurrentChecksum(internalChecksum);
  if (collisionMatches.length > 0) {
    throw new AppError('A lorebook with identical content already exists. Import rejected.', 409);
  }

  // 2. Duplicate check: origin checksum matches AND existing current == internal
  // For direct imports, we compute origin checksum from incoming data (same as internal
  // since there's no URL rewrite for lorebook names/descriptions)
  const originChecksum = internalChecksum; // lorebook has no pre/post-rewrite distinction
  const originMatches = storageInstance.findLorebookByOriginChecksum(originChecksum);
  for (const match of originMatches) {
    if (match.current_checksum === internalChecksum) {
      throw new AppError('This lorebook has already been imported (same source content).', 409);
    }
  }

  // 3. Name disambiguation
  parsed.name = storageInstance.resolveUniqueLorebookName(parsed.name);
}

// ==================== Lorebook Library Operations ====================

/**
 * List all lorebooks in global library
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const lorebooks = await storage.listAllLorebooks();

    // Get all characters to find which ones are associated with each lorebook
    const allCharacters = await storage.listAllCharacters();

    // Enrich lorebooks with associated character data
    const enrichedLorebooks = await Promise.all(
      lorebooks.map(async (lorebook) => {
        // Find characters that reference this lorebook
        const associatedCharacters = [];

        for (const char of allCharacters) {
          try {
            const characterData = await storage.getCharacter(char.id);
            const lorebookId = characterData.data?.extensions?.ursceal_lorebook_id;

            if (lorebookId === lorebook.id) {
              // Get character info
              const hasImage = await storage.hasCharacterImage(char.id);
              const hasThumbnail = await storage.hasCharacterThumbnail(char.id);
              const imageUrl = hasImage ? `/api/characters/${char.id}/image` : null;
              const thumbnailUrl = hasThumbnail ? `/api/characters/${char.id}/thumbnail` : imageUrl;

              associatedCharacters.push({
                id: char.id,
                name: characterData.data?.name || 'Unknown',
                imageUrl,
                thumbnailUrl
              });
            }
          } catch (error) {
            console.error(`Failed to check character ${char.id} for lorebook association:`, error);
          }
        }

        return {
          ...lorebook,
          characters: associatedCharacters
        };
      })
    );

    res.json({ lorebooks: enrichedLorebooks });
  })
);

/**
 * Get specific lorebook with all entries
 */
router.get(
  '/:lorebookId',
  asyncHandler(async (req, res) => {
    const { lorebookId } = req.params;
    const lorebook = await storage.getLorebook(lorebookId);
    res.json({ lorebook });
  })
);

/**
 * Import lorebook from JSON file
 */
router.post(
  '/import',
  upload.single('lorebook'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('No lorebook file provided', 400);
    }

    try {
      // Parse lorebook
      const parsed = LorebookParser.parseStandaloneLorebook(req.file.buffer);

      // Compute checksum
      const internalChecksum = computeLorebookChecksum(parsed);

      // Run import validation (collision, duplicate, name disambiguation)
      checkLorebookImport(storage, parsed, internalChecksum);

      // Generate unique ID
      const lorebookId = uuidv4();

      // Save to storage with checksums
      await storage.saveLorebook(lorebookId, parsed, {
        importOriginChecksum: internalChecksum,
        importInternalChecksum: internalChecksum,
        currentChecksum: internalChecksum
      });

      await cacheLorebookImages(storage, lorebookId, parsed, req.app.locals.dataRoot);

      res.json({
        id: lorebookId,
        name: parsed.name,
        description: parsed.description,
        entryCount: parsed.entries.length
      });
    } catch (error) {
      console.error('Failed to import lorebook:', error);
      if (error.statusCode) throw error;
      throw new AppError(`Failed to import lorebook: ${error.message}`, 400);
    }
  })
);

/**
 * Import lorebook from URL
 */
router.post(
  '/import-url',
  asyncHandler(async (req, res) => {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      throw new AppError('URL is required', 400);
    }

    try {
      // Fetch JSON from URL
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('URL does not point to a JSON file');
      }

      const jsonData = await response.json();
      const buffer = Buffer.from(JSON.stringify(jsonData), 'utf8');

      // Parse lorebook
      const parsed = LorebookParser.parseStandaloneLorebook(buffer);

      // Compute checksum
      const internalChecksum = computeLorebookChecksum(parsed);

      // Run import validation (collision, duplicate, name disambiguation)
      checkLorebookImport(storage, parsed, internalChecksum);

      // Generate unique ID
      const lorebookId = uuidv4();

      // Save to storage with checksums
      await storage.saveLorebook(lorebookId, parsed, {
        importOriginChecksum: internalChecksum,
        importInternalChecksum: internalChecksum,
        currentChecksum: internalChecksum
      });

      await cacheLorebookImages(storage, lorebookId, parsed, req.app.locals.dataRoot);

      res.json({
        id: lorebookId,
        name: parsed.name,
        description: parsed.description,
        entryCount: parsed.entries.length
      });
    } catch (error) {
      console.error('Failed to import lorebook from URL:', error);
      if (error.statusCode) throw error;
      throw new AppError(`Failed to import lorebook from URL: ${error.message}`, 400);
    }
  })
);

/**
 * Create new lorebook from scratch
 */
router.post(
  '/create',
  asyncHandler(async (req, res) => {
    const { name, description } = req.body;

    if (!name || !name.trim()) {
      throw new AppError('Lorebook name is required', 400);
    }

    const lorebookId = uuidv4();

    const lorebookData = {
      name: name.trim(),
      description: description || '',
      scanDepth: null, // Use global setting
      tokenBudget: null, // Use global setting
      recursiveScanning: true,
      entries: [],
      extensions: {}
    };

    // Compute checksum (empty lorebook)
    const currentChecksum = computeLorebookChecksum(lorebookData);

    await storage.saveLorebook(lorebookId, lorebookData, {
      currentChecksum
    });

    res.json({
      id: lorebookId,
      name: lorebookData.name,
      description: lorebookData.description,
      entryCount: 0
    });
  })
);

/**
 * Update lorebook metadata (name, description, settings)
 */
router.put(
  '/:lorebookId',
  asyncHandler(async (req, res) => {
    const { lorebookId } = req.params;
    const { name, description, scanDepth, tokenBudget, recursiveScanning } = req.body;

    // Get existing lorebook
    const existing = await storage.getLorebook(lorebookId);

    // Update fields
    const updated = {
      ...existing,
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description }),
      ...(scanDepth !== undefined && { scanDepth }),
      ...(tokenBudget !== undefined && { tokenBudget }),
      ...(recursiveScanning !== undefined && { recursiveScanning })
    };

    await storage.saveLorebook(lorebookId, updated);

    // Recompute and store current_checksum
    const currentChecksum = computeLorebookChecksum(updated);
    await storage.updateLorebookCurrentChecksum(lorebookId, currentChecksum);

    res.json({
      id: lorebookId,
      name: updated.name,
      description: updated.description,
      entryCount: updated.entries.length
    });
  })
);

/**
 * Delete lorebook from library
 */
router.delete(
  '/:lorebookId',
  asyncHandler(async (req, res) => {
    const { lorebookId } = req.params;
    await storage.deleteLorebook(lorebookId);
    res.json({ success: true });
  })
);

// ==================== Lorebook Entry Operations ====================

/**
 * Add new entry to lorebook
 */
router.post(
  '/:lorebookId/entries',
  asyncHandler(async (req, res) => {
    const { lorebookId } = req.params;
    const entryData = req.body;

    // Get existing lorebook
    const lorebook = await storage.getLorebook(lorebookId);

    // Generate unique entry ID
    const entryId =
      lorebook.entries.length > 0 ? Math.max(...lorebook.entries.map((e) => e.id || 0)) + 1 : 0;

    // Create new entry with defaults
    const newEntry = {
      id: entryId,
      keys: entryData.keys || [],
      secondaryKeys: entryData.secondaryKeys || [],
      content: entryData.content || '',
      comment: entryData.comment || '',
      enabled: entryData.enabled !== undefined ? entryData.enabled : true,
      constant: entryData.constant || false,
      selective: entryData.selective || false,
      selectiveLogic: entryData.selectiveLogic || 0,
      insertionOrder: entryData.insertionOrder !== undefined ? entryData.insertionOrder : 100,
      position: entryData.position || 1, // Default: after_char
      caseSensitive: entryData.caseSensitive || false,
      matchWholeWords: entryData.matchWholeWords || false,
      useRegex: entryData.useRegex || false,
      probability: entryData.probability !== undefined ? entryData.probability : 100,
      useProbability: entryData.useProbability || false,
      depth: entryData.depth || 4,
      scanDepth: entryData.scanDepth || null,
      group: entryData.group || '',
      preventRecursion: entryData.preventRecursion || false,
      delayUntilRecursion: entryData.delayUntilRecursion || false,
      displayIndex: entryData.displayIndex !== undefined ? entryData.displayIndex : entryId,
      extensions: entryData.extensions || {}
    };

    // Add to lorebook
    lorebook.entries.push(newEntry);

    // Save
    await storage.saveLorebook(lorebookId, lorebook);

    // Recompute and store current_checksum
    const currentChecksum = computeLorebookChecksum(lorebook);
    await storage.updateLorebookCurrentChecksum(lorebookId, currentChecksum);

    // Refetch to get actual entry ID from database
    const savedLorebook = await storage.getLorebook(lorebookId);
    const savedEntry = savedLorebook.entries[savedLorebook.entries.length - 1];

    res.json({ entry: savedEntry });
  })
);

/**
 * Update specific entry
 */
router.put(
  '/:lorebookId/entries/:entryId',
  asyncHandler(async (req, res) => {
    const { lorebookId, entryId } = req.params;
    const updates = req.body;

    // Get existing lorebook
    const lorebook = await storage.getLorebook(lorebookId);

    // Find entry
    const entryIndex = lorebook.entries.findIndex((e) => e.id === parseInt(entryId));
    if (entryIndex === -1) {
      throw new AppError('Entry not found', 404);
    }

    // Update entry
    lorebook.entries[entryIndex] = {
      ...lorebook.entries[entryIndex],
      ...updates,
      id: parseInt(entryId) // Prevent ID from being changed
    };

    // Save
    await storage.saveLorebook(lorebookId, lorebook);

    // Recompute and store current_checksum
    const currentChecksum = computeLorebookChecksum(lorebook);
    await storage.updateLorebookCurrentChecksum(lorebookId, currentChecksum);

    res.json({ entry: lorebook.entries[entryIndex] });
  })
);

/**
 * Delete entry from lorebook
 */
router.delete(
  '/:lorebookId/entries/:entryId',
  asyncHandler(async (req, res) => {
    const { lorebookId, entryId } = req.params;

    // Get existing lorebook
    const lorebook = await storage.getLorebook(lorebookId);

    // Remove entry
    lorebook.entries = lorebook.entries.filter((e) => e.id !== parseInt(entryId));

    // Save
    await storage.saveLorebook(lorebookId, lorebook);

    // Recompute and store current_checksum
    const currentChecksum = computeLorebookChecksum(lorebook);
    await storage.updateLorebookCurrentChecksum(lorebookId, currentChecksum);

    res.json({ success: true });
  })
);

export default router;
