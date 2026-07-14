import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ImagePreserver } from '../image-preserver.js';

describe('ImagePreserver', () => {
  let preserver;

  beforeEach(() => {
    preserver = new ImagePreserver();
  });

  describe('preserve', () => {
    it('should return null/undefined input as-is', () => {
      expect(preserver.preserve(null)).toBeNull();
      expect(preserver.preserve(undefined)).toBeUndefined();
    });

    it('should return empty string for empty input', () => {
      expect(preserver.preserve('')).toBe('');
    });

    it('should return text unchanged when no images are present', () => {
      const text = 'Just a plain story with no images.';
      const result = preserver.preserve(text);
      expect(result).toBe(text);
      expect(preserver.saved).toEqual([]);
    });

    it('should replace a markdown image with a placeholder', () => {
      const text = 'Hello ![world](https://example.com/img.png) end.';
      const result = preserver.preserve(text);
      expect(result).toBe('Hello [WG_IMAGE_0] end.');
      expect(preserver.saved).toHaveLength(1);
      expect(preserver.saved[0]).toEqual({
        original: '![world](https://example.com/img.png)',
        placeholder: '[WG_IMAGE_0]',
        type: 'markdown'
      });
    });

    it('should replace markdown images with whitespace between ] and (', () => {
      const text = '![alt] (https://example.com/img.png)';
      const result = preserver.preserve(text);
      expect(result).toBe('[WG_IMAGE_0]');
      expect(preserver.saved[0].type).toBe('markdown');
    });

    it('should replace markdown images with alt text containing special characters', () => {
      const text = '![Photo of a cat & dog!](https://example.com/pets.jpg)';
      const result = preserver.preserve(text);
      expect(result).toBe('[WG_IMAGE_0]');
      expect(preserver.saved[0].original).toBe(text);
    });

    it('should handle URLs with parentheses', () => {
      const text = '![File](https://example.com/File_(2020).jpg)';
      const result = preserver.preserve(text);
      expect(result).toBe('[WG_IMAGE_0]');
    });

    it('should replace an HTML img tag with a placeholder', () => {
      const text = 'Look: <img src="photo.jpg" alt="A photo"> cool.';
      const result = preserver.preserve(text);
      expect(result).toBe('Look: [WG_IMAGE_0] cool.');
      expect(preserver.saved).toHaveLength(1);
      expect(preserver.saved[0]).toEqual({
        original: '<img src="photo.jpg" alt="A photo">',
        placeholder: '[WG_IMAGE_0]',
        type: 'html'
      });
    });

    it('should replace HTML img tags with various attributes', () => {
      const text = '<img src="img.png" width="100" height="50" class="float-left">';
      const result = preserver.preserve(text);
      expect(result).toBe('[WG_IMAGE_0]');
      expect(preserver.saved[0].type).toBe('html');
    });

    it('should handle self-closing HTML img tags', () => {
      const text = '<img src="icon.svg" />';
      const result = preserver.preserve(text);
      expect(result).toBe('[WG_IMAGE_0]');
    });

    it('should replace both markdown and HTML images in the same text', () => {
      const text = 'MD: ![a](1.png) and HTML: <img src="2.jpg"> done.';
      const result = preserver.preserve(text);
      expect(result).toBe('MD: [WG_IMAGE_0] and HTML: [WG_IMAGE_1] done.');
      expect(preserver.saved).toHaveLength(2);
      expect(preserver.saved[0].type).toBe('markdown');
      expect(preserver.saved[1].type).toBe('html');
    });

    it('should assign sequential placeholders for multiple images', () => {
      const text = '![1](a.png) ![2](b.png) ![3](c.png)';
      const result = preserver.preserve(text);
      expect(result).toBe('[WG_IMAGE_0] [WG_IMAGE_1] [WG_IMAGE_2]');
      expect(preserver.saved).toHaveLength(3);
      expect(preserver.saved[0].original).toBe('![1](a.png)');
      expect(preserver.saved[1].original).toBe('![2](b.png)');
      expect(preserver.saved[2].original).toBe('![3](c.png)');
    });

    it('should clear saved state on each call', () => {
      preserver.preserve('![first](1.png)');
      expect(preserver.saved).toHaveLength(1);

      preserver.preserve('![second](2.png)');
      expect(preserver.saved).toHaveLength(1);
      expect(preserver.saved[0].original).toBe('![second](2.png)');
    });

    it('should handle images embedded within surrounding text', () => {
      const text = 'Before text. ![img](photo.png) After text.';
      const result = preserver.preserve(text);
      expect(result).toBe('Before text. [WG_IMAGE_0] After text.');
    });
  });

  describe('restore', () => {
    it('should return empty result for null/undefined response', () => {
      preserver.preserve('![img](a.png)');
      const r1 = preserver.restore(null);
      expect(r1.text).toBe('');
      expect(r1.missing).toHaveLength(1);

      const r2 = preserver.restore(undefined);
      expect(r2.text).toBe('');
      expect(r2.missing).toHaveLength(1);
    });

    it('should return empty string for empty response', () => {
      preserver.preserve('![img](a.png)');
      const result = preserver.restore('');
      expect(result.text).toBe('');
      expect(result.missing).toHaveLength(1);
    });

    it('should return response unchanged when no placeholders are present', () => {
      preserver.preserve('![img](a.png)');
      const result = preserver.restore('The LLM replied with this text.');
      expect(result.text).toBe('The LLM replied with this text.');
      expect(result.missing).toHaveLength(1);
      expect(result.missing[0].original).toBe('![img](a.png)');
    });

    it('should restore a single placeholder', () => {
      const text = preserver.preserve('Hello ![img](photo.png) world.');
      const result = preserver.restore('LLM kept [WG_IMAGE_0] in response.');
      expect(result.text).toBe('LLM kept ![img](photo.png) in response.');
      expect(result.missing).toHaveLength(0);
    });

    it('should restore multiple placeholders in order', () => {
      preserver.preserve('![a](1.png) and ![b](2.png) and ![c](3.png)');
      const result = preserver.restore('[WG_IMAGE_0] - [WG_IMAGE_1] - [WG_IMAGE_2]');
      expect(result.text).toBe('![a](1.png) - ![b](2.png) - ![c](3.png)');
      expect(result.missing).toHaveLength(0);
    });

    it('should remove duplicate placeholders after first occurrence', () => {
      preserver.preserve('![img](photo.png)');
      const result = preserver.restore('[WG_IMAGE_0] and [WG_IMAGE_0] again');
      // First occurrence restored, second removed
      expect(result.text).toBe('![img](photo.png) and  again');
      expect(result.missing).toHaveLength(0);
    });

    it('should report missing placeholders that the LLM dropped', () => {
      preserver.preserve('![a](1.png) keep ![b](2.png) drop');
      const result = preserver.restore('Only [WG_IMAGE_0] survives.');
      expect(result.text).toBe('Only ![a](1.png) survives.');
      expect(result.missing).toHaveLength(1);
      expect(result.missing[0].original).toBe('![b](2.png)');
      expect(result.missing[0].placeholder).toBe('[WG_IMAGE_1]');
    });

    it('should leave non-WG placeholders unchanged', () => {
      preserver.preserve('![img](photo.png)');
      const result = preserver.restore('[WG_IMAGE_0] and [OTHER_TOKEN]');
      expect(result.text).toBe('![img](photo.png) and [OTHER_TOKEN]');
    });

    it('should handle multiple images with some missing', () => {
      preserver.preserve('![1](a.png) ![2](b.png) ![3](c.png)');
      const result = preserver.restore('[WG_IMAGE_0] and [WG_IMAGE_2]');
      expect(result.text).toBe('![1](a.png) and ![3](c.png)');
      expect(result.missing).toHaveLength(1);
      expect(result.missing[0].original).toBe('![2](b.png)');
    });

    it('should replace placeholders with HTML images correctly', () => {
      preserver.preserve('<img src="photo.jpg" alt="test">');
      const result = preserver.restore('Image: [WG_IMAGE_0]');
      expect(result.text).toBe('Image: <img src="photo.jpg" alt="test">');
      expect(result.missing).toHaveLength(0);
    });
  });

  describe('restoreImages', () => {
    it('should return empty content for null/empty LLM response', () => {
      preserver.preserve('![img](a.png)');
      const r1 = preserver.restoreImages(null);
      expect(r1.finalContent).toBe('');
      expect(r1.imagesRestored).toBe(false);
      expect(r1.imagesPreserved).toBe(0);
      expect(r1.imagesMissing).toBe(0);

      const r2 = preserver.restoreImages('');
      expect(r2.finalContent).toBe('');
      expect(r2.imagesRestored).toBe(false);
    });

    it('should return no restoration when no images were preserved', () => {
      const result = preserver.restoreImages('Some LLM response');
      expect(result.finalContent).toBe('Some LLM response');
      expect(result.imagesRestored).toBe(false);
      expect(result.imagesPreserved).toBe(0);
      expect(result.imagesMissing).toBe(0);
    });

    it('should restore and report success when all images survive', () => {
      preserver.preserve('![img](photo.png)');
      const result = preserver.restoreImages('[WG_IMAGE_0] still here');
      expect(result.finalContent).toBe('![img](photo.png) still here');
      expect(result.imagesRestored).toBe(true);
      expect(result.imagesPreserved).toBe(1);
      expect(result.imagesMissing).toBe(0);
    });

    it('should append missing images at the end of the content', () => {
      preserver.preserve('![a](1.png) kept ![b](2.png) lost');
      const result = preserver.restoreImages('[WG_IMAGE_0] survives');
      expect(result.finalContent).toContain('survives');
      expect(result.finalContent).toContain('![b](2.png)');
      // ![a](1.png) was restored from [WG_IMAGE_0] so it appears in content
      expect(result.finalContent).toContain('![a](1.png)');
      expect(result.imagesMissing).toBe(1);
    });

    it('should append multiple missing images separated by newlines', () => {
      preserver.preserve('![a](1.png) ![b](2.png) ![c](3.png)');
      const result = preserver.restoreImages('Nothing survives');
      expect(result.imagesMissing).toBe(3);
      expect(result.finalContent).toContain('![a](1.png)');
      expect(result.finalContent).toContain('![b](2.png)');
      expect(result.finalContent).toContain('![c](3.png)');
      // They should be on new lines after the content
      const lines = result.finalContent.split('\n');
      expect(lines[0]).toBe('Nothing survives');
      expect(lines[2]).toBe('![a](1.png)');
      expect(lines[3]).toBe('![b](2.png)');
      expect(lines[4]).toBe('![c](3.png)');
    });

    it('should handle whitespace-only LLM responses', () => {
      preserver.preserve('![img](photo.png)');
      const result = preserver.restoreImages('   ');
      expect(result.imagesRestored).toBe(false);
      expect(result.imagesPreserved).toBe(0);
      expect(result.imagesMissing).toBe(0);
      expect(result.finalContent).toBe('   ');
    });

    it('should restore both markdown and HTML images together', () => {
      preserver.preserve('MD: ![a](1.png) and HTML: <img src="2.jpg">');
      const result = preserver.restoreImages('[WG_IMAGE_0] + [WG_IMAGE_1]');
      expect(result.finalContent).toBe('![a](1.png) + <img src="2.jpg">');
      expect(result.imagesRestored).toBe(true);
      expect(result.imagesPreserved).toBe(2);
      expect(result.imagesMissing).toBe(0);
    });

    it('should only append missing images in restoreImages (not duplicates)', () => {
      preserver.preserve('![img](photo.png)');
      const result = preserver.restoreImages('[WG_IMAGE_0] and [WG_IMAGE_0] again');
      // First occurrence restored, second removed, no missing
      expect(result.imagesMissing).toBe(0);
      expect(result.finalContent).toBe('![img](photo.png) and  again');
    });
  });

  describe('Edge Cases', () => {
    it('should preserve state isolation between instances', () => {
      const p1 = new ImagePreserver();
      const p2 = new ImagePreserver();

      p1.preserve('![a](1.png)');
      p2.preserve('![b](2.png)');

      expect(p1.saved).toHaveLength(1);
      expect(p1.saved[0].original).toBe('![a](1.png)');
      expect(p2.saved[0].original).toBe('![b](2.png)');
    });

    it('should handle text with no images through preserve-restore cycle', () => {
      const text = 'Just plain text without any images.';
      const preserved = preserver.preserve(text);
      expect(preserved).toBe(text);

      const result = preserver.restore('LLM responded with some text.');
      expect(result.text).toBe('LLM responded with some text.');
      expect(result.missing).toEqual([]);
    });

    it('should handle restorations in sequence after multiple preserve calls', () => {
      // First round
      preserver.preserve('![a](1.png)');
      const r1 = preserver.restore('[WG_IMAGE_0]');
      expect(r1.text).toBe('![a](1.png)');

      // Second round with new state
      preserver.preserve('![b](2.png)');
      const r2 = preserver.restore('[WG_IMAGE_0]');
      expect(r2.text).toBe('![b](2.png)');
      // Old placeholder from first round should not be in saved anymore
      expect(r2.missing).toHaveLength(0);
    });

    it('should preserve placeholders with multi-digit indices', () => {
      // Generate enough images to test multi-digit indices
      let text = '';
      const expectedPlaceholders = [];
      for (let i = 0; i < 12; i++) {
        if (i > 0) text += ' ';
        text += `![${i}](img${i}.png)`;
        expectedPlaceholders.push(`[WG_IMAGE_${i}]`);
      }

      const preserved = preserver.preserve(text);
      expect(preserved).toBe(expectedPlaceholders.join(' '));

      // Restore all 12
      const llmResponse = expectedPlaceholders.join(' - ');
      const result = preserver.restore(llmResponse);
      const expectedOriginals = [];
      for (let i = 0; i < 12; i++) {
        expectedOriginals.push(`![${i}](img${i}.png)`);
      }
      expect(result.text).toBe(expectedOriginals.join(' - '));
      expect(result.missing).toHaveLength(0);
    });

    it('should log restore info to console', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      preserver.preserve('![a](1.png) ![b](2.png)');
      preserver.restoreImages('[WG_IMAGE_0] only');
      expect(consoleSpy).toHaveBeenCalledWith('[ImagePreserver] Restored 2 image(s), 1 missing');
      consoleSpy.mockRestore();
    });
  });
});
