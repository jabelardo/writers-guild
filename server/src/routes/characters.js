/**
 * Characters API Routes (Global Library)
 */

import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { SqliteStorageService } from '../services/sqliteStorage.js';
import { CharacterParser } from '../services/character-parser.js';
import { LorebookParser } from '../services/lorebook-parser.js';
import { ChubImporter } from '../services/chub-importer.js';
import { IMAGE_EXTENSIONS } from '../../../shared/regex-patterns.js';
import { cacheCharacterImages, cacheLorebookImages, rewriteCharacterImageUrls, rewriteLorebookImageUrls } from '../services/image-cacher.js';
import { AssetManager } from '../services/asset-manager.js';

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/avif'];
    if (!allowedTypes.includes(file.mimetype)) {
      cb(new AppError('Only PNG, JPEG, WebP, and AVIF images are allowed', 400));
    } else {
      cb(null, true);
    }
  },
});

// Configure multer for JSON uploads (import-json route)
const jsonUpload = multer({ storage: multer.memoryStorage() });

// Initialize storage service
let storage;

router.use((req, res, next) => {
  if (!storage) {
    storage = new SqliteStorageService(req.app.locals.dataRoot);
  }
  next();
});

/**
 * Helper to cache external images and rewrite URLs in character card data.
 * Does NOT throw on failure — just logs warnings so imports still succeed.
 */
async function cacheCardImages(characterId, cardData, dataRoot) {
  try {
    const imageMap = await cacheCharacterImages(characterId, cardData, dataRoot);
    if (imageMap.size > 0) {
      rewriteCharacterImageUrls(cardData, imageMap);
      console.log(`[cacheCardImages] Rewrote ${imageMap.size} image URL(s) for character ${characterId}`);
    }
  } catch (error) {
    console.error(`[cacheCardImages] Failed to cache images for ${characterId}:`, error);
    // Non-fatal: continue with original URLs
  }
}

/**
 * Extract embedded lorebook from character data and save it to storage.
 * Also caches any external images found in the lorebook entry content.
 * Modifies cardData.data.extensions.ursceal_lorebook_id in place.
 * @returns {{ embeddedLorebook: object|null, lorebookId: string|null }}
 */
async function extractAndSaveEmbeddedLorebook(storageInstance, cardData, dataRoot) {
  let embeddedLorebook = null;
  let lorebookId = null;

  if (cardData.data?.character_book && cardData.data.character_book.entries && cardData.data.character_book.entries.length > 0) {
    try {
      // Parse embedded lorebook
      const lorebookData = LorebookParser.parseEmbeddedLorebook(cardData.data.character_book);

      // Give it a name based on the character
      lorebookData.name = `${cardData.data.name}'s Lorebook`;
      lorebookData.description = lorebookData.description || `Lorebook for ${cardData.data.name}`;

      // Save to global lorebook library
      lorebookId = uuidv4();
      await storageInstance.saveLorebook(lorebookId, lorebookData);

      await cacheLorebookImages(storageInstance, lorebookId, lorebookData, dataRoot);

      embeddedLorebook = {
        id: lorebookId,
        name: lorebookData.name,
        entryCount: lorebookData.entries.length
      };

      console.log(`Extracted embedded lorebook from ${cardData.data.name}: ${lorebookData.entries.length} entries`);
    } catch (error) {
      console.error('Failed to parse embedded lorebook:', error);
    }
  }

  // Add lorebook association to character data
  if (!cardData.data.extensions) {
    cardData.data.extensions = {};
  }
  cardData.data.extensions.ursceal_lorebook_id = lorebookId;

  return { embeddedLorebook, lorebookId };
}

// ==================== Global Character Library ====================

// List all characters in global library
router.get('/', asyncHandler(async (req, res) => {
  const characters = await storage.listAllCharacters();

  // Load all stories once for calculating total words per character
  const allStories = await storage.listStories();

  // Load character data from JSON files
  const charactersWithData = await Promise.all(
    characters.map(async (char) => {
      try {
        const cardData = await storage.getCharacter(char.id);
        const hasImage = await storage.hasCharacterImage(char.id);

        // Calculate total words from all stories this character appears in
        const characterStories = allStories.filter(story =>
          story.characterIds?.includes(char.id) ||
          story.personaCharacterId === char.id
        );
        const totalWords = characterStories.reduce((sum, story) => sum + (story.wordCount || 0), 0);

        // Provide full image, small thumbnail, and medium thumbnail URLs
        const hasThumbnail = await storage.hasCharacterThumbnail(char.id);
        const hasThumbnailMedium = await storage.hasCharacterThumbnailMedium(char.id);
        const imageUrl = hasImage ? `/api/characters/${char.id}/image` : null;
        const thumbnailUrl = hasThumbnail ? `/api/characters/${char.id}/thumbnail` : imageUrl;
        const thumbnailMediumUrl = hasThumbnailMedium ? `/api/characters/${char.id}/thumbnail-medium` : imageUrl;

        return {
          id: char.id,
          name: cardData.data?.name || 'Unknown',
          description: cardData.data?.description || '',
          tags: cardData.data?.tags || cardData.tags || [],
          imageUrl, // Full resolution
          thumbnailUrl, // 96x96 — table rows / recent bar
          thumbnailMediumUrl, // 256x384 — picker cards / floating avatar
          created: cardData.metadata?.created || null,
          totalWords,
        };
      } catch (error) {
        console.error(`Failed to load character ${char.id}:`, error);
        return {
          id: char.id,
          name: 'Unknown',
          description: 'Failed to load character data',
          tags: [],
          imageUrl: null,
          thumbnailUrl: null,
          thumbnailMediumUrl: null,
          created: null,
          totalWords: 0,
        };
      }
    })
  );

  // Sort characters alphabetically by name (case-insensitive)
  charactersWithData.sort((a, b) => {
    const nameA = (a.name || 'Unknown').toLowerCase();
    const nameB = (b.name || 'Unknown').toLowerCase();
    return nameA.localeCompare(nameB);
  });

  res.json({ characters: charactersWithData });
}));

// Upload new character to global library (import PNG)
router.post('/import', upload.single('character'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }

  const characterId = uuidv4();

  // Parse character card from PNG
  try {
    const cardData = await CharacterParser.parseCard(req.file.buffer);

      // Cache external images and rewrite URLs
      await cacheCardImages(characterId, cardData, req.app.locals.dataRoot);

      // Extract embedded lorebook if present
      const { embeddedLorebook } = await extractAndSaveEmbeddedLorebook(storage, cardData, req.app.locals.dataRoot);

      // Save character data as JSON and image separately
    await storage.saveCharacter(characterId, cardData, req.file.buffer);

    res.status(201).json({
      id: characterId,
      name: cardData.data?.name || 'Unknown',
      description: cardData.data?.description || '',
      imageUrl: `/api/characters/${characterId}/image`,
      firstMessage: cardData.data?.first_mes || '',
      embeddedLorebook: embeddedLorebook // Will be null if no lorebook
    });
  } catch (error) {
    throw new AppError(`Invalid character card: ${error.message}`, 400);
  }
}));

// Create new character from scratch (no PNG import)
router.post('/', asyncHandler(async (req, res) => {
  const { name, description, personality, scenario, first_mes } = req.body;

  if (!name || !name.trim()) {
    throw new AppError('Character name is required', 400);
  }

  const characterId = uuidv4();

  // Create character data in V2 format
  const characterData = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: name.trim(),
      description: description?.trim() || '',
      personality: personality?.trim() || '',
      scenario: scenario?.trim() || '',
      first_mes: first_mes?.trim() || '',
      mes_example: '',
      creator_notes: 'Created in Writers Guild',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      character_book: null,
      tags: [],
      creator: '',
      character_version: '1.0',
      extensions: {}
    }
  };

  // Save character (no image)
  await storage.saveCharacter(characterId, characterData, null);

  // Cache any external images in the card data
  await cacheCardImages(characterId, characterData, req.app.locals.dataRoot);

  res.status(201).json({
    id: characterId,
    name: characterData.data.name,
    description: characterData.data.description,
    imageUrl: null,
    firstMessage: characterData.data.first_mes,
  });
}));

// Create character with optional image
router.post('/create', upload.single('image'), asyncHandler(async (req, res) => {
  const characterDataJson = req.body.characterData;

  if (!characterDataJson) {
    throw new AppError('Character data is required', 400);
  }

  let parsedData;
  try {
    parsedData = JSON.parse(characterDataJson);
  } catch (error) {
    throw new AppError('Invalid character data JSON', 400);
  }

  const { name, description, personality, scenario, first_mes, mes_example, system_prompt } = parsedData;

  if (!name || !name.trim()) {
    throw new AppError('Character name is required', 400);
  }

  const characterId = uuidv4();

  // Create character data in V2 format
  const characterData = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: name.trim(),
      description: description?.trim() || '',
      personality: personality?.trim() || '',
      scenario: scenario?.trim() || '',
      first_mes: first_mes?.trim() || '',
      mes_example: mes_example?.trim() || '',
      creator_notes: 'Created in Writers Guild',
      system_prompt: system_prompt?.trim() || '',
      post_history_instructions: '',
      alternate_greetings: [],
      character_book: null,
      tags: [],
      creator: '',
      character_version: '1.0',
      extensions: {}
    }
  };

  // Save character with optional image
  const imageBuffer = req.file ? req.file.buffer : null;
  await storage.saveCharacter(characterId, characterData, imageBuffer);

  // Cache any external images in the card data
  await cacheCardImages(characterId, characterData, req.app.locals.dataRoot);

  const hasImage = await storage.hasCharacterImage(characterId);

  res.status(201).json({
    id: characterId,
    name: characterData.data.name,
    description: characterData.data.description,
    imageUrl: hasImage ? `/api/characters/${characterId}/image` : null,
    firstMessage: characterData.data.first_mes,
  });
}));

/**
 * Import character from JSON file (standalone .json character card)
 */
router.post('/import-json', jsonUpload.single('character'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No character file provided', 400);
  }

  // Parse JSON from buffer
  const jsonString = req.file.buffer.toString('utf8');
  let cardData;
  try {
    cardData = JSON.parse(jsonString);
  } catch (e) {
    throw new AppError('Invalid JSON file: ' + e.message, 400);
  }

  // Normalize card data (handles V2 vs flat format)
  cardData = CharacterParser.normalizeCardData(cardData);

  if (!cardData.data || !cardData.data.name) {
    throw new AppError('Invalid character card: missing name or data field', 400);
  }

  const characterId = uuidv4();

  // Cache external images and rewrite URLs
  await cacheCardImages(characterId, cardData, req.app.locals.dataRoot);

  // Extract embedded lorebook if present
  const { embeddedLorebook } = await extractAndSaveEmbeddedLorebook(storage, cardData, req.app.locals.dataRoot);

  // Save character data (no image for JSON import)
  await storage.saveCharacter(characterId, cardData, null);

  res.status(201).json({
    id: characterId,
    name: cardData.data.name,
    description: cardData.data.description || '',
    imageUrl: null,
    firstMessage: cardData.data.first_mes || '',
    embeddedLorebook: embeddedLorebook
  });
}));

// Import character from URL (CHUB, or direct image URL)
router.post('/import-url', asyncHandler(async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    throw new AppError('URL is required', 400);
  }
  
  const isImageUrl = IMAGE_EXTENSIONS.test(url);

  if (isImageUrl) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new AppError(`Failed to fetch image: ${response.statusText}`, 400);
      }

      const arrayBuffer = await response.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuffer);

      const characterId = uuidv4();

      // Parse character card from PNG
      const rawCardData = await CharacterParser.parseCard(imageBuffer);
      const cardData = CharacterParser.normalizeCardData(rawCardData);

      // Cache external images and rewrite URLs
      await cacheCardImages(characterId, cardData, req.app.locals.dataRoot);

      // Extract embedded lorebook if present
      const { embeddedLorebook } = await extractAndSaveEmbeddedLorebook(storage, cardData, req.app.locals.dataRoot);

      // Save character data as JSON and image separately
      await storage.saveCharacter(characterId, cardData, imageBuffer);

      res.status(201).json({
        id: characterId,
        name: cardData.data?.name || 'Unknown',
        description: cardData.data?.description || '',
        imageUrl: `/api/characters/${characterId}/image`,
        firstMessage: cardData.data?.first_mes || '',
        embeddedLorebook: embeddedLorebook
      });
      return;
    } catch (error) {
      throw new AppError(`Failed to import image character: ${error.message}`, 400);
    }
  }

  // Check if it's a CHUB URL
  if (!url.includes('chub.ai')) {
    throw new AppError('Only CHUB URLs and direct image URLs (PNG, JPEG, WebP) are currently supported', 400);
  }

  try {
    // Import character from CHUB
    const { characterData, imageBuffer } = await ChubImporter.importFromUrl(url);

    const characterId = uuidv4();

    // Cache external images and rewrite URLs
    await cacheCardImages(characterId, characterData, req.app.locals.dataRoot);

    // Extract embedded lorebook if present
    const { embeddedLorebook } = await extractAndSaveEmbeddedLorebook(storage, characterData, req.app.locals.dataRoot);

    // Save character with image
    await storage.saveCharacter(characterId, characterData, imageBuffer);

    const hasImage = await storage.hasCharacterImage(characterId);

    res.status(201).json({
      id: characterId,
      name: characterData.data.name,
      description: characterData.data.description,
      imageUrl: hasImage ? `/api/characters/${characterId}/image` : null,
      firstMessage: characterData.data.first_mes,
      embeddedLorebook: embeddedLorebook,
    });
  } catch (error) {
    throw new AppError(`Failed to import character: ${error.message}`, 400);
  }
}));

// Get character image
router.get('/:characterId/image', asyncHandler(async (req, res) => {
  const { characterId } = req.params;
  const imageBuffer = await storage.getCharacterImage(characterId);

  if (!imageBuffer) {
    throw new AppError('Character has no image', 404);
  }

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
  res.send(imageBuffer);
}));

// Get character thumbnail (96x96 optimized avatar)
router.get('/:characterId/thumbnail', asyncHandler(async (req, res) => {
  const { characterId } = req.params;
  const thumbnailBuffer = await storage.getCharacterThumbnail(characterId);

  if (!thumbnailBuffer) {
    throw new AppError('Character has no thumbnail', 404);
  }

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
  res.send(thumbnailBuffer);
}));

// Get character medium thumbnail (256x384, 2:3 — for picker cards / floating avatar)
router.get('/:characterId/thumbnail-medium', asyncHandler(async (req, res) => {
  const { characterId } = req.params;
  const thumbnailBuffer = await storage.getCharacterThumbnailMedium(characterId);

  if (!thumbnailBuffer) {
    throw new AppError('Character has no medium thumbnail', 404);
  }

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
  res.send(thumbnailBuffer);
}));

// Get character data (JSON)
router.get('/:characterId/data', asyncHandler(async (req, res) => {
  const { characterId } = req.params;
  const cardData = await storage.getCharacter(characterId);

  res.json({ character: cardData });
}));

// Update character data
router.put('/:characterId', asyncHandler(async (req, res) => {
  const { characterId } = req.params;
  const { name, description, personality, scenario, first_mes, mes_example, system_prompt, alternate_greetings, ursceal_lorebook_id } = req.body;

  // Get existing character data
  const existingData = await storage.getCharacter(characterId);

  // Update fields
  if (name !== undefined) existingData.data.name = name.trim();
  if (description !== undefined) existingData.data.description = description.trim();
  if (personality !== undefined) existingData.data.personality = personality.trim();
  if (scenario !== undefined) existingData.data.scenario = scenario.trim();
  if (first_mes !== undefined) existingData.data.first_mes = first_mes.trim();
  if (mes_example !== undefined) existingData.data.mes_example = mes_example.trim();
  if (system_prompt !== undefined) existingData.data.system_prompt = system_prompt.trim();
  if (alternate_greetings !== undefined) existingData.data.alternate_greetings = alternate_greetings;

  // Update lorebook association
  if (ursceal_lorebook_id !== undefined) {
    if (!existingData.data.extensions) {
      existingData.data.extensions = {};
    }
    existingData.data.extensions.ursceal_lorebook_id = ursceal_lorebook_id || null;
  }

  // Save updated data (keep existing image)
  await storage.saveCharacter(characterId, existingData, null);

  // Cache any new external images in the updated fields
  await cacheCardImages(characterId, existingData, req.app.locals.dataRoot);

  res.json({
    id: characterId,
    name: existingData.data.name,
    description: existingData.data.description,
  });
}));

// Update character with new image
router.put('/:characterId/update-with-image', upload.single('image'), asyncHandler(async (req, res) => {
  const { characterId } = req.params;
  const characterDataJson = req.body.characterData;

  if (!characterDataJson) {
    throw new AppError('Character data is required', 400);
  }

  let parsedData;
  try {
    parsedData = JSON.parse(characterDataJson);
  } catch (error) {
    throw new AppError('Invalid character data JSON', 400);
  }

  // Get existing character data
  const existingData = await storage.getCharacter(characterId);

  // Update fields
  const { name, description, personality, scenario, first_mes, mes_example, system_prompt, alternate_greetings, ursceal_lorebook_id } = parsedData;

  if (name !== undefined) existingData.data.name = name.trim();
  if (description !== undefined) existingData.data.description = description.trim();
  if (personality !== undefined) existingData.data.personality = personality.trim();
  if (scenario !== undefined) existingData.data.scenario = scenario.trim();
  if (first_mes !== undefined) existingData.data.first_mes = first_mes.trim();
  if (mes_example !== undefined) existingData.data.mes_example = mes_example.trim();
  if (system_prompt !== undefined) existingData.data.system_prompt = system_prompt.trim();
  if (alternate_greetings !== undefined) existingData.data.alternate_greetings = alternate_greetings;

  // Update lorebook association
  if (ursceal_lorebook_id !== undefined) {
    if (!existingData.data.extensions) {
      existingData.data.extensions = {};
    }
    existingData.data.extensions.ursceal_lorebook_id = ursceal_lorebook_id || null;
  }

  // Save updated data with new image
  const imageBuffer = req.file ? req.file.buffer : null;
  await storage.saveCharacter(characterId, existingData, imageBuffer);

  // Cache any new external images in the updated fields
  await cacheCardImages(characterId, existingData, req.app.locals.dataRoot);

  const hasImage = await storage.hasCharacterImage(characterId);

  res.json({
    id: characterId,
    name: existingData.data.name,
    description: existingData.data.description,
    imageUrl: hasImage ? `/api/characters/${characterId}/image` : null,
  });
}));

// Get stories that include this character
router.get('/:characterId/stories', asyncHandler(async (req, res) => {
  const { characterId } = req.params;

  // Get all stories and filter for ones that include this character
  const allStories = await storage.listStories();
  const characterStories = allStories.filter(story =>
    story.characterIds?.includes(characterId) ||
    story.personaCharacterId === characterId
  );

  res.json({ stories: characterStories });
}));

// Delete character from global library
router.delete('/:characterId', asyncHandler(async (req, res) => {
  const { characterId } = req.params;

  // Check if character is used in any stories
  const allStories = await storage.listStories();
  const storiesUsingChar = allStories.filter(story =>
    story.characterIds?.includes(characterId) ||
    story.personaCharacterId === characterId
  );

  if (storiesUsingChar.length > 0) {
    const storyTitles = storiesUsingChar.map(s => s.title).join(', ');
    throw new AppError(
      `Cannot delete character: Used in ${storiesUsingChar.length} story(ies): ${storyTitles}. Remove from stories first.`,
      409
    );
  }

  await storage.deleteCharacter(characterId);

  // Clean up cached asset files
  try {
    const assetManager = new AssetManager(req.app.locals.dataRoot);
    await assetManager.deleteDir(characterId);
  } catch (error) {
    console.error(`Failed to clean up assets for character ${characterId}:`, error);
  }

  res.json({ success: true });
}));

/**
 * Refresh cached external images for a character.
 * Re-scans all text fields for external image URLs, downloads any that
 * aren't already cached, rewrites URLs in the card data, and saves.
 */
router.post('/:characterId/refresh-images', asyncHandler(async (req, res) => {
  const { characterId } = req.params;
  const dataRoot = req.app.locals.dataRoot;

  // Load existing character data
  const cardData = await storage.getCharacter(characterId);

  // Re-cache images: only new ones will be downloaded (already-cached skipped)
  const imageMap = await cacheCharacterImages(characterId, cardData, dataRoot);

  if (imageMap.size > 0) {
    // Rewrite URLs in card data for any newly cached images
    rewriteCharacterImageUrls(cardData, imageMap);

    // Persist updated card data (keep existing image blob)
    await storage.saveCharacter(characterId, cardData, null);

    res.json({
      success: true,
      imagesCached: imageMap.size,
      message: `Cached ${imageMap.size} new image(s)`,
    });
  } else {
    // No new images needed caching
    res.json({
      success: true,
      imagesCached: 0,
      message: 'All images already cached',
    });
  }
}));

export default router;
