/**
 * Tests for AssetManager service.
 *
 * Asset directories are created under:
 *   {tempDir}/public-assets/gallery/characters/{characterId}/
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { AssetManager } from '../asset-manager.js';

describe('AssetManager', () => {
  let tempDir;
  let assetManager;

  beforeEach(() => {
    tempDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'asset-manager-test-'));
    assetManager = new AssetManager(tempDir);
  });

  afterEach(async () => {
    // Clean up
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // ── Constructor ─────────────────────────────────────────────────────

  describe('constructor', () => {
    it('should store dataRoot', () => {
      expect(assetManager.dataRoot).toBe(tempDir);
    });
  });

  // ── Path helpers ────────────────────────────────────────────────────

  describe('characterDir', () => {
    it('should return the correct directory path', () => {
      const dir = assetManager.characterDir('char-123');
      expect(dir).toBe(path.join(tempDir, 'public-assets', 'gallery', 'characters', 'char-123'));
    });
  });

  describe('assetPath', () => {
    it('should return the correct file path', () => {
      const filePath = assetManager.assetPath('char-123', 'abc.png');
      expect(filePath).toBe(
        path.join(tempDir, 'public-assets', 'gallery', 'characters', 'char-123', 'abc.png')
      );
    });
  });

  describe('metadataPath', () => {
    it('should return the metadata.json path', () => {
      const mpath = assetManager.metadataPath('char-123');
      expect(mpath).toBe(
        path.join(tempDir, 'public-assets', 'gallery', 'characters', 'char-123', 'metadata.json')
      );
    });
  });

  // ── Directory lifecycle ─────────────────────────────────────────────

  describe('ensureDir', () => {
    it('should create the character directory recursively', async () => {
      const dir = await assetManager.ensureDir('char-1');
      await expect(fs.access(dir)).resolves.toBeUndefined();
    });

    it('should be idempotent (calling twice does not throw)', async () => {
      await assetManager.ensureDir('char-1');
      await expect(assetManager.ensureDir('char-1')).resolves.toBeDefined();
    });
  });

  describe('deleteDir', () => {
    it('should delete an existing character directory', async () => {
      await assetManager.ensureDir('char-2');
      await assetManager.deleteDir('char-2');

      const dir = assetManager.characterDir('char-2');
      await expect(fs.access(dir)).rejects.toThrow();
    });

    it('should not throw when deleting a non-existent directory', async () => {
      await expect(assetManager.deleteDir('non-existent')).resolves.toBeUndefined();
    });
  });

  describe('exists', () => {
    it('should return true when the character directory exists', async () => {
      await assetManager.ensureDir('char-3');
      await expect(assetManager.exists('char-3')).resolves.toBe(true);
    });

    it('should return false when the character directory does not exist', async () => {
      await expect(assetManager.exists('non-existent')).resolves.toBe(false);
    });
  });

  // ── Metadata operations ─────────────────────────────────────────────

  describe('readMetadata', () => {
    it('should return default metadata when no file exists', async () => {
      const meta = await assetManager.readMetadata('no-meta-char');
      expect(meta).toEqual({ images: [] });
    });

    it('should return previously written metadata', async () => {
      const testMeta = {
        images: [
          {
            originalUrl: 'http://example.com/img.png',
            hash: 'abc',
            filename: 'abc.png',
            mimeType: 'image/png'
          }
        ]
      };
      await assetManager.writeMetadata('meta-char', testMeta);

      const meta = await assetManager.readMetadata('meta-char');
      expect(meta).toEqual(testMeta);
    });
  });

  describe('writeMetadata', () => {
    it('should create the directory and write metadata.json', async () => {
      const testMeta = { images: [] };
      await assetManager.writeMetadata('write-char', testMeta);

      const mpath = assetManager.metadataPath('write-char');
      const raw = await fs.readFile(mpath, 'utf8');
      expect(JSON.parse(raw)).toEqual(testMeta);
    });
  });

  describe('addImageMetadata', () => {
    it('should add a new image entry to metadata', async () => {
      const entry = {
        originalUrl: 'http://example.com/a.png',
        hash: 'aaa',
        filename: 'aaa.png',
        mimeType: 'image/png'
      };
      await assetManager.addImageMetadata('add-char', entry);

      const meta = await assetManager.readMetadata('add-char');
      expect(meta.images).toHaveLength(1);
      expect(meta.images[0]).toEqual(entry);
    });

    it('should update an existing image entry with the same originalUrl', async () => {
      const entry = {
        originalUrl: 'http://example.com/a.png',
        hash: 'aaa',
        filename: 'aaa.png',
        mimeType: 'image/png'
      };
      await assetManager.addImageMetadata('update-char', entry);

      const updatedEntry = {
        originalUrl: 'http://example.com/a.png',
        hash: 'bbb',
        filename: 'bbb.png',
        mimeType: 'image/webp'
      };
      await assetManager.addImageMetadata('update-char', updatedEntry);

      const meta = await assetManager.readMetadata('update-char');
      expect(meta.images).toHaveLength(1);
      expect(meta.images[0].hash).toBe('bbb');
      expect(meta.images[0].filename).toBe('bbb.png');
      expect(meta.images[0].mimeType).toBe('image/webp');
    });

    it('should handle multiple distinct image entries', async () => {
      await assetManager.addImageMetadata('multi-char', {
        originalUrl: 'http://example.com/1.png',
        hash: '1',
        filename: '1.png',
        mimeType: 'image/png'
      });
      await assetManager.addImageMetadata('multi-char', {
        originalUrl: 'http://example.com/2.png',
        hash: '2',
        filename: '2.png',
        mimeType: 'image/png'
      });

      const meta = await assetManager.readMetadata('multi-char');
      expect(meta.images).toHaveLength(2);
    });
  });

  // ── File operations ─────────────────────────────────────────────────

  describe('writeFileOnly', () => {
    it('should write a file to the asset directory', async () => {
      const buffer = Buffer.from('hello');
      await assetManager.writeFileOnly('wf-char', 'test.txt', buffer);

      const filePath = assetManager.assetPath('wf-char', 'test.txt');
      const content = await fs.readFile(filePath);
      expect(content.toString()).toBe('hello');
    });

    it('should create the directory if it does not exist', async () => {
      const buffer = Buffer.from('data');
      await assetManager.writeFileOnly('new-char', 'data.bin', buffer);

      const dir = assetManager.characterDir('new-char');
      await expect(fs.access(dir)).resolves.toBeUndefined();
    });
  });

  describe('writeAsset', () => {
    it('should write the file and add metadata entry', async () => {
      const buffer = Buffer.from('image data');
      await assetManager.writeAsset(
        'wa-char',
        'abc123.png',
        buffer,
        'http://example.com/img.png',
        'image/png'
      );

      // File exists
      const filePath = assetManager.assetPath('wa-char', 'abc123.png');
      const content = await fs.readFile(filePath);
      expect(content.toString()).toBe('image data');

      // Metadata updated
      const meta = await assetManager.readMetadata('wa-char');
      expect(meta.images).toHaveLength(1);
      expect(meta.images[0]).toMatchObject({
        originalUrl: 'http://example.com/img.png',
        hash: 'abc123',
        filename: 'abc123.png',
        mimeType: 'image/png'
      });
    });
  });

  describe('readAsset', () => {
    it('should return the file buffer when it exists', async () => {
      const buffer = Buffer.from('file content');
      await assetManager.writeFileOnly('ra-char', 'data.txt', buffer);

      const result = await assetManager.readAsset('ra-char', 'data.txt');
      expect(result).toBeDefined();
      expect(result.toString()).toBe('file content');
    });

    it('should return null when the file does not exist', async () => {
      const result = await assetManager.readAsset('ra-char', 'nonexistent.txt');
      expect(result).toBeNull();
    });
  });

  describe('listAssets', () => {
    it('should return an empty array when no files exist', async () => {
      const files = await assetManager.listAssets('empty-char');
      expect(files).toEqual([]);
    });

    it('should return file names excluding metadata.json', async () => {
      await assetManager.writeFileOnly('list-char', 'img1.png', Buffer.from('1'));
      await assetManager.writeFileOnly('list-char', 'img2.png', Buffer.from('2'));
      await assetManager.writeMetadata('list-char', { images: [] });

      const files = await assetManager.listAssets('list-char');
      expect(files).toEqual(expect.arrayContaining(['img1.png', 'img2.png']));
      expect(files).not.toContain('metadata.json');
    });

    it('should return an empty array when character directory does not exist', async () => {
      const files = await assetManager.listAssets('non-existent');
      expect(files).toEqual([]);
    });
  });
});
