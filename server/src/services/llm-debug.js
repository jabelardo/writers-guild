/**
 * LLM debug logging utility.
 * Activated by setting DEBUG_LLM=true in the environment.
 * Logs the full request/response payload to/from LLM providers — no truncation.
 * Since this is an explicit debug flag, everything is visible.
 */

const DEBUG_ENABLED = process.env.DEBUG_LLM === 'true';

function prefix() {
  return `[LLM ${new Date().toISOString()}]`;
}

/**
 * Log the outgoing request to an LLM provider.
 * @param {string} providerName - Provider name (e.g. 'OpenAI', 'DeepSeek', 'OpenRouter')
 * @param {string} endpoint - API endpoint URL
 * @param {Object} body - Request body (only redacts top-level apiKey if present)
 */
export function logLLMRequest(providerName, endpoint, body) {
  if (!DEBUG_ENABLED) return;
  const safeBody = JSON.parse(JSON.stringify(body));
  if (safeBody.apiKey) safeBody.apiKey = '***REDACTED***';
  // Don't truncate messages — the user needs to see the full prompt including lorebook entries
  console.log(
    `${prefix()} >>> ${providerName} ${endpoint}\n${JSON.stringify(safeBody, null, 2)}`
  );
}

/**
 * Log the response received from an LLM provider.
 * @param {string} providerName - Provider name
 * @param {Object} response - Response data (full, no truncation)
 * @param {number} [durationMs] - Request duration in ms
 */
export function logLLMResponse(providerName, response, durationMs) {
  if (!DEBUG_ENABLED) return;
  const duration = durationMs !== undefined ? ` (${durationMs}ms)` : '';
  console.log(
    `${prefix()} <<< ${providerName}${duration}\n${JSON.stringify(response, null, 2)}`
  );
}

/**
 * Log a streaming chunk received from an LLM provider.
 * @param {string} providerName - Provider name
 * @param {Object} chunk - Stream chunk (full content, no truncation)
 */
export function logLLMChunk(providerName, chunk) {
  if (!DEBUG_ENABLED) return;
  if (chunk.finished) {
    console.log(`${prefix()} === ${providerName} stream [DONE]`);
  } else if (chunk.content) {
    console.log(`${prefix()} --- ${providerName} chunk: "${chunk.content}"`);
  }
}

/**
 * Check if LLM debug logging is enabled.
 */
export function isLLMDebugEnabled() {
  return DEBUG_ENABLED;
}