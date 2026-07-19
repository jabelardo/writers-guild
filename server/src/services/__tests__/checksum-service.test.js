/**
 * Tests for Checksum Service
 *
 * Tests canonicalStringify normalization rules (allowlists, sorting,
 * circular reference detection) and checksum computation functions.
 */

import { describe, it, expect } from 'vitest';
import {
  canonicalStringify,
  computeCharacterChecksum,
  computeCharacterOriginChecksum,
  computeLorebookChecksum,
} from '../checksum-service.js';

// ─── canonicalStringify ───────────────────────────────────────────────

describe('canonicalStringify', () => {
  it('handles primitives', () => {
    expect(canonicalStringify(null)).toBe('null');
    expect(canonicalStringify(undefined)).toBe('null');
    expect(canonicalStringify('hello')).toBe('"hello"');
    expect(canonicalStringify(42)).toBe('42');
    expect(canonicalStringify(true)).toBe('true');
    expect(canonicalStringify(false)).toBe('false');
  });

  it('sorts object keys alphabetically', () => {
    const obj = { z: 1, a: 2, m: 3 };
    expect(canonicalStringify(obj)).toBe('{"a":2,"m":3,"z":1}');
  });

  it('produces stable output for equal objects regardless of key order', () => {
    const a = { name: 'Alice', age: 30 };
    const b = { age: 30, name: 'Alice' };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it('stringifies arrays deterministically', () => {
    expect(canonicalStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('stringifies nested objects', () => {
    const obj = { b: { y: 1, x: 2 }, a: 3 };
    expect(canonicalStringify(obj)).toBe('{"a":3,"b":{"x":2,"y":1}}');
  });

  it('strips keys not in the allowlist', () => {
    const obj = { name: 'Alice', secret: 'hunter2', age: 30 };
    const allow = new Set(['name', 'age']);
    expect(canonicalStringify(obj, allow)).toBe('{"age":30,"name":"Alice"}');
  });

  it('strips null and undefined values', () => {
    const obj = { a: 1, b: null, c: undefined, d: 'keep' };
    expect(canonicalStringify(obj)).toBe('{"a":1,"d":"keep"}');
  });

  it('handles empty objects', () => {
    expect(canonicalStringify({})).toBe('{}');
  });

  it('handles empty arrays', () => {
    expect(canonicalStringify([])).toBe('[]');
  });

  it('handles deeply nested structures', () => {
    const obj = { level1: { level2: { level3: { value: 42 } } } };
    expect(canonicalStringify(obj)).toBe('{"level1":{"level2":{"level3":{"value":42}}}}');
  });

  it('detects direct circular references', () => {
    const obj = {};
    obj.self = obj;
    expect(() => canonicalStringify(obj)).toThrow('Converting circular structure to JSON');
  });

  it('detects indirect circular references', () => {
    const a = {};
    const b = { ref: a };
    a.ref = b;
    expect(() => canonicalStringify(a)).toThrow('Converting circular structure to JSON');
  });

  it('handles non-circular shared references (same object at two keys)', () => {
    const shared = { x: 1 };
    const obj = { a: shared, b: shared };
    // Should not throw — shared reference is not circular
    const result = canonicalStringify(obj);
    expect(result).toBe('{"a":{"x":1},"b":{"x":1}}');
  });

  it('passes allowlist to all nesting levels', () => {
    const obj = { meta: { name: 'inner', hidden: true }, visible: 'keep' };
    const allow = new Set(['meta', 'visible']);
    // The allowlist filters at every depth, so 'name' and 'hidden' are stripped
    expect(canonicalStringify(obj, allow)).toBe('{"meta":{},"visible":"keep"}');
  });

  it('handles mixed arrays and objects', () => {
    const obj = { list: [{ id: 2 }, { id: 1 }], title: 'test' };
    const result = canonicalStringify(obj);
    // Array order is preserved, object keys are sorted
    expect(result).toBe('{"list":[{"id":2},{"id":1}],"title":"test"}');
  });
});

// ─── computeCharacterChecksum ─────────────────────────────────────────

describe('computeCharacterChecksum', () => {
  const baseCard = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Alice',
      description: 'A test character',
      personality: 'Curious',
      scenario: 'A test scenario',
      first_mes: 'Hello!',
      mes_example: 'Example dialogue.',
      system_prompt: '',
      post_history_instructions: '',
      tags: [],
      creator: '',
      character_version: '1.0',
      extensions: {},
    },
  };

  it('produces a consistent hex sha256 string', () => {
    const hash = computeCharacterChecksum(baseCard);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces the same hash for identical card data', () => {
    const hash1 = computeCharacterChecksum(baseCard);
    const hash2 = computeCharacterChecksum({ ...baseCard });
    expect(hash1).toBe(hash2);
  });

  it('produces a different hash when name changes', () => {
    const modified = {
      ...baseCard,
      data: { ...baseCard.data, name: 'Bob' },
    };
    expect(computeCharacterChecksum(modified)).not.toBe(computeCharacterChecksum(baseCard));
  });

  it('includes ursceal_lorebook_id in the checksum', () => {
    const withLorebook = {
      ...baseCard,
      data: {
        ...baseCard.data,
        extensions: { ursceal_lorebook_id: 'lb-123' },
      },
    };
    const without = {
      ...baseCard,
      data: {
        ...baseCard.data,
        extensions: {},
      },
    };
    expect(computeCharacterChecksum(withLorebook)).not.toBe(computeCharacterChecksum(without));
  });

  it('strips non-allowed extension keys', () => {
    const withExtra = {
      ...baseCard,
      data: {
        ...baseCard.data,
        extensions: { fav: true, _secret: 'hidden' },
      },
    };
    const justFav = {
      ...baseCard,
      data: {
        ...baseCard.data,
        extensions: { fav: true },
      },
    };
    // Both should produce the same hash since _secret is not in CHAR_EXT_ALLOWLIST
    expect(computeCharacterChecksum(withExtra)).toBe(computeCharacterChecksum(justFav));
  });

  it('ignores spec and spec_version fields', () => {
    const card1 = { ...baseCard, spec: 'chara_card_v2', spec_version: '2.0' };
    const card2 = { ...baseCard, spec: 'chara_card_v1', spec_version: '1.0' };
    expect(computeCharacterChecksum(card1)).toBe(computeCharacterChecksum(card2));
  });
});

// ─── computeCharacterOriginChecksum ───────────────────────────────────

describe('computeCharacterOriginChecksum', () => {
  const baseCard = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Alice',
      description: 'Test',
      extensions: { ursceal_lorebook_id: 'lb-123' },
    },
  };

  it('excludes ursceal_lorebook_id from the checksum', () => {
    const withLb = computeCharacterOriginChecksum(baseCard);
    const withoutLb = computeCharacterOriginChecksum({
      ...baseCard,
      data: { ...baseCard.data, extensions: {} },
    });
    // Origin checksum should be the same regardless of lorebook_id
    expect(withLb).toBe(withoutLb);
  });

  it('differs from computeCharacterChecksum when lorebook_id is present', () => {
    const origin = computeCharacterOriginChecksum(baseCard);
    const current = computeCharacterChecksum(baseCard);
    expect(origin).not.toBe(current);
  });

  it('matches computeCharacterChecksum when no lorebook_id is set', () => {
    const noLb = {
      ...baseCard,
      data: { ...baseCard.data, extensions: {} },
    };
    expect(computeCharacterOriginChecksum(noLb)).toBe(computeCharacterChecksum(noLb));
  });
});

// ─── computeLorebookChecksum ──────────────────────────────────────────

describe('computeLorebookChecksum', () => {
  const baseLorebook = {
    name: 'Test Lorebook',
    description: 'A test lorebook',
    scanDepth: 50,
    tokenBudget: 500,
    recursiveScanning: false,
    extensions: {},
    entries: [
      {
        keys: ['sword'],
        content: 'A mighty blade.',
        constant: false,
        position: 0,
        caseSensitive: false,
        matchWholeWords: false,
        useRegex: false,
        probability: 100,
        useProbability: false,
        depth: 0,
        scanDepth: 50,
        selective: false,
        selectiveLogic: 0,
        insertionOrder: 0,
        group: '',
        preventRecursion: false,
        delayUntilRecursion: false,
      },
    ],
  };

  it('produces a consistent hex sha256 string', () => {
    const hash = computeLorebookChecksum(baseLorebook);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces the same hash regardless of entry order', () => {
    const entry2 = { ...baseLorebook.entries[0], keys: ['shield'] };
    const lorebookAB = {
      ...baseLorebook,
      entries: [baseLorebook.entries[0], entry2],
    };
    const lorebookBA = {
      ...baseLorebook,
      entries: [entry2, baseLorebook.entries[0]],
    };
    expect(computeLorebookChecksum(lorebookAB)).toBe(computeLorebookChecksum(lorebookBA));
  });

  it('produces different hash when entry content changes', () => {
    const modified = {
      ...baseLorebook,
      entries: [{ ...baseLorebook.entries[0], content: 'A different blade.' }],
    };
    expect(computeLorebookChecksum(modified)).not.toBe(computeLorebookChecksum(baseLorebook));
  });

  it('filters out id and create_date from extensions', () => {
    const withMeta = {
      ...baseLorebook,
      extensions: { id: 123, create_date: '2024-01-01', custom: 'value' },
    };
    const without = {
      ...baseLorebook,
      extensions: { custom: 'value' },
    };
    expect(computeLorebookChecksum(withMeta)).toBe(computeLorebookChecksum(without));
  });

  it('handles empty entries array', () => {
    const empty = { ...baseLorebook, entries: [] };
    const hash = computeLorebookChecksum(empty);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
