import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  OllamaProvider,
  parseModelfileParameters,
  extractContextLength
} from '../ollama-provider.js';

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

describe('OllamaProvider', () => {
  let provider;
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    provider = new OllamaProvider({ baseURL: 'http://localhost:11434', model: 'llama3:latest' });
  });

  describe('Configuration', () => {
    it('defaults baseURL to http://localhost:11434', () => {
      const p = new OllamaProvider({});
      expect(p.baseURL).toBe('http://localhost:11434');
    });

    it('strips trailing slashes from baseURL', () => {
      const p = new OllamaProvider({ baseURL: 'http://example.com:11434//' });
      expect(p.baseURL).toBe('http://example.com:11434');
    });

    it('strips trailing /api so users can paste either form', () => {
      const withApi = new OllamaProvider({ baseURL: 'http://192.168.1.50:11434/api' });
      const withoutApi = new OllamaProvider({ baseURL: 'http://192.168.1.50:11434' });
      expect(withApi.baseURL).toBe('http://192.168.1.50:11434');
      expect(withoutApi.baseURL).toBe('http://192.168.1.50:11434');
    });

    it('stores password when provided', () => {
      const p = new OllamaProvider({ password: 'token' });
      expect(p.password).toBe('token');
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
      const p = new OllamaProvider({ baseURL: '   ' });
      expect(p.validateConfig().valid).toBe(false);
    });
  });

  describe('Auth Headers', () => {
    it('omits Authorization when no password', () => {
      const headers = provider.authHeaders();
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBeUndefined();
    });

    it('includes Bearer Authorization when password set', () => {
      const p = new OllamaProvider({ password: 'tok123' });
      expect(p.authHeaders()['Authorization']).toBe('Bearer tok123');
    });
  });

  describe('Request Body Building', () => {
    it('builds OpenAI-style messages array', () => {
      const body = provider.buildRequestBody('SYS', 'USR', {});
      expect(body.messages).toEqual([
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'USR' }
      ]);
    });

    it('omits system message when system prompt is empty', () => {
      const body = provider.buildRequestBody('', 'USR', {});
      expect(body.messages).toEqual([{ role: 'user', content: 'USR' }]);
    });

    it('includes selected model', () => {
      const body = provider.buildRequestBody('', 'u', {});
      expect(body.model).toBe('llama3:latest');
    });

    it('puts core params into options blob with Ollama-native names', () => {
      const body = provider.buildRequestBody('', 'u', {
        maxTokens: 500,
        maxContextTokens: 16384,
        temperature: 1.2
      });
      expect(body.options.num_predict).toBe(500);
      expect(body.options.num_ctx).toBe(16384);
      expect(body.options.temperature).toBe(1.2);
    });

    it('uses defaults for num_predict/num_ctx/temperature', () => {
      const body = provider.buildRequestBody('', 'u', {});
      expect(body.options.num_predict).toBe(200);
      expect(body.options.num_ctx).toBe(4096);
      expect(body.options.temperature).toBe(0.7);
    });

    it('maps preset sampler names to Ollama names', () => {
      const body = provider.buildRequestBody('', 'u', {
        top_p: 0.9,
        top_k: 40,
        min_p: 0.05,
        typical: 0.95,
        tfs: 0.97,
        rep_pen: 1.15,
        rep_pen_range: 256,
        mirostat: 2,
        mirostat_tau: 5,
        mirostat_eta: 0.1
      });
      expect(body.options.top_p).toBe(0.9);
      expect(body.options.top_k).toBe(40);
      expect(body.options.min_p).toBe(0.05);
      expect(body.options.typical_p).toBe(0.95);
      expect(body.options.tfs_z).toBe(0.97);
      expect(body.options.repeat_penalty).toBe(1.15);
      expect(body.options.repeat_last_n).toBe(256);
      expect(body.options.mirostat).toBe(2);
      expect(body.options.mirostat_tau).toBe(5);
      expect(body.options.mirostat_eta).toBe(0.1);
    });

    it('omits sampler params when null/undefined', () => {
      const body = provider.buildRequestBody('', 'u', {
        top_p: null,
        rep_pen: undefined,
        mirostat: null
      });
      expect(body.options.top_p).toBeUndefined();
      expect(body.options.repeat_penalty).toBeUndefined();
      expect(body.options.mirostat).toBeUndefined();
    });

    it('does not forward Ollama-unsupported params (top_a, rep_pen_slope)', () => {
      const body = provider.buildRequestBody('', 'u', { top_a: 0.5, rep_pen_slope: 0.7 });
      expect(body.options.top_a).toBeUndefined();
      expect(body.options.rep_pen_slope).toBeUndefined();
    });

    it('maps stop_sequences to options.stop', () => {
      const body = provider.buildRequestBody('', 'u', { stop_sequences: ['END', '\n\n'] });
      expect(body.options.stop).toEqual(['END', '\n\n']);
    });

    it('omits stop when empty', () => {
      const body = provider.buildRequestBody('', 'u', { stop_sequences: [] });
      expect(body.options.stop).toBeUndefined();
    });

    it('sets stream flag from argument', () => {
      expect(provider.buildRequestBody('', 'u', {}, false).stream).toBe(false);
      expect(provider.buildRequestBody('', 'u', {}, true).stream).toBe(true);
    });
  });

  describe('Generate (non-streaming)', () => {
    it('POSTs to /api/chat and returns content from message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: 'llama3:latest',
          message: { role: 'assistant', content: 'Hello world' },
          done: true,
          prompt_eval_count: 12,
          eval_count: 4
        })
      });

      const result = await provider.generate('s', 'u', { maxTokens: 100 });
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:11434/api/chat');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body).stream).toBe(false);
      expect(result.content).toBe('Hello world');
      expect(result.usage.totalTokens).toBe(16);
    });

    it('throws when no model selected', async () => {
      const p = new OllamaProvider({ baseURL: 'http://localhost:11434' });
      await expect(p.generate('s', 'u')).rejects.toThrow('no model selected');
    });

    it('includes Bearer header when password set', async () => {
      const p = new OllamaProvider({
        baseURL: 'http://localhost:11434',
        model: 'm',
        password: 'tok'
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: 'ok' }, done: true })
      });
      await p.generate('', 'u');
      expect(mockFetch.mock.calls[0][1].headers['Authorization']).toBe('Bearer tok');
    });

    it('throws when Ollama returns an error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
        json: async () => ({ error: 'model "x" not found' })
      });
      await expect(provider.generate('s', 'u')).rejects.toThrow('model "x" not found');
    });
  });

  describe('NDJSON Stream Parsing', () => {
    it('yields token content for each line, terminates on done:true', async () => {
      const body = streamFrom([
        JSON.stringify({ message: { content: 'Hello' }, done: false }) + '\n',
        JSON.stringify({ message: { content: ' world' }, done: false }) + '\n',
        JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 5, eval_count: 2 }) + '\n'
      ]);
      const chunks = await collectStream(provider.parseStreamResponse(body));
      const contents = chunks.filter((c) => c.content).map((c) => c.content);
      expect(contents).toEqual(['Hello', ' world']);
      const last = chunks.at(-1);
      expect(last.finished).toBe(true);
      expect(last.usage.totalTokens).toBe(7);
    });

    it('handles lines split across read chunks', async () => {
      const body = streamFrom([
        '{"message":{"content":"split',
        '"},"done":false}\n{"message":{"content":"ok"},"done":true}\n'
      ]);
      const chunks = await collectStream(provider.parseStreamResponse(body));
      const contents = chunks.filter((c) => c.content).map((c) => c.content);
      expect(contents).toEqual(['split', 'ok']);
    });

    it('skips malformed lines without crashing', async () => {
      const body = streamFrom([
        '{not valid json}\n',
        JSON.stringify({ message: { content: 'good' }, done: true }) + '\n'
      ]);
      const chunks = await collectStream(provider.parseStreamResponse(body));
      const contents = chunks.filter((c) => c.content).map((c) => c.content);
      expect(contents).toEqual(['good']);
    });
  });

  describe('Streaming Generation', () => {
    it('POSTs to /api/chat with stream:true and returns stream + abort', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: streamFrom([JSON.stringify({ message: { content: 'hi' }, done: true }) + '\n'])
      });

      const result = await provider.generateStreaming('s', 'u');
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:11434/api/chat');
      expect(JSON.parse(opts.body).stream).toBe(true);
      expect(typeof result.abort).toBe('function');

      const chunks = await collectStream(result.stream);
      expect(chunks.some((c) => c.content === 'hi')).toBe(true);
    });

    it('throws when stream endpoint returns error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({ error: 'broken' })
      });
      await expect(provider.generateStreaming('s', 'u')).rejects.toThrow('broken');
    });
  });

  describe('getAvailableModels', () => {
    it('GETs /api/tags and maps the models array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            {
              name: 'llama3:latest',
              size: 4661211808,
              modified_at: '2024-05-01T00:00:00Z',
              details: { family: 'llama', parameter_size: '8B', quantization_level: 'Q4_0' }
            },
            {
              name: 'qwen2.5:7b',
              size: 4500000000,
              modified_at: '2024-06-01T00:00:00Z',
              details: { family: 'qwen', parameter_size: '7B', quantization_level: 'Q4_K_M' }
            }
          ]
        })
      });

      const models = await provider.getAvailableModels();
      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:11434/api/tags');
      // Sorted by modified_at desc
      expect(models.map((m) => m.id)).toEqual(['qwen2.5:7b', 'llama3:latest']);
      expect(models[0].description).toBe('7B · Q4_K_M');
      expect(models[0].size).toBe(4500000000);
    });

    it('handles empty model list', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] })
      });
      const models = await provider.getAvailableModels();
      expect(models).toEqual([]);
    });

    it('throws when /api/tags fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Gateway',
        json: async () => ({})
      });
      await expect(provider.getAvailableModels()).rejects.toThrow('Failed to fetch Ollama models');
    });
  });

  describe('parseModelfileParameters', () => {
    it('parses simple key/value lines', () => {
      const out = parseModelfileParameters('temperature 0.7\ntop_p 0.9\ntop_k 40');
      expect(out).toEqual({ temperature: 0.7, top_p: 0.9, top_k: 40 });
    });

    it('collects repeated stop lines into an array', () => {
      const out = parseModelfileParameters('stop "<|im_start|>"\nstop "<|im_end|>"\nstop "</s>"');
      expect(out.stop).toEqual(['<|im_start|>', '<|im_end|>', '</s>']);
    });

    it('unescapes quoted values', () => {
      const out = parseModelfileParameters('stop "say \\"hi\\""\nstop "line1\\nline2"');
      expect(out.stop).toEqual(['say "hi"', 'line1\nline2']);
    });

    it('keeps non-numeric values as strings', () => {
      const out = parseModelfileParameters('something abc\nthing "quoted"');
      expect(out.something).toBe('abc');
      expect(out.thing).toBe('quoted');
    });

    it('returns empty object for empty or null input', () => {
      expect(parseModelfileParameters('')).toEqual({});
      expect(parseModelfileParameters(null)).toEqual({});
      expect(parseModelfileParameters(undefined)).toEqual({});
    });

    it('ignores blank lines and lines without spaces', () => {
      const out = parseModelfileParameters('\ntemperature 0.7\n\nbarekey\n\n');
      expect(out).toEqual({ temperature: 0.7 });
    });
  });

  describe('extractContextLength', () => {
    it('finds family-prefixed *.context_length keys', () => {
      expect(extractContextLength({ 'llama.context_length': 8192 })).toBe(8192);
      expect(extractContextLength({ 'qwen2.context_length': 32768 })).toBe(32768);
      expect(extractContextLength({ 'gemma.context_length': 8192, 'other.thing': 1 })).toBe(8192);
    });

    it('returns null when no context_length key exists', () => {
      expect(extractContextLength({ 'llama.block_count': 32 })).toBeNull();
    });

    it('returns null for invalid input', () => {
      expect(extractContextLength(null)).toBeNull();
      expect(extractContextLength(undefined)).toBeNull();
      expect(extractContextLength('not an object')).toBeNull();
    });

    it('ignores non-numeric or zero values', () => {
      expect(extractContextLength({ 'llama.context_length': 'huge' })).toBeNull();
      expect(extractContextLength({ 'llama.context_length': 0 })).toBeNull();
    });
  });

  describe('getModelInfo', () => {
    it('POSTs to /api/show with name and returns parsed info', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          parameters: 'temperature 0.7\ntop_p 0.9\nstop "<|eot_id|>"',
          model_info: { 'llama.context_length': 8192, 'llama.block_count': 32 },
          capabilities: ['completion', 'tools'],
          details: { family: 'llama', parameter_size: '8B' }
        })
      });

      const info = await provider.getModelInfo('llama3:latest');
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:11434/api/show');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({ name: 'llama3:latest' });
      expect(info.contextLength).toBe(8192);
      expect(info.parameters.temperature).toBe(0.7);
      expect(info.parameters.top_p).toBe(0.9);
      expect(info.parameters.stop).toEqual(['<|eot_id|>']);
      expect(info.capabilities).toEqual(['completion', 'tools']);
      expect(info.details.family).toBe('llama');
    });

    it('falls back to provider.model when no name passed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ parameters: '', model_info: {}, capabilities: [] })
      });
      await provider.getModelInfo();
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ name: 'llama3:latest' });
    });

    it('throws when no name is available', async () => {
      const p = new OllamaProvider({ baseURL: 'http://localhost:11434' });
      await expect(p.getModelInfo()).rejects.toThrow('Model name is required');
    });

    it('handles missing parameters/capabilities/details defensively', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ model_info: { 'llama.context_length': 4096 } })
      });
      const info = await provider.getModelInfo('m');
      expect(info.contextLength).toBe(4096);
      expect(info.parameters).toEqual({});
      expect(info.capabilities).toEqual([]);
      expect(info.details).toEqual({});
    });

    it('throws when /api/show fails', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, statusText: 'Not Found' });
      await expect(provider.getModelInfo('m')).rejects.toThrow('Failed to fetch model info');
    });
  });

  describe('Error Parsing', () => {
    it('maps 401 to AUTH_ERROR', () => {
      const err = provider.parseError(new Error('401 Unauthorized'));
      expect(err.code).toBe('AUTH_ERROR');
    });

    it('maps ECONNREFUSED to CONNECTION_ERROR', () => {
      const err = provider.parseError(new Error('ECONNREFUSED'));
      expect(err.code).toBe('CONNECTION_ERROR');
      expect(err.message).toContain('http://localhost:11434');
    });

    it('maps "model not found" to MODEL_NOT_FOUND with pull hint', () => {
      const err = provider.parseError(new Error('model "llama3" not found, try pulling it first'));
      expect(err.code).toBe('MODEL_NOT_FOUND');
      expect(err.message).toContain('ollama pull');
    });

    it('falls through to default for unknown errors', () => {
      const err = provider.parseError(new Error('something else'));
      expect(err.code).toBe('API_ERROR');
    });
  });
});
