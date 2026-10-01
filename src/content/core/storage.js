/**
 * storage.js
 * ============================================================================
 * Thin, promise-based wrapper around chrome.storage.local.
 *
 * The extension storage is the SINGLE SOURCE OF TRUTH for every toggle.
 * Writing here automatically propagates to every open Pinterest tab via
 * `storage.onChanged` — no per-tab bookkeeping required.
 * ============================================================================
 */

const DEFAULT_AREA = 'local';

export class Storage {
  /**
   * @param {'local'|'sync'|'session'} [area]
   */
  constructor(area = DEFAULT_AREA) {
    this.area = area;
    this._area = chrome.storage[area];
    if (!this._area) {
      throw new Error(`[pt-tweaker] Unknown storage area: ${area}`);
    }
  }

  /**
   * Read a single key.
   * @param {string} key
   * @param {*} fallback
   * @returns {Promise<*>}
   */
  async get(key, fallback) {
    const data = await this._area.get(key);
    return key in data ? data[key] : fallback;
  }

  /**
   * Read many keys, merging in defaults for any missing ones.
   * @param {Record<string, *>} defaults
   * @returns {Promise<Record<string, *>>}
   */
  async getAll(defaults = {}) {
    const data = await this._area.get(defaults);
    return { ...defaults, ...data };
  }

  /**
   * Write a single key.
   * @param {string} key
   * @param {*} value
   * @returns {Promise<void>}
   */
  async set(key, value) {
    await this._area.set({ [key]: value });
  }

  /**
   * Remove a single key.
   * @param {string} key
   * @returns {Promise<void>}
   */
  async remove(key) {
    await this._area.remove(key);
  }

  /**
   * Subscribe to storage changes for this area.
   * The listener is called with `{ key: { oldValue, newValue }, ... }`
   * containing ONLY the keys that actually changed.
   * @param {(changes: Object) => void} listener
   * @returns {() => void} unsubscribe
   */
  onChanged(listener) {
    const handler = (changes, area) => {
      if (area !== this.area) return;
      listener(changes);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }
}

/** Shared singleton used by popup / content / background. */
export const storage = new Storage(DEFAULT_AREA);