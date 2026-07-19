/**
 * Test helpers for creating test data
 */

import { PNG } from 'pngjs';

/**
 * Create a minimal valid PNG buffer for testing
 * @returns {Buffer} PNG image buffer
 */
export function createTestPng(width = 10, height = 10) {
  const png = new PNG({ width, height });

  // Fill with a simple pattern (white pixels)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      png.data[idx] = 255; // R
      png.data[idx + 1] = 255; // G
      png.data[idx + 2] = 255; // B
      png.data[idx + 3] = 255; // A
    }
  }

  return PNG.sync.write(png);
}

/**
 * PNG file signature (first 8 bytes)
 */
export const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Create a test character card PNG (PNG with character data embedded)
 * @param {Object} characterData - Character data to embed
 * @returns {Promise<Buffer>} PNG buffer with embedded data
 */
export async function createTestCharacterPng(characterData = {}) {
  const { CharacterParser } = await import('../../services/character-parser.js');

  const defaultData = {
    name: 'Test Character',
    description: 'A test character',
    first_mes: 'Hello!',
    ...characterData,
  };

  return CharacterParser.createPNGWithCharacterData(defaultData);
}

/**
 * Create a test character JSON object
 * @param {Object} overrides - Fields to override
 * @returns {Object} Character data object
 */
export function createTestCharacterJson(overrides = {}) {
  return {
    name: 'Test Character',
    description: 'A test character for testing',
    personality: 'Friendly and helpful',
    scenario: 'In a test environment',
    first_mes: 'Hello, I am a test character!',
    mes_example: '',
    ...overrides,
  };
}
