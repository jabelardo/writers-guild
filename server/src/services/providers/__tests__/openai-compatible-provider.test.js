import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../openai-compatible-provider.js';

describe('OpenAICompatibleProvider', () => {
  let provider;
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    provider = new OpenAICompatibleProvider({
      baseURL: 'http://localhost:1234/v1',
      model: 'llama-3.2-3b-instruct'
    });
  });

  describe('Configuration', () => {
    it('defaults baseURL to LM Studio convention', () => {
      const p = new OpenAICompatibleProvider({});
      expect(p.baseURL).toBe('http://localhost:1234/v1');
    });

    it('uses a placeholder Bearer token when none provided', () => {
      const p = new OpenAICompatibleProvider({});
      expect(p.apiKey).toBe('no-key');
      expect(p.hasUserToken).toBe(false);
    });

    it('uses the user-provided Bearer token when present', () => {
      const p = new OpenAICompatibleProvider({ apiKey: 'real-token' });
      expect(p.apiKey).toBe('real-token');
      expect(p.hasUserToken).toBe(true);
    });

    it('does not treat the placeholder as a user-set token', () => {
      const p = new OpenAICompatibleProvider({ apiKey: 'no-key' });
      expect(p.hasUserToken).toBe(false);
    });
  });

  describe('Validation', () => {
    it('passes when baseURL is set, no apiKey required', () => {
      const p = new OpenAICompatibleProvider({ baseURL: 'http://localhost:1234/v1' });
      expect(p.validateConfig()).toEqual({ valid: true });
    });

    it('fails when baseURL is empty', () => {
      const p = new OpenAICompatibleProvider({ baseURL: '   ' });
      expect(p.validateConfig().valid).toBe(false);
    });
  });

  describe('Capabilities', () => {
    it('reports streaming true, conservative context default', () => {
      const caps = provider.getCapabilities();
      expect(caps.streaming).toBe(true);
      expect(caps.maxContextWindow).toBe(8192);
    });
  });

  describe('Max Tokens Parameter', () => {
    it('never uses max_completion_tokens (OpenAI-only quirk)', () => {
      expect(provider.usesMaxCompletionTokens()).toBe(false);

      // Even if the user names a model "gpt-5" the local server still uses max_tokens
      const p = new OpenAICompatibleProvider({ model: 'gpt-5' });
      expect(p.usesMaxCompletionTokens()).toBe(false);
    });

    it('puts max_tokens (not max_completion_tokens) in request body', () => {
      const body = provider.buildRequestBody([{ role: 'user', content: 'hi' }], {
        maxTokens: 1234
      });
      expect(body.max_tokens).toBe(1234);
      expect(body.max_completion_tokens).toBeUndefined();
    });
  });

  describe('getAvailableModels', () => {
    it('GETs /models and returns every entry (no chat-name filter)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'llama-3.2-3b-instruct', owned_by: 'lmstudio' },
            { id: 'Meta-Llama-3.1-8B-Instruct-GGUF', owned_by: 'lmstudio' },
            { id: 'qwen2.5-coder-7b-instruct', owned_by: 'lmstudio' }
          ]
        })
      });

      const models = await provider.getAvailableModels();
      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:1234/v1/models');
      // No filter applied — non-OpenAI-shaped names all pass through
      expect(models.map((m) => m.id)).toEqual([
        'llama-3.2-3b-instruct',
        'Meta-Llama-3.1-8B-Instruct-GGUF',
        'qwen2.5-coder-7b-instruct'
      ]);
      expect(models[0].description).toBe('owned_by: lmstudio');
    });

    it('works without a user-provided token (sends placeholder Bearer)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'm' }] })
      });
      await provider.getAvailableModels();
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer no-key');
    });

    it('sends the user-provided Bearer when set', async () => {
      const p = new OpenAICompatibleProvider({
        baseURL: 'http://localhost:1234/v1',
        apiKey: 'real-token'
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'm' }] })
      });
      await p.getAvailableModels();
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer real-token');
    });

    it('returns empty array on fetch failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, statusText: 'Not Found' });
      const models = await provider.getAvailableModels();
      expect(models).toEqual([]);
    });

    it('handles a missing data field defensively', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      });
      const models = await provider.getAvailableModels();
      expect(models).toEqual([]);
    });
  });

  describe('Error Parsing', () => {
    it('maps 401 to AUTH_ERROR with token-set message when user provided one', () => {
      const p = new OpenAICompatibleProvider({
        baseURL: 'http://localhost:1234/v1',
        apiKey: 'real-token'
      });
      const err = p.parseError(new Error('401 Unauthorized'));
      expect(err.code).toBe('AUTH_ERROR');
      expect(err.message).toMatch(/check it matches/i);
    });

    it('maps 401 to AUTH_ERROR with add-token hint when no user token', () => {
      const err = provider.parseError(new Error('401 Unauthorized'));
      expect(err.code).toBe('AUTH_ERROR');
      expect(err.message).toMatch(/add a bearer token/i);
    });

    it('maps ECONNREFUSED to CONNECTION_ERROR', () => {
      const err = provider.parseError(new Error('ECONNREFUSED'));
      expect(err.code).toBe('CONNECTION_ERROR');
      expect(err.message).toContain('http://localhost:1234/v1');
    });

    it('falls through to OpenAI error parser for rate-limit etc', () => {
      const err = provider.parseError(new Error('429 rate limit exceeded'));
      expect(err.code).toBe('RATE_LIMIT');
    });
  });

  describe('Inherited request-shape behavior', () => {
    it('inherits chat-completions request flow from OpenAIProvider', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'hello from local model' } }]
        })
      });

      const result = await provider.generate('SYS', 'USR', { maxTokens: 256 });
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:1234/v1/chat/completions');
      const body = JSON.parse(opts.body);
      expect(body.model).toBe('llama-3.2-3b-instruct');
      expect(body.messages).toEqual([
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'USR' }
      ]);
      expect(body.max_tokens).toBe(256);
      expect(result.content).toBe('hello from local model');
    });
  });
});
