import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseSSEStream, transformers } from '../stream-parser.js';

/**
 * Helper: Create a mock ReadableStream that yields the given strings
 */
function createMockStream(chunks) {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream({
    async pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }

      const chunk = chunks[index++];
      controller.enqueue(encoder.encode(chunk));
      await new Promise(resolve => setTimeout(resolve, 0)); // Simulate async
    }
  });
}

/**
 * Helper: Create SSE-formatted chunks
 */
function createSSEChunks(dataArray) {
  return dataArray.map(data => {
    if (data === '[DONE]') {
      return `data: [DONE]\n\n`;
    }
    return `data: ${JSON.stringify(data)}\n\n`;
  });
}

describe('stream-parser.js', () => {
  describe('parseSSEStream', () => {
    it('should parse basic SSE stream with content', async () => {
      const chunks = createSSEChunks([
        { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] },
        { choices: [{ delta: { content: 'world' }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ]);

      const stream = createMockStream(chunks);
      const results = [];

      for await (const chunk of parseSSEStream(
        { getReader: () => stream.getReader() },
        (delta) => ({ content: delta.content || null }),
        'TestProvider'
      )) {
        results.push(chunk);
      }

      expect(results.length).toBe(3);
      expect(results[0].content).toBe('Hello');
      expect(results[0].finished).toBe(false);
      expect(results[1].content).toBe('world');
      expect(results[2].content).toBe(null);
      expect(results[2].finished).toBe(true);
    });

    it('should handle SSE with reasoning content (DeepSeek format)', async () => {
      const chunks = createSSEChunks([
        { choices: [{ delta: { reasoning_content: 'Thinking...' }, finish_reason: null }] },
        { choices: [{ delta: { content: 'Answer' }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ]);

      const stream = createMockStream(chunks);
      const results = [];

      for await (const chunk of parseSSEStream(
        { getReader: () => stream.getReader() },
        (delta) => ({
          reasoning: delta.reasoning_content || null,
          content: delta.content || null,
        }),
        'DeepSeek'
      )) {
        results.push(chunk);
      }

      expect(results.length).toBe(3);
      expect(results[0].reasoning).toBe('Thinking...');
      expect(results[0].content).toBe(null);
      expect(results[1].reasoning).toBe(null);
      expect(results[1].content).toBe('Answer');
    });

    it('should skip empty lines and [DONE] markers', async () => {
      const encoder = new TextEncoder();
      const customChunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        '\n',
        'data: [DONE]\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        '\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      ];

      const stream = new ReadableStream({
        async pull(controller) {
          if (customChunks.length === 0) {
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(customChunks.shift()));
        }
      });

      const results = [];
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      for await (const chunk of parseSSEStream(
        { getReader: () => stream.getReader() },
        (delta) => ({ content: delta.content || null }),
        'Test'
      )) {
        results.push(chunk);
      }

      // Should only yield 2 content chunks + 1 finished chunk = 3 total
      expect(results.length).toBe(3);
      expect(results[0].content).toBe('Hello');
      expect(results[1].content).toBe(' world');
      expect(results[2].finished).toBe(true);

      consoleWarnSpy.mockRestore();
    });

    it('should handle malformed JSON gracefully', async () => {
      const encoder = new TextEncoder();
      const customChunks = [
        'data: {invalid json}\n\n',
        'data: {"choices":[{"delta":{"content":"valid"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      ];

      const stream = new ReadableStream({
        async pull(controller) {
          if (customChunks.length === 0) {
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(customChunks.shift()));
        }
      });

      const results = [];
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      for await (const chunk of parseSSEStream(
        { getReader: () => stream.getReader() },
        (delta) => ({ content: delta.content || null }),
        'Test'
      )) {
        results.push(chunk);
      }

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Test] Failed to parse SSE line:'),
        expect.anything()
      );

      // Should still parse the valid chunk
      expect(results.length).toBe(2); // valid content + finished
      expect(results[0].content).toBe('valid');

      consoleWarnSpy.mockRestore();
    });

    it('should handle stream with no choices', async () => {
      const chunks = createSSEChunks([
        { id: 'test-123', object: 'chat.completion.chunk' },
        { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] },
      ]);

      const stream = createMockStream(chunks);
      const results = [];

      for await (const chunk of parseSSEStream(
        { getReader: () => stream.getReader() },
        (delta) => ({ content: delta.content || null }),
        'Test'
      )) {
        results.push(chunk);
      }

      // Should skip the first chunk (no choices) and only yield the second
      expect(results.length).toBe(1);
      expect(results[0].content).toBe('Hello');
    });

    it('should handle AbortError', async () => {
      const encoder = new TextEncoder();
      let chunkCount = 0;

      const stream = new ReadableStream({
        async pull(controller) {
          if (chunkCount === 0) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
            chunkCount++;
          } else {
            // Simulate abort by throwing AbortError
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            controller.error(error);
          }
        }
      });

      const results = [];
      let caughtError = null;

      try {
        for await (const chunk of parseSSEStream(
          { getReader: () => stream.getReader() },
          (delta) => ({ content: delta.content || null }),
          'Test'
        )) {
          results.push(chunk);
        }
      } catch (error) {
        caughtError = error;
      }

      expect(results.length).toBe(1);
      expect(results[0].content).toBe('partial');
      expect(caughtError).not.toBeNull();
      expect(caughtError.name).toBe('AbortError');
    });

    it('should release reader lock on completion', async () => {
      const chunks = createSSEChunks([
        { choices: [{ delta: { content: 'Done' }, finish_reason: 'stop' }] },
      ]);

      const stream = createMockStream(chunks);
      const reader = stream.getReader();
      const releaseLockSpy = vi.spyOn(reader, 'releaseLock');

      const results = [];
      for await (const chunk of parseSSEStream(
        { getReader: () => reader },
        (delta) => ({ content: delta.content || null }),
        'Test'
      )) {
        results.push(chunk);
      }

      expect(results.length).toBe(1);
      expect(releaseLockSpy).toHaveBeenCalled();
    });

    it('should handle OpenRouter-style reasoning_details', async () => {
      const chunks = createSSEChunks([
        {
          choices: [{
            delta: {
              reasoning_details: [{ text: 'Let me think...' }],
              content: null
            },
            finish_reason: null
          }]
        },
        {
          choices: [{
            delta: { content: 'Answer here' },
            finish_reason: null
          }]
        },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ]);

      const stream = createMockStream(chunks);
      const results = [];

      for await (const chunk of parseSSEStream(
        { getReader: () => stream.getReader() },
        (delta, data) => {
          let reasoning = delta.reasoning || null;
          if (!reasoning && data.choices?.[0]?.delta?.reasoning_details?.length > 0) {
            reasoning = data.choices[0].delta.reasoning_details[0].text || null;
          }
          return {
            reasoning,
            content: delta.content || null,
          };
        },
        'OpenRouter'
      )) {
        results.push(chunk);
      }

      expect(results.length).toBe(3);
      expect(results[0].reasoning).toBe('Let me think...');
      expect(results[0].content).toBe(null);
      expect(results[1].content).toBe('Answer here');
    });

    it('should handle buffer with incomplete lines', async () => {
      const encoder = new TextEncoder('utf-8');

      // Send an incomplete SSE data line (no newline at end)
      const stream = new ReadableStream({
        async pull(controller) {
          // Send incomplete JSON (missing closing brace)
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"'));
          controller.close();
        }
      });

      const results = [];
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      for await (const chunk of parseSSEStream(
        { getReader: () => stream.getReader() },
        (delta) => ({ content: delta.content || null }),
        'Test'
      )) {
        results.push(chunk);
      }

      // Incomplete JSON should be in buffer and never parsed
      expect(results.length).toBe(0);

      consoleWarnSpy.mockRestore();
    });
  });

  describe('transformers', () => {
    describe('deepseek', () => {
      it('should extract reasoning_content field', () => {
        const delta = {
          reasoning_content: 'Deep thought',
          content: 'Answer'
        };

        const result = transformers.deepseek(delta);

        expect(result.reasoning).toBe('Deep thought');
        expect(result.content).toBe('Answer');
      });

      it('should handle null reasoning_content', () => {
        const delta = {
          reasoning_content: null,
          content: 'Answer'
        };

        const result = transformers.deepseek(delta);

        expect(result.reasoning).toBe(null);
        expect(result.content).toBe('Answer');
      });

      it('should handle missing content', () => {
        const delta = {
          reasoning_content: 'Thinking...'
        };

        const result = transformers.deepseek(delta);

        expect(result.reasoning).toBe('Thinking...');
        expect(result.content).toBe(null);
      });
    });

    describe('openai', () => {
      it('should extract content field', () => {
        const delta = {
          content: 'Hello from OpenAI'
        };

        const result = transformers.openai(delta);

        expect(result.reasoning).toBe(null);
        expect(result.content).toBe('Hello from OpenAI');
      });

      it('should return null content when not present', () => {
        const delta = {};

        const result = transformers.openai(delta);

        expect(result.reasoning).toBe(null);
        expect(result.content).toBe(null);
      });
    });

    describe('openrouter', () => {
      it('should extract reasoning from reasoning field', () => {
        const delta = {
          reasoning: 'OpenRouter reasoning',
          content: 'Answer'
        };

        const result = transformers.openrouter(delta, {});

        expect(result.reasoning).toBe('OpenRouter reasoning');
        expect(result.content).toBe('Answer');
      });

      it('should extract reasoning from reasoning_details array', () => {
        const data = {
          choices: [{
            delta: {
              reasoning_details: [{ text: 'Detailed reasoning' }]
            }
          }]
        };

        const delta = data.choices[0].delta;

        const result = transformers.openrouter(delta, data);

        expect(result.reasoning).toBe('Detailed reasoning');
      });

      it('should handle missing reasoning', () => {
        const delta = {
          content: 'Answer only'
        };

        const result = transformers.openrouter(delta, {});

        expect(result.reasoning).toBe(null);
        expect(result.content).toBe('Answer only');
      });

      it('should extract usage information', () => {
        const data = {
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5
          }
        };

        const delta = { content: 'Answer' };

        const result = transformers.openrouter(delta, data);

        expect(result.usage).toEqual(data.usage);
      });
    });
  });
});
