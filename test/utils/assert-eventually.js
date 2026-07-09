/**
 * Repeatedly run an async check until it resolves or timeout is reached.
 * @param {() => Promise<void>} check - resolves on pass, rejects on fail
 * @param {object} [opts]
 * @param {number} [opts.timeout] - ms to wait (default 3000)
 * @param {number} [opts.interval] - ms between attempts (default 200)
 */
export async function assertEventually(
  check,
  { timeout = 1000, interval = 200 } = {},
) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeout) {
    try {
      await check();
      return;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, interval));
    }
  }
  throw lastError;
}
