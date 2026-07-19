/**
 * OpenAI-Compatible Provider Implementation
 *
 * A thin subclass of OpenAIProvider tailored for local LLM servers that speak
 * OpenAI's wire format but have different operational characteristics — no
 * required API key, freely-listable model catalogs, arbitrary model names
 * (LM Studio, llama.cpp's `--api` mode, vLLM, text-generation-webui's openai
 * extension, etc.).
 *
 * We subclass rather than duplicate because the wire format itself is stable.
 * If OpenAI's spec ever diverges in a way that breaks compat servers, we can
 * fork at that point.
 */

import { OpenAIProvider } from './openai-provider.js';

const DEFAULT_BASE_URL = 'http://localhost:1234/v1';
// Placeholder Bearer value. LM Studio and friends accept any token (or none),
// but always sending a header avoids edge cases in middleware that requires
// the `Authorization` header to be present.
const PLACEHOLDER_TOKEN = 'no-key';

export class OpenAICompatibleProvider extends OpenAIProvider {
  constructor(config) {
    // Hand the parent a populated apiKey so all its Bearer-Authorization code
    // paths "just work" without overriding every request method. The user-set
    // token (if any) goes in apiKey; otherwise the placeholder.
    const compatConfig = {
      ...config,
      baseURL: config.baseURL || DEFAULT_BASE_URL,
      apiKey: config.apiKey || PLACEHOLDER_TOKEN,
      model: config.model || '',
    };

    super(compatConfig);

    // Track whether the user actually provided a token, distinct from the
    // placeholder we may have substituted in.
    this.hasUserToken = !!(config.apiKey && config.apiKey !== PLACEHOLDER_TOKEN);
  }

  getCapabilities() {
    return {
      streaming: true,
      reasoning: false,
      visionAPI: false,
      // Conservative default — most local models are 4k–32k. Users set the
      // real value per preset.
      maxContextWindow: 8192,
    };
  }

  /**
   * Compat endpoints don't require an API key — only a reachable base URL.
   * A token is accepted but optional.
   */
  validateConfig() {
    if (!this.baseURL || this.baseURL.trim() === '') {
      return { valid: false, error: 'Base URL is required' };
    }
    return { valid: true };
  }

  /**
   * Local servers don't use OpenAI's max_completion_tokens convention — that's
   * specific to GPT-5/o1/o3. Always use plain max_tokens.
   */
  usesMaxCompletionTokens() {
    return false;
  }

  /**
   * Return every model the endpoint advertises. The parent class filters for
   * OpenAI's chat-model name patterns (gpt-4, o1, …), which would drop
   * literally everything served by LM Studio, vLLM, etc. — their model names
   * are arbitrary (`llama-3.2-3b-instruct`, `Meta-Llama-3.1-8B-Instruct-GGUF`).
   */
  async getAvailableModels() {
    try {
      const response = await fetch(`${this.baseURL}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }

      const data = await response.json();
      const models = Array.isArray(data?.data) ? data.data : [];

      return models.map((model) => ({
        id: model.id,
        name: model.id,
        description: model.owned_by ? `owned_by: ${model.owned_by}` : '',
        contextLength: 0, // not exposed by the OpenAI /models shape
        created: model.created,
        ownedBy: model.owned_by,
      }));
    } catch (error) {
      console.error('Failed to fetch OpenAI-compatible models:', error);
      return [];
    }
  }

  parseError(error) {
    const msg = error.message || '';
    if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
      return {
        code: 'AUTH_ERROR',
        message: this.hasUserToken
          ? 'Endpoint rejected the Bearer token. Check it matches what the server expects.'
          : 'Endpoint requires authentication. Add a Bearer token in preset settings.',
        original: error,
      };
    }
    if (
      msg.includes('ECONNREFUSED') ||
      msg.includes('fetch failed') ||
      error.cause?.code === 'ECONNREFUSED'
    ) {
      return {
        code: 'CONNECTION_ERROR',
        message: `Could not reach endpoint at ${this.baseURL}`,
        original: error,
      };
    }
    // Fall through to the OpenAIProvider's parsing for rate-limit/quota cases,
    // even though they rarely apply to local servers — harmless if they don't.
    return super.parseError(error);
  }
}
