/**
 * DeepSeek Provider Implementation
 * Extends base LLMProvider with DeepSeek-specific functionality
 */

import { LLMProvider } from './base-provider.js';
import { parseSSEStream, transformers } from './shared/stream-parser.js';
import { logLLMRequest, logLLMResponse, logLLMChunk, isLLMDebugEnabled } from '../llm-debug.js';

export class DeepSeekProvider extends LLMProvider {
  constructor(config) {
    const deepseekConfig = {
      ...config,
      baseURL: config.baseURL || 'https://api.deepseek.com/v1',
      model: config.model || 'deepseek-v4-flash'
    };

    super(deepseekConfig);
  }

  /**
   * Get DeepSeek provider capabilities
   */
  getCapabilities() {
    return {
      streaming: true,
      reasoning: true,
      visionAPI: false,
      maxContextWindow: 1000000 // V4 models support 1M token context
    };
  }

  /**
   * Validate DeepSeek configuration
   */
  validateConfig() {
    if (!this.apiKey || this.apiKey.trim() === '') {
      return {
        valid: false,
        error: 'API key is required'
      };
    }

    return { valid: true };
  }

  /**
   * Build the request body for /chat/completions.
   * Thinking mode is now decoupled from model choice — toggled per-request.
   * When thinking is enabled, sampling parameters are ignored by the API,
   * so we omit them to keep the payload clean.
   */
  buildRequestBody(messages, options, stream) {
    const thinkingEnabled = options.thinking === true;

    const body = {
      model: this.model,
      messages,
      stream,
      max_tokens: options.maxTokens || 4000,
      thinking: thinkingEnabled
        ? {
            type: 'enabled',
            reasoning_effort: options.reasoningEffort === 'max' ? 'max' : 'high'
          }
        : { type: 'disabled' }
    };

    if (!thinkingEnabled) {
      body.temperature = options.temperature !== undefined ? options.temperature : 1.5;
      if (options.top_p !== null && options.top_p !== undefined) {
        body.top_p = options.top_p;
      }
      if (options.frequency_penalty !== null && options.frequency_penalty !== undefined) {
        body.frequency_penalty = options.frequency_penalty;
      }
      if (options.presence_penalty !== null && options.presence_penalty !== undefined) {
        body.presence_penalty = options.presence_penalty;
      }
    }

    if (options.stop_sequences && options.stop_sequences.length > 0) {
      body.stop = options.stop_sequences;
    }

    return body;
  }

  /**
   * Generate content without streaming
   */
  async generate(systemPrompt, userPrompt, options = {}) {
    if (!this.apiKey) {
      throw new Error('API key not set');
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const requestBody = this.buildRequestBody(messages, options, false);

    const endpoint = `${this.baseURL}/chat/completions`;
    const startTime = Date.now();
    logLLMRequest(this.constructor.name, endpoint, requestBody);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: options.signal
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API request failed: ${response.statusText}`);
    }

    const data = await response.json();
    const choice = data.choices[0];
    const result = {
      content: choice.message.content || '',
      reasoning: choice.message.reasoning_content || '',
      usage: data.usage
    };
    logLLMResponse(this.constructor.name, result, Date.now() - startTime);
    return result;
  }

  /**
   * Generate content with streaming
   */
  async generateStreaming(systemPrompt, userPrompt, options = {}) {
    if (!this.apiKey) {
      throw new Error('API key not set');
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const controller = new AbortController();
    const requestBody = this.buildRequestBody(messages, options, true);

    const endpoint = `${this.baseURL}/chat/completions`;
    logLLMRequest(this.constructor.name, endpoint, requestBody);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: options.signal || controller.signal
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API request failed: ${response.statusText}`);
    }

    return {
      stream: isLLMDebugEnabled()
        ? this.parseStreamResponseWithDebug(response.body)
        : this.parseStreamResponse(response.body),
      abort: () => controller.abort(),
      metadata: {
        userPrompt,
        systemPrompt
      }
    };
  }

  /**
   * Parse SSE stream response using shared parser
   */
  async *parseStreamResponse(body) {
    yield* parseSSEStream(body, transformers.deepseek, 'DeepSeek');
  }

  /**
   * Parse SSE stream with debug logging of each chunk
   */
  async *parseStreamResponseWithDebug(body) {
    const startTime = Date.now();
    let chunkCount = 0;
    for await (const chunk of parseSSEStream(body, transformers.deepseek, 'DeepSeek')) {
      chunkCount++;
      logLLMChunk(this.constructor.name, chunk);
      yield chunk;
    }
    logLLMResponse(this.constructor.name, { chunks: chunkCount }, Date.now() - startTime);
  }

  /**
   * Parse DeepSeek-specific errors
   */
  parseError(error) {
    if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
      return {
        code: 'AUTH_ERROR',
        message: 'Invalid API key',
        original: error
      };
    }

    if (error.message?.includes('429') || error.message?.includes('rate limit')) {
      return {
        code: 'RATE_LIMIT',
        message: 'Rate limit exceeded. Please try again later.',
        original: error
      };
    }

    return super.parseError(error);
  }

  /**
   * Fetch available models from DeepSeek
   * @returns {Promise<Array>} Array of model objects with metadata
   */
  async getAvailableModels() {
    try {
      const response = await fetch(`${this.baseURL}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }

      const data = await response.json();

      return data.data.map((model) => ({
        id: model.id,
        name: model.id,
        description: this.getModelDescription(model.id),
        contextLength: 1000000, // V4 models: 1M tokens
        pricing: {
          prompt: 0,
          completion: 0
        },
        created: model.created,
        ownedBy: model.owned_by
      }));
    } catch (error) {
      console.error('Failed to fetch DeepSeek models:', error);
      return [];
    }
  }

  /**
   * Get model description based on model ID
   */
  getModelDescription(modelId) {
    const descriptions = {
      'deepseek-v4-flash':
        'DeepSeek V4 Flash — fast, low-cost, 1M context. Supports optional thinking mode.',
      'deepseek-v4-pro':
        'DeepSeek V4 Pro — higher-quality, 1M context. Supports optional thinking mode.',
      'deepseek-chat': 'Deprecated — aliases to deepseek-v4-flash (non-thinking).',
      'deepseek-reasoner': 'Deprecated — aliases to deepseek-v4-flash (thinking enabled).'
    };
    return descriptions[modelId] || '';
  }
}
