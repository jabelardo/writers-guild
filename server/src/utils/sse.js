/**
 * Server-Sent Events helper for endpoints that can report progress.
 *
 * Streaming is opt-in: a client asks for it with `Accept: text/event-stream`.
 * Anything else gets the endpoint's normal JSON response, so existing callers
 * are unaffected.
 */

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {{
 *   streaming: boolean,
 *   open: () => void,
 *   send: (event: object) => void,
 *   finish: (payload: object) => void,
 *   fail: (message: string, statusCode?: number) => void,
 * }}
 */
export function sseChannel(req, res) {
  const streaming = (req.headers.accept || '').includes('text/event-stream');
  let opened = false;

  const open = () => {
    if (!streaming || opened) return;
    opened = true;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Without this, a proxy may buffer the whole stream and defeat the point.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
  };

  const write = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    res.flush?.();
  };

  return {
    streaming,

    open,

    /** Emit a progress event. No-op when the client did not ask to stream. */
    send(event) {
      if (!streaming) return;
      open();
      write(event);
    },

    /**
     * Terminal success. Streams a `done` event and closes; otherwise sends
     * the payload as the ordinary JSON response.
     */
    finish(payload) {
      if (!streaming) {
        res.status(payload.statusCode || 201).json(payload.body ?? payload);
        return;
      }
      open();
      write({ type: 'done', ...(payload.body ?? payload) });
      res.end();
    },

    /**
     * Terminal failure. Once the stream is open the status line is already
     * sent, so the error has to travel as an event rather than a status code.
     */
    fail(message, statusCode = 400) {
      if (!streaming || !opened) {
        res.status(statusCode).json({ error: message });
        return;
      }
      write({ type: 'error', error: message });
      res.end();
    }
  };
}
