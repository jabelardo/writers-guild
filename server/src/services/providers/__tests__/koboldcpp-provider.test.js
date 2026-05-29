import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KoboldCppProvider } from '../koboldcpp-provider.js';

function streamFrom(chunks) {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });
}

async function collectStream(asyncIter) {
  const out = [];
  for await (const v of asyncIter) out.push(v);
  return out;
}

describe('KoboldCppProvider', () => {
  let provider;
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    provider = new KoboldCppProvider({ baseURL: 'http://localhost:5001' });
  });

  describe('Configuration', () => {
    it('defaults baseURL to http://localhost:5001 (after /api normalization)', () => {
      const p = new KoboldCppProvider({});
      expect(p.baseURL).toBe('http://localhost:5001');
    });

    it('strips trailing slashes from baseURL', () => {
      const p = new KoboldCppProvider({ baseURL: 'http://example.com:5001//' });
      expect(p.baseURL).toBe('http://example.com:5001');
    });

    it('strips trailing /api so users can paste either form', () => {
      const withApi = new KoboldCppProvider({ baseURL: 'http://192.168.1.157:5001/api' });
      const withoutApi = new KoboldCppProvider({ baseURL: 'http://192.168.1.157:5001' });
      expect(withApi.baseURL).toBe('http://192.168.1.157:5001');
      expect(withoutApi.baseURL).toBe('http://192.168.1.157:5001');
    });

    it('strips trailing /api/ with trailing slash', () => {
      const p = new KoboldCppProvider({ baseURL: 'http://localhost:5001/api/' });
      expect(p.baseURL).toBe('http://localhost:5001');
    });

    it('stores password when provided', () => {
      const p = new KoboldCppProvider({ password: 'secret' });
      expect(p.password).toBe('secret');
    });

    it('defaults password to empty string', () => {
      expect(provider.password).toBe('');
    });
  });

  describe('Capabilities', () => {
    it('reports streaming true, reasoning/vision false', () => {
      const caps = provider.getCapabilities();
      expect(caps.streaming).toBe(true);
      expect(caps.reasoning).toBe(false);
      expect(caps.visionAPI).toBe(false);
    });
  });

  describe('Validation', () => {
    it('passes when baseURL is set (no apiKey required)', () => {
      expect(provider.validateConfig()).toEqual({ valid: true });
    });

    it('fails when baseURL is empty', () => {
      const p = new KoboldCppProvider({ baseURL: '   ' });
      const result = p.validateConfig();
      expect(result.valid).toBe(false);
    });
  });

  describe('Auth Headers', () => {
    it('omits Authorization when no password', () => {
      const headers = provider.authHeaders();
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBeUndefined();
    });

    it('includes Bearer Authorization when password set', () => {
      const p = new KoboldCppProvider({ password: 'hunter2' });
      expect(p.authHeaders()['Authorization']).toBe('Bearer hunter2');
    });
  });

  describe('Request Body Building', () => {
    it('puts system prompt in memory and user prompt in prompt', () => {
      const body = provider.buildRequestBody('SYS', 'USR', {});
      expect(body.prompt).toBe('USR');
      expect(body.memory).toBe('SYS');
    });

    it('uses defaults for max_length, max_context_length, temperature', () => {
      const body = provider.buildRequestBody('', '', {});
      expect(body.max_length).toBe(200);
      expect(body.max_context_length).toBe(4096);
      expect(body.temperature).toBe(0.7);
    });

    it('overrides defaults from options', () => {
      const body = provider.buildRequestBody('', '', {
        maxTokens: 500,
        maxContextTokens: 8192,
        temperature: 1.2
      });
      expect(body.max_length).toBe(500);
      expect(body.max_context_length).toBe(8192);
      expect(body.temperature).toBe(1.2);
    });

    it('always sets use_default_badwordsids and trim_stop', () => {
      const body = provider.buildRequestBody('', '', {});
      expect(body.use_default_badwordsids).toBe(true);
      expect(body.trim_stop).toBe(true);
    });

    it('passes through sampler params when set', () => {
      const body = provider.buildRequestBody('', '', {
        top_p: 0.9, top_k: 40, top_a: 0.1, typical: 0.95, tfs: 0.95, min_p: 0.05,
        rep_pen: 1.15, rep_pen_range: 512, rep_pen_slope: 0.7,
        sampler_order: [6, 0, 1, 3, 4, 2, 5],
        mirostat: 2, mirostat_tau: 5.0, mirostat_eta: 0.1
      });
      expect(body.top_p).toBe(0.9);
      expect(body.top_k).toBe(40);
      expect(body.top_a).toBe(0.1);
      expect(body.typical).toBe(0.95);
      expect(body.tfs).toBe(0.95);
      expect(body.min_p).toBe(0.05);
      expect(body.rep_pen).toBe(1.15);
      expect(body.rep_pen_range).toBe(512);
      expect(body.rep_pen_slope).toBe(0.7);
      expect(body.sampler_order).toEqual([6, 0, 1, 3, 4, 2, 5]);
      expect(body.mirostat).toBe(2);
      expect(body.mirostat_tau).toBe(5.0);
      expect(body.mirostat_eta).toBe(0.1);
    });

    it('omits sampler params when null or undefined', () => {
      const body = provider.buildRequestBody('', '', {
        top_p: null,
        top_k: undefined,
        mirostat: null
      });
      expect(body.top_p).toBeUndefined();
      expect(body.top_k).toBeUndefined();
      expect(body.mirostat).toBeUndefined();
    });

    it('maps stop_sequences to stop_sequence', () => {
      const body = provider.buildRequestBody('', '', { stop_sequences: ['END', '\n\n'] });
      expect(body.stop_sequence).toEqual(['END', '\n\n']);
    });

    it('omits stop_sequence when empty', () => {
      const body = provider.buildRequestBody('', '', { stop_sequences: [] });
      expect(body.stop_sequence).toBeUndefined();
    });

    it('includes genkey when provided', () => {
      const body = provider.buildRequestBody('', '', {}, 'KCPP_test123');
      expect(body.genkey).toBe('KCPP_test123');
    });

    it('omits genkey when not provided', () => {
      const body = provider.buildRequestBody('', '', {});
      expect(body.genkey).toBeUndefined();
    });
  });

  describe('Generate (non-streaming)', () => {
    it('POSTs to /api/v1/generate with native body and returns text', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ text: 'Hello world' }] })
      });

      const result = await provider.generate('SYS', 'USR', { maxTokens: 100 });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:5001/api/v1/generate');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.prompt).toBe('USR');
      expect(body.memory).toBe('SYS');
      expect(body.max_length).toBe(100);
      expect(body.genkey).toMatch(/^KCPP_/);
      expect(result.content).toBe('Hello world');
      expect(result.reasoning).toBe('');
    });

    it('includes Bearer header when password is set', async () => {
      const p = new KoboldCppProvider({ baseURL: 'http://localhost:5001', password: 'secret' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ text: 'ok' }] })
      });
      await p.generate('s', 'u');
      expect(mockFetch.mock.calls[0][1].headers['Authorization']).toBe('Bearer secret');
    });

    it('throws when KoboldCpp returns an error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({ msg: 'something broke' })
      });
      await expect(provider.generate('s', 'u')).rejects.toThrow('something broke');
    });

    it('handles empty results array gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] })
      });
      const result = await provider.generate('s', 'u');
      expect(result.content).toBe('');
    });
  });

  describe('Stream Parsing', () => {
    it('yields token content for each SSE message event', async () => {
      const body = streamFrom([
        'event: message\ndata: {"token": "Hello"}\n\n',
        'event: message\ndata: {"token": " world"}\n\n'
      ]);
      const chunks = await collectStream(provider.parseStreamResponse(body));
      const contents = chunks.filter(c => c.content).map(c => c.content);
      expect(contents).toEqual(['Hello', ' world']);
      expect(chunks[chunks.length - 1].finished).toBe(true);
    });

    it('handles events split across read chunks', async () => {
      const body = streamFrom([
        'event: message\ndata: {"tok',
        'en": "split"}\n\nevent: message\ndata: {"token": "ok"}\n\n'
      ]);
      const chunks = await collectStream(provider.parseStreamResponse(body));
      const contents = chunks.filter(c => c.content).map(c => c.content);
      expect(contents).toEqual(['split', 'ok']);
    });

    it('terminates on finish_reason', async () => {
      const body = streamFrom([
        'event: message\ndata: {"token": "x"}\n\n',
        'event: message\ndata: {"token": "", "finish_reason": "stop"}\n\n',
        'event: message\ndata: {"token": "after-finish"}\n\n'
      ]);
      const chunks = await collectStream(provider.parseStreamResponse(body));
      const contents = chunks.filter(c => c.content).map(c => c.content);
      expect(contents).toEqual(['x']);
      expect(chunks.at(-1).finished).toBe(true);
    });

    it('skips malformed data lines without crashing', async () => {
      const body = streamFrom([
        'event: message\ndata: {not valid json}\n\n',
        'event: message\ndata: {"token": "good"}\n\n'
      ]);
      const chunks = await collectStream(provider.parseStreamResponse(body));
      const contents = chunks.filter(c => c.content).map(c => c.content);
      expect(contents).toEqual(['good']);
    });
  });

  describe('Streaming Generation + Abort', () => {
    it('POSTs to /api/extra/generate/stream and returns stream + abort', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: streamFrom(['event: message\ndata: {"token": "hi"}\n\n'])
      });

      const result = await provider.generateStreaming('s', 'u');
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:5001/api/extra/generate/stream');
      expect(typeof result.abort).toBe('function');
      expect(result.metadata.genkey).toMatch(/^KCPP_/);

      const chunks = await collectStream(result.stream);
      expect(chunks.some(c => c.content === 'hi')).toBe(true);
    });

    it('fires POST /api/extra/abort with genkey when caller signal aborts', async () => {
      const controller = new AbortController();

      // First call: stream request. Second call: the abort POST.
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          body: streamFrom([])
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({})
        });

      const result = await provider.generateStreaming('s', 'u', { signal: controller.signal });
      const genkey = result.metadata.genkey;

      controller.abort();

      // Give the abort handler a tick to fire
      await new Promise((r) => setImmediate(r));

      const abortCall = mockFetch.mock.calls[1];
      expect(abortCall).toBeDefined();
      expect(abortCall[0]).toBe('http://localhost:5001/api/extra/abort');
      expect(JSON.parse(abortCall[1].body)).toEqual({ genkey });
    });

    it('throws when stream endpoint returns error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Unauthorized',
        json: async () => ({ msg: 'bad password' })
      });
      await expect(provider.generateStreaming('s', 'u')).rejects.toThrow('bad password');
    });
  });

  describe('getCurrentModel', () => {
    it('returns data.result from /api/v1/model', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'koboldcpp/Llama-3-8B' })
      });
      const model = await provider.getCurrentModel();
      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:5001/api/v1/model');
      expect(model).toBe('koboldcpp/Llama-3-8B');
    });

    it('returns empty string when result missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      });
      expect(await provider.getCurrentModel()).toBe('');
    });

    it('throws when endpoint unreachable', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
        json: async () => ({})
      });
      await expect(provider.getCurrentModel()).rejects.toThrow('Failed to fetch model');
    });
  });

  describe('getMaxContextLength', () => {
    it('returns numeric value from /api/extra/true_max_context_length', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: 8192 })
      });
      const ctx = await provider.getMaxContextLength();
      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:5001/api/extra/true_max_context_length');
      expect(ctx).toBe(8192);
    });

    it('returns null when value is missing or non-numeric', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      });
      expect(await provider.getMaxContextLength()).toBeNull();
    });
  });

  describe('getMaxLength', () => {
    it('returns numeric value from /api/v1/config/max_length', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: 512 })
      });
      const len = await provider.getMaxLength();
      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:5001/api/v1/config/max_length');
      expect(len).toBe(512);
    });

    it('returns null when value is missing or non-numeric', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      });
      expect(await provider.getMaxLength()).toBeNull();
    });
  });

  describe('getEndpointInfo', () => {
    it('returns model + maxContextLength + maxLength when all endpoints succeed', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ result: 'M' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ value: 16384 }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ value: 512 }) });
      const info = await provider.getEndpointInfo();
      expect(info).toEqual({ model: 'M', maxContextLength: 16384, maxLength: 512 });
    });

    it('still returns model when both limit endpoints fail (best-effort)', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ result: 'M' }) })
        .mockResolvedValueOnce({ ok: false, statusText: 'Not Found', json: async () => ({}) })
        .mockResolvedValueOnce({ ok: false, statusText: 'Not Found', json: async () => ({}) });
      const info = await provider.getEndpointInfo();
      expect(info).toEqual({ model: 'M', maxContextLength: null, maxLength: null });
    });

    it('returns partial info when only one limit endpoint succeeds', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ result: 'M' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ value: 8192 }) })
        .mockResolvedValueOnce({ ok: false, statusText: 'Not Found', json: async () => ({}) });
      const info = await provider.getEndpointInfo();
      expect(info).toEqual({ model: 'M', maxContextLength: 8192, maxLength: null });
    });
  });

  describe('Error Parsing', () => {
    it('maps 401 to AUTH_ERROR', () => {
      const err = provider.parseError(new Error('Request failed: 401 Unauthorized'));
      expect(err.code).toBe('AUTH_ERROR');
    });

    it('maps ECONNREFUSED to CONNECTION_ERROR', () => {
      const err = provider.parseError(new Error('ECONNREFUSED'));
      expect(err.code).toBe('CONNECTION_ERROR');
      expect(err.message).toContain('http://localhost:5001');
    });

    it('falls through to default for unknown errors', () => {
      const err = provider.parseError(new Error('something else'));
      expect(err.code).toBe('API_ERROR');
    });
  });

  describe('Genkey', () => {
    it('generates unique keys with KCPP_ prefix', () => {
      const a = provider.generateGenkey();
      const b = provider.generateGenkey();
      expect(a).toMatch(/^KCPP_/);
      expect(b).toMatch(/^KCPP_/);
      expect(a).not.toBe(b);
    });
  });
});
