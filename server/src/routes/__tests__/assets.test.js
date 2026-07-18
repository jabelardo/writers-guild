import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import assetsRouter from '../assets.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { AssetManager } from '../../services/asset-manager.js';

// A real 64-char sha256-shaped name, matching what image-cacher produces.
const HASH = 'a'.repeat(64);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let dataRoot;
let app;

beforeEach(async () => {
  dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wg-assets-'));
  app = express();
  app.locals.dataRoot = dataRoot;
  app.use('/api/assets', assetsRouter);
  app.use(errorHandler);
});

afterEach(async () => {
  await fs.rm(dataRoot, { recursive: true, force: true });
});

describe('Assets API Routes', () => {
  describe('GET /api/assets/characters/:entityId/:filename', () => {
    it('serves a cached character asset with correct headers', async () => {
      const am = new AssetManager(dataRoot, 'characters');
      await am.writeFileOnly('char-1', `${HASH}.png`, PNG_BYTES);

      const res = await request(app).get(`/api/assets/characters/char-1/${HASH}.png`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-length']).toBe(String(PNG_BYTES.length));
      expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(Buffer.from(res.body)).toEqual(PNG_BYTES);
    });

    it('returns 404 when the asset does not exist', async () => {
      const res = await request(app).get(`/api/assets/characters/char-1/${HASH}.png`);
      expect(res.status).toBe(404);
    });

    it('serves webp assets', async () => {
      const am = new AssetManager(dataRoot, 'characters');
      await am.writeFileOnly('char-1', `${HASH}.webp`, PNG_BYTES);

      const res = await request(app).get(`/api/assets/characters/char-1/${HASH}.webp`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
    });
  });

  describe('GET /api/assets/lorebooks/:entityId/:filename', () => {
    it('serves lorebook assets from the lorebooks namespace', async () => {
      const am = new AssetManager(dataRoot, 'lorebooks');
      await am.writeFileOnly('lore-1', `${HASH}.png`, PNG_BYTES);

      const res = await request(app).get(`/api/assets/lorebooks/lore-1/${HASH}.png`);

      expect(res.status).toBe(200);
      expect(Buffer.from(res.body)).toEqual(PNG_BYTES);
    });

    it('does not resolve lorebook ids against the characters namespace', async () => {
      // Same id present only under characters/ must not be served as a lorebook.
      const am = new AssetManager(dataRoot, 'characters');
      await am.writeFileOnly('shared-id', `${HASH}.png`, PNG_BYTES);

      const res = await request(app).get(`/api/assets/lorebooks/shared-id/${HASH}.png`);

      expect(res.status).toBe(404);
    });
  });

  describe('path traversal', () => {
    it('rejects a traversing entity id', async () => {
      const res = await request(app).get(`/api/assets/characters/..%2F..%2F..%2Fetc/${HASH}.png`);
      expect(res.status).toBe(400);
    });

    it('rejects a traversing filename', async () => {
      const res = await request(app).get('/api/assets/characters/char-1/..%2F..%2Fsecret.png');
      expect(res.status).toBe(400);
    });

    it('does not read a file planted outside the gallery root', async () => {
      const outside = path.join(dataRoot, 'secret.png');
      await fs.writeFile(outside, PNG_BYTES);

      // ../../.. from characters/ lands back on dataRoot
      const res = await request(app).get('/api/assets/characters/..%2F..%2F..%2Fsecret.png/x.png');

      expect(res.status).toBe(400);
      // and the file is still only reachable on disk, never over HTTP
      await expect(fs.readFile(outside)).resolves.toEqual(PNG_BYTES);
    });
  });

  describe('filename validation', () => {
    it('rejects a non-image extension', async () => {
      const res = await request(app).get(`/api/assets/characters/char-1/${HASH}.txt`);
      expect(res.status).toBe(400);
    });

    it('rejects a filename that is not content-hash shaped', async () => {
      const res = await request(app).get('/api/assets/characters/char-1/notahash.png');
      expect(res.status).toBe(400);
    });
  });
});
