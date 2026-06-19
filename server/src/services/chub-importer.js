/**
 * CHUB Character Importer Service
 *
 * Fetches character data from CHUB API and downloads character images.
 */

import { CharacterParser } from './character-parser.js';

export class ChubImporter {
  /**
   * Extract character path from CHUB URL
   * @param {string} url - CHUB character URL
   * @returns {string|null} Character path or null if invalid
   */
  static extractCharacterPath(url) {
    // Handle both character page URLs and API URLs
    const patterns = [
      /chub\.ai\/characters\/(.+)/,
      /api\.chub\.ai\/api\/characters\/(.+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Fetch character data from CHUB API
   * @param {string} url - CHUB character URL
   * @returns {Promise<Object>} Character data
   */
  static async fetchCharacter(url) {
    const characterPath = this.extractCharacterPath(url);

    if (!characterPath) {
      throw new Error('Invalid CHUB URL. Expected format: https://chub.ai/characters/...');
    }

    const apiUrl = `https://api.chub.ai/api/characters/${characterPath}`;

    try {
      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://chub.ai/',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Character not found on CHUB');
        }
        throw new Error(`CHUB API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      if (error.message.includes('CHUB')) {
        throw error;
      }
      throw new Error(`Failed to fetch from CHUB: ${error.message}`);
    }
  }

  /**
   * Download character card PNG from CHUB avatar CDN
   * CHUB V2/V3 cards embed full character JSON in PNG tEXt chunks,
   * so the PNG serves as both the image and the data source.
   * @param {string} fullPath - Character's full path on CHUB
   * @returns {Promise<Buffer>} PNG buffer containing both image and embedded character data
   */
  static async downloadCardPng(fullPath) {
    const url = `https://avatars.charhub.io/avatars/${fullPath}/chara_card_v2.png`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': 'https://chub.ai/',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download character card: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Download character image
   * @param {string} imageUrl - Image URL
   * @returns {Promise<Buffer>} Image data as buffer
   */
  static async downloadImage(imageUrl) {
    try {
      const response = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://chub.ai/',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return buffer;
    } catch (error) {
      throw new Error(`Image download failed: ${error.message}`);
    }
  }

  /**
   * Import character from CHUB URL
   *
   * Uses the chara_card_v2.png download as both the data source and the image.
   * CHUB V2/V3 character cards embed the full JSON metadata in PNG tEXt chunks,
   * so we parse the PNG directly instead of hitting the now-deprecated GitLab gateway.
   *
   * @param {string} url - CHUB character URL
   * @returns {Promise<Object>} Object with character data and image buffer
   */
  static async importFromUrl(url) {
    // Fetch character metadata from API (gives us the fullPath)
    const chubData = await this.fetchCharacter(url);

    const fullPath = chubData.node?.full_path || chubData.node?.fullPath;

    if (!fullPath) {
      throw new Error('No character path available');
    }

    // Download the character card PNG — it contains embedded JSON metadata
    // (CHUB uses V2/V3 character cards where JSON is stored in PNG tEXt chunks)
    const imageBuffer = await this.downloadCardPng(fullPath);

    // Parse the embedded character data from the PNG
    const rawData = await CharacterParser.parseCard(imageBuffer);
    const characterData = CharacterParser.normalizeCardData(rawData);

    // Log lorebook status
    const hasLorebook = characterData.data?.character_book &&
                       characterData.data.character_book.entries &&
                       characterData.data.character_book.entries.length > 0;
    if (hasLorebook) {
      console.log(`[CHUB Import] Imported character with ${characterData.data.character_book.entries.length} lorebook entries`);
    }

    return {
      characterData,
      imageBuffer,
      imageMimetype: 'image/png',
    };
  }
}