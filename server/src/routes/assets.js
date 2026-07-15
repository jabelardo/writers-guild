/**
 * Assets API Routes
 *
 * Serves locally cached character gallery assets.
 *
 * GET /api/assets/characters/:characterId/:filename
 *   — Serves the asset file with proper Content-Type and immutable caching.
 */

import express from 'express';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { AssetManager } from '../services/asset-manager.js';
import { mimeTypeFromExt } from '../../../shared/mime-types.js';
import path from 'path';

const router = express.Router();

/**
 * GET /api/assets/characters/:characterId/:filename
 *
 * Serve a cached asset file. Filename is content-hashed so we use
 * immutable caching: files never change once created.
 */
router.get(
  '/characters/:characterId/:filename',
  asyncHandler(async (req, res) => {
    const { characterId, filename } = req.params;
    return getAsset(req, res, characterId, filename, 'characters');
  })
);

/**
 * GET /api/assets/lorebooks/:lorebookId/:filename
 *
 * Serve a cached lorebook asset file (same immutable caching strategy).
 */
router.get(
  '/lorebooks/:lorebookId/:filename',
  asyncHandler(async (req, res) => {
    const { lorebookId, filename } = req.params;
    return getAsset(req, res, lorebookId, filename, 'lorebooks');
  })
);

const getAsset = async (req, res, assetId, filename, entityType) => {
  // Basic security: prevent directory traversal in filename
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new AppError('Invalid filename', 400);
  }

  // Only serve allowed image extensions
  const ext = path.extname(filename).toLowerCase();
  const mimeType = mimeTypeFromExt(ext);
  if (!mimeType) {
    throw new AppError(`Unsupported file type ${ext}`, 400);
  }

  const assetManager = new AssetManager(req.app.locals.dataRoot, entityType);
  const buffer = await assetManager.readAsset(assetId, filename);

  if (!buffer) {
    throw new AppError('Asset not found', 404);
  }

  // Content-hashed filenames are immutable
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  res.send(buffer);
};

export default router;
