/**
 * Asset Manager Service
 *
 * Manages per-character asset directories under:
 *   {dataRoot}/public-assets/gallery/characters/{characterId}/
 *
 * Each directory contains:
 *   - {hash}.{ext}         — downloaded image files named by content hash
 *   - metadata.json        — mapping of original URLs → hash → filename
 */

import fs from 'fs/promises';
import path from 'path';

const ASSETS_BASE = ['public-assets', 'gallery', 'characters'];

export class AssetManager {
  /**
   * @param {string} dataRoot  — resolved data root path (e.g. ../data)
   */
  constructor(dataRoot) {
    this.dataRoot = dataRoot;
  }

  // ── Path helpers ────────────────────────────────────────────────────

  characterDir(characterId) {
    return path.join(this.dataRoot, ...ASSETS_BASE, characterId);
  }

  assetPath(characterId, filename) {
    return path.join(this.characterDir(characterId), filename);
  }

  metadataPath(characterId) {
    return path.join(this.characterDir(characterId), 'metadata.json');
  }

  // ── Directory lifecycle ─────────────────────────────────────────────

  async ensureDir(characterId) {
    const dir = this.characterDir(characterId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async deleteDir(characterId) {
    const dir = this.characterDir(characterId);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async exists(characterId) {
    const dir = this.characterDir(characterId);
    try {
      await fs.access(dir);
      return true;
    } catch {
      return false;
    }
  }

  // ── Metadata ────────────────────────────────────────────────────────

  async readMetadata(characterId) {
    const mpath = this.metadataPath(characterId);
    try {
      const raw = await fs.readFile(mpath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return { images: [] };
    }
  }

  async writeMetadata(characterId, metadata) {
    const mpath = this.metadataPath(characterId);
    await this.ensureDir(characterId);
    await fs.writeFile(mpath, JSON.stringify(metadata, null, 2), 'utf8');
  }

  async addImageMetadata(characterId, entry) {
    const meta = await this.readMetadata(characterId);
    const existing = meta.images.find(i => i.originalUrl === entry.originalUrl);
    if (existing) {
      Object.assign(existing, entry);
    } else {
      meta.images.push(entry);
    }
    await this.writeMetadata(characterId, meta);
  }

  // ── File operations ─────────────────────────────────────────────────

  /**
   * Write a file and update metadata.json.
   * Safe for single writes; for bulk writes use writeFileOnly() + writeMetadata().
   */
  async writeAsset(characterId, filename, buffer, originalUrl, mimeType) {
    await this.writeFileOnly(characterId, filename, buffer);
    await this.addImageMetadata(characterId, {
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
  async writeFileOnly(characterId, filename, buffer) {
    await this.ensureDir(characterId);
    const filePath = this.assetPath(characterId, filename);
    await fs.writeFile(filePath, buffer);
  }

  async readAsset(characterId, filename) {
    const filePath = this.assetPath(characterId, filename);
    try {
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  async listAssets(characterId) {
    const dir = this.characterDir(characterId);
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries.filter(e => e.isFile() && e.name !== 'metadata.json').map(e => e.name);
    } catch {
      return [];
    }
  }
}