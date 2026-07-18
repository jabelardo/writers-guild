/**
 * Asset Manager Service
 *
 * Manages per-entity asset directories under:
 *   {dataRoot}/public-assets/gallery/{entityType}/{entityId}/
 *
 * Each directory contains:
 *   - {hash}.{ext}         — downloaded image files named by content hash
 *   - metadata.json        — mapping of original URLs → hash → filename
 */

import fs from 'fs/promises';
import path from 'path';

const ASSETS_BASE = ['public-assets', 'gallery'];

export class AssetManager {
  /**
   * @param {string} dataRoot    — resolved data root path (e.g. ../data)
   * @param {string} [entityType] — subdirectory under gallery, e.g. 'characters' or 'lorebooks' (default 'characters')
   */
  constructor(dataRoot, entityType = 'characters') {
    this.dataRoot = dataRoot;
    this.entityType = entityType;
  }

  // ── Path helpers ────────────────────────────────────────────────────

  /**
   * Resolve an entity's asset directory, refusing anything that escapes the
   * gallery root. Entity ids reach this from request params in several places,
   * so containment is enforced here rather than at each call site.
   */
  entityDir(entityId) {
    const base = path.resolve(this.dataRoot, ...ASSETS_BASE, this.entityType);
    const dir = path.resolve(base, String(entityId ?? ''));
    if (dir !== base && !dir.startsWith(base + path.sep)) {
      throw new Error(`Invalid entity id: ${entityId}`);
    }
    if (dir === base) {
      throw new Error('Entity id is required');
    }
    return dir;
  }

  assetPath(entityId, filename) {
    return path.join(this.entityDir(entityId), filename);
  }

  metadataPath(entityId) {
    return path.join(this.entityDir(entityId), 'metadata.json');
  }

  // ── Backward-compatible aliases ─────────────────────────────────────

  characterDir(characterId) {
    return this.entityDir(characterId);
  }

  // ── Directory lifecycle ─────────────────────────────────────────────

  async ensureDir(entityId) {
    const dir = this.entityDir(entityId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async deleteDir(entityId) {
    const dir = this.entityDir(entityId);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async exists(entityId) {
    const dir = this.entityDir(entityId);
    try {
      await fs.access(dir);
      return true;
    } catch {
      return false;
    }
  }

  // ── Metadata ────────────────────────────────────────────────────────

  async readMetadata(entityId) {
    const mpath = this.metadataPath(entityId);
    try {
      const raw = await fs.readFile(mpath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return { images: [] };
    }
  }

  async writeMetadata(entityId, metadata) {
    const mpath = this.metadataPath(entityId);
    await this.ensureDir(entityId);
    await fs.writeFile(mpath, JSON.stringify(metadata, null, 2), 'utf8');
  }

  async addImageMetadata(entityId, entry) {
    const meta = await this.readMetadata(entityId);
    const existing = meta.images.find(i => i.originalUrl === entry.originalUrl);
    if (existing) {
      Object.assign(existing, entry);
    } else {
      meta.images.push(entry);
    }
    await this.writeMetadata(entityId, meta);
  }

  // ── File operations ─────────────────────────────────────────────────

  /**
   * Write a file and update metadata.json.
   * Safe for single writes; for bulk writes use writeFileOnly() + writeMetadata().
   */
  async writeAsset(entityId, filename, buffer, originalUrl, mimeType) {
    await this.writeFileOnly(entityId, filename, buffer);
    await this.addImageMetadata(entityId, {
      originalUrl,
      hash: path.parse(filename).name,
      filename,
      mimeType,
    });
  }

  /**
   * Write a file to the asset directory without touching metadata.
   * Useful when bulk-writing files before a single metadata write.
   */
  async writeFileOnly(entityId, filename, buffer) {
    await this.ensureDir(entityId);
    const filePath = this.assetPath(entityId, filename);
    await fs.writeFile(filePath, buffer);
  }

  async readAsset(entityId, filename) {
    const filePath = this.assetPath(entityId, filename);
    try {
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  async listAssets(entityId) {
    const dir = this.entityDir(entityId);
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries.filter(e => e.isFile() && e.name !== 'metadata.json').map(e => e.name);
    } catch {
      return [];
    }
  }
}