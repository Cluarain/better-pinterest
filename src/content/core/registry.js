/**
 * registry.js
 * ============================================================================
 * Feature lifecycle management — the DRY core of the extension.
 *
 * Instead of every feature duplicating the same boilerplate
 * (read storage -> bind events -> touch the DOM), a feature only declares
 * WHAT it needs; the registry handles WHEN and HOW it is applied.
 *
 * Exports
 * -------
 *   BaseFeature      : the standard interface every feature implements.
 *   CssFeature       : a CSS-driven feature — toggling one <html> class is a
 *                      complete implementation (the visual rules live in
 *                      master.css). No per-feature JS styling code.
 *   FeatureRegistry  : registers features and owns the lifecycle
 *                      (init -> enable/disable -> apply/state).
 * ============================================================================
 */

/** Log prefix used by all internal logging. */
const LOG_PREFIX = '[pt-tweaker]';

/** Safety cap for the <html> class guard (see FeatureRegistry.startClassGuard). */
const CLASS_GUARD_MAX_REPAIRS = 50;

export class BaseFeature {
  /**
   * @param {Object} config
   * @param {string}   config.id              Unique id — storage key + message id.
   * @param {string}   [config.title]         Human readable name (popup).
   * @param {string}   [config.description]   Short description for the popup.
   * @param {string}   [config.type]          'css' (default) or 'js'.
   * @param {string}   [config.htmlClass]     Class toggled on <html>.
   * @param {string}   [config.bodyClass]     Legacy alias of `htmlClass`.
   * @param {boolean}  [config.defaultValue]  Default persisted state.
   */
  constructor(config = {}) {
    this.id = config.id;
    this.title = config.title ?? this.id;
    this.description = config.description ?? '';
    this.type = config.type ?? 'css';
    this.htmlClass = config.htmlClass ?? config.bodyClass ?? null;
    this.defaultValue = Boolean(config.defaultValue);

    /** @type {boolean} current enabled state */
    this._enabled = false;
    /** @type {boolean} init() ran once */
    this._inited = false;
  }

  /** @returns {boolean} */
  get enabled() {
    return this._enabled;
  }

  /** @returns {boolean} */
  get inited() {
    return this._inited;
  }

  /**
   * One-time setup — listeners, observers, cached refs.
   * Called by the registry exactly once per page load.
   */
  init() {}

  /**
   * Apply the enabled state. Idempotent.
   * @param {boolean} enabled
   */
  apply(enabled) {
    return enabled ? this.enable() : this.disable();
  }

  /**
   * Turn the feature ON:
   *   1. adds `htmlClass` to <html> (CSS-driven styling happens here), then
   *   2. runs the `onEnable()` hook for JS-driven logic.
   */
  enable() {
    if (this._enabled) return this;
    if (this.htmlClass) document.documentElement?.classList.add(this.htmlClass);
    try {
      this.onEnable();
    } catch (err) {
      this._warn('onEnable failed', err);
    }
    this._enabled = true;
    return this;
  }

  /**
   * Turn the feature OFF (revert everything enable() did):
   *   1. runs the `onDisable()` hook for JS-driven logic, then
   *   2. removes `htmlClass` from <html>.
   */
  disable() {
    if (!this._enabled) return this;
    try {
      this.onDisable();
    } catch (err) {
      this._warn('onDisable failed', err);
    }
    if (this.htmlClass) document.documentElement?.classList.remove(this.htmlClass);
    this._enabled = false;
    return this;
  }

  /** JS-driven logic hook — executed on enable. CSS features leave it empty. */
  onEnable() {}

  /** JS-driven logic hook — executed on disable. Must revert onEnable(). */
  onDisable() {}

  /** Full teardown when the extension / page is being shut down. */
  destroy() {
    if (this._enabled) this.disable();
  }

  /** Internal logging helpers. */
  _warn(message, ...args) {
    console.warn(`${LOG_PREFIX} [${this.id}] ${message}`, ...args);
  }

  _log(...args) {
    console.info(`${LOG_PREFIX} [${this.id}]`, ...args);
  }
}

/**
 * CSS-driven feature.
 *
 * The whole "implementation" is the `htmlClass` in the constructor config:
 * the registry adds/removes it on <html> and master.css does the rest.
 * Use for simple show/hide/theme toggles that need NO JS logic.
 */
export class CssFeature extends BaseFeature {
  constructor(config) {
    super({ ...config, type: 'css' });
  }
}

/**
 * Owns registration + lifecycle of every feature.
 */
export class FeatureRegistry {
  constructor(features = []) {
    /** @type {Map<string, BaseFeature>} */
    this._features = new Map();
    features.forEach((feature) => this.register(feature));

    /**
     * Debug hook — called with the live state object after every change.
     * The content script mirrors it into <html data-pt-state>, which (unlike
     * window.__ptTweaker, an isolated-world global) is visible from the page
     * console and the Elements panel.
     * @type {((state: Record<string, boolean>) => void)|null}
     */
    this.onStateChange = null;

    /** @type {MutationObserver|null} <html> class guard (see startClassGuard) */
    this._guard = null;
    /** @type {Map<string, number>} repairs per class — reset on user toggles */
    this._guardCounts = new Map();
    /** @type {Set<string>} classes we already gave up on and warned about */
    this._guardWarned = new Set();
  }

  /**
   * Register a feature. Accepts either a config object (→ CssFeature) or a
   * BaseFeature instance (for JS-driven features).
   * @param {Object|BaseFeature} feature
   * @returns {BaseFeature} the registered instance
   */
  register(feature) {
    const instance = feature instanceof BaseFeature ? feature : new CssFeature(feature);
    if (!instance.id) {
      throw new Error(`${LOG_PREFIX} Cannot register a feature without an id.`);
    }
    if (this._features.has(instance.id)) {
      throw new Error(`${LOG_PREFIX} Duplicate feature id: ${instance.id}`);
    }
    this._features.set(instance.id, instance);
    return instance;
  }

  /**
   * Initialize ALL features once, then apply the initial persisted state.
   * @param {Record<string, boolean>} [state] featureId -> enabled
   */
  initAll(state = {}) {
    for (const feature of this.all) {
      if (!feature._inited) {
        feature._inited = true;
        try {
          feature.init();
        } catch (err) {
          feature._warn('init failed', err);
        }
      }
    }
    for (const feature of this.all) {
      try {
        feature.apply(Boolean(state[feature.id]));
      } catch (err) {
        feature._warn(`apply(${Boolean(state[feature.id])}) failed`, err);
      }
    }
    this.startClassGuard();
    this._notifyState();
    return this;
  }

  /**
   * Apply a state change for a single feature (storage/message handlers).
   * @param {string} featureId
   * @param {boolean} enabled
   * @returns {boolean} true if a registered feature was toggled
   */
  apply(featureId, enabled) {
    const feature = this._features.get(featureId);
    if (!feature) return false;
    feature.apply(Boolean(enabled));
    // A deliberate state change resets the guard budget for this class.
    if (feature.htmlClass) {
      this._guardCounts.delete(feature.htmlClass);
      this._guardWarned.delete(feature.htmlClass);
    }
    this._notifyState();
    return true;
  }

  /** @param {string} featureId */
  enable(featureId) {
    return this.apply(featureId, true);
  }

  /** @param {string} featureId */
  disable(featureId) {
    return this.apply(featureId, false);
  }

  /** @param {string} featureId @returns {BaseFeature|undefined} */
  get(featureId) {
    return this._features.get(featureId);
  }

  /** @param {string} featureId @returns {boolean} */
  has(featureId) {
    return this._features.has(featureId);
  }

  /** @returns {BaseFeature[]} */
  get all() {
    return Array.from(this._features.values());
  }

  /** @returns {string[]} */
  get ids() {
    return Array.from(this._features.keys());
  }

  /** @returns {Record<string, boolean>} current in-memory state */
  get state() {
    return Object.fromEntries(this.all.map((feature) => [feature.id, feature.enabled]));
  }

  /**
   * Mirror the live state to the `onStateChange` hook (see constructor).
   */
  _notifyState() {
    if (typeof this.onStateChange !== 'function') return;
    try {
      this.onStateChange(this.state);
    } catch (err) {
      console.warn(`${LOG_PREFIX} onStateChange hook failed`, err);
    }
  }

  /**
   * Class guard — Pinterest's scripts may rewrite the `class` attribute
   * wholesale (often on <body>) and wipe our markers. One MutationObserver
   * re-adds every class whose feature is enabled. Repairs are capped at
   * CLASS_GUARD_MAX_REPAIRS per class (the budget resets on each user toggle)
   * so we can never spin in an add/remove fight with the page.
   */
  startClassGuard() {
    if (this._guard || typeof MutationObserver === 'undefined') return this;
    const root = document.documentElement;
    if (!root) return this;
    this._guard = new MutationObserver(() => this._ensureOwnedClasses());
    this._guard.observe(root, { attributes: true, attributeFilter: ['class'] });
    return this;
  }

  /** Re-add any owned class that the page removed while its feature is on. */
  _ensureOwnedClasses() {
    const root = document.documentElement;
    if (!root) return;
    for (const feature of this.all) {
      if (!feature.enabled || !feature.htmlClass) continue;
      if (root.classList.contains(feature.htmlClass)) continue;
      const repairs = (this._guardCounts.get(feature.htmlClass) ?? 0) + 1;
      if (repairs > CLASS_GUARD_MAX_REPAIRS) {
        if (!this._guardWarned.has(feature.htmlClass)) {
          this._guardWarned.add(feature.htmlClass);
          console.warn(
            `${LOG_PREFIX} "${feature.htmlClass}" keeps being removed by the page ` +
              `(${CLASS_GUARD_MAX_REPAIRS} repairs) — giving up; something on the ` +
              'page is wiping <html class>.',
          );
        }
        continue;
      }
      this._guardCounts.set(feature.htmlClass, repairs);
      root.classList.add(feature.htmlClass);
    }
  }

  /** Tear everything down (beforeunload etc). */
  destroyAll() {
    for (const feature of this.all) {
      try {
        feature.destroy();
      } catch (err) {
        feature._warn('destroy failed', err);
      }
    }
  }
}