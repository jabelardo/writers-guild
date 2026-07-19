/**
 * Global test setup.
 *
 * The image cacher's SSRF guard resolves every image host before fetching it
 * (see image-cacher.js). Left unmocked, any test whose fixture contains an
 * image URL performs a real DNS lookup — making the suite depend on outbound
 * network access and on the specific test hostnames existing. Tests using
 * hosts that do not resolve silently cache zero images and fail on assertions
 * that look unrelated to DNS.
 *
 * Resolve to a public address by default. Tests that care about the guard
 * itself (image-cacher.test.js) override per case with
 * `dns.lookup.mockResolvedValueOnce([...])`.
 */
import { vi } from 'vitest';

vi.mock('dns/promises', () => ({
  default: {
    lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
  },
}));

/**
 * Default fetch: refuse, loudly and instantly.
 *
 * Stubbing DNS alone is not enough — a host that "resolves" then gets fetched
 * for real, which is exactly what the lorebook import tests were doing. Any
 * test that genuinely needs a response assigns its own globalThis.fetch;
 * everything else fails fast here rather than reaching the network or hanging
 * on the cacher's 15s per-image timeout.
 *
 * Image caching is non-fatal by design, so imports under test still succeed —
 * they just cache nothing, which is what those tests actually assert.
 */
globalThis.fetch = vi.fn(async (url) => {
  throw new Error(`Unmocked network request in tests: ${url}`);
});
