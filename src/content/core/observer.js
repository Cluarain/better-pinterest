/**
 * observer.js
 * ============================================================================
 * MutationObserver wrapper tuned for Pinterest's infinite-feed DOM.
 *
 *   - Batching: mutations are queued and delivered in a single callback per
 *     animation frame (Pinterest mutates the DOM heavily while scrolling).
 *   - Watch `document.body` with childList/subtree so lazily rendered pins
 *     and content are picked up automatically.
 * ============================================================================
 */

const DEFAULT_CONFIG = { childList: true, subtree: true };

/** requestAnimationFrame with a setTimeout fallback (tests / odd contexts). */
const raf =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb) => setTimeout(() => cb(Date.now()), 16);

export class DomObserver {
  /**
   * @param {MutationObserverInit} [config]
   */
  constructor(config = DEFAULT_CONFIG) {
    this.config = config;
    this._handlers = new Set();
    this._mutationObserver = new MutationObserver((mutations) => this._queue(mutations));
    this._pending = [];
    this._rafId = 0;
    this._active = false;
  }

  /** @returns {boolean} */
  get active() {
    return this._active;
  }

  /**
   * Register a mutation handler.
   * @param {(mutations: MutationRecord[]) => void} handler
   * @returns {() => void} unsubscribe
   */
  on(handler) {
    this._handlers.add(handler);
    return () => this._handlers.delete(handler);
  }

  /**
   * Start observing.
   * @param {Node} [root]                    usually document.body
   * @param {MutationObserverInit} [config]
   */
  observe(root = document.body, config = this.config) {
    if (!root || this._active) return this;
    this._mutationObserver.observe(root, config);
    this._active = true;
    return this;
  }

  /**
   * Stop observing and drop any queued (not yet delivered) mutations.
   */
  disconnect() {
    if (!this._active) return;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = 0;
    this._pending.length = 0;
    this._mutationObserver.disconnect();
    this._active = false;
  }

  /** Debug helper — deliver pending mutations immediately (if any). */
  flush() {
    if (!this._rafId || this._pending.length === 0) return;
    cancelAnimationFrame(this._rafId);
    this._rafId = 0;
    this._deliver(this._pending.splice(0));
  }

  _queue(mutations) {
    this._pending.push(...mutations);
    if (!this._rafId) {
      this._rafId = raf(() => {
        this._rafId = 0;
        this._deliver(this._pending.splice(0));
      });
    }
  }

  _deliver(mutations) {
    for (const handler of this._handlers) {
      try {
        handler(mutations);
      } catch (err) {
        console.warn('[pt-tweaker] observer handler failed:', err);
      }
    }
  }
}