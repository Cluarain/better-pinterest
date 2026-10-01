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
 *   CssFeature       : a CSS-driven feature — toggling one <body> class is a
 *                      complete implementation (the visual rules live in
 *                      master.css). No per-feature JS styling code.
 *   FeatureRegistry  : registers features and owns the lifecycle
 *                      (init -> enable/disable -> apply/state).
 * ============================================================================
 */

/** Log prefix used by all internal logging. */
const LOG_PREFIX = '[pt-tweaker]';

export class BaseFeature {
  /**
   * @param {Object} config
   * @param {string}   config.id              Unique id — storage key + message id.
   * @param {string}   [config.title]         Human readable name (popup).
   * @param {string}   [config.description]   Short description for the popup.
   * @param {string}   [config.type]          'css' (default) or 'js'.
   * @param {string}   [config.bodyClass]     Class toggled on <body>.
   * @param {boolean}  [config.defaultValue]  Default persisted state.
   */
  constructor(config = {}) {
    this.id = config.id;
    this.title = config.title ?? this.id;
    this.description = config.description ?? '';
    this.type = config.type ?? 'css';
    this.bodyClass = config.bodyClass ?? null;
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
   *   1. adds `bodyClass` to <body> (CSS-driven styling happens here), then
   *   2. runs the `onEnable()` hook for JS-driven logic.
   */
  enable() {
    if (this._enabled) return this;
    if (this.bodyClass) document.body?.classList.add(this.bodyClass);
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
   *   2. removes `bodyClass` from <body>.
   */
  disable() {
    if (!this._enabled) return this;
    try {
      this.onDisable();
    } catch (err) {
      this._warn('onDisable failed', err);
    }
    if (this.bodyClass) document.body?.classList.remove(this.bodyClass);
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
    console.debug(`${LOG_PREFIX} [${this.id}]`, ...args);
  }
}

/**
 * CSS-driven feature.
 *
 * The whole "implementation" is the `bodyClass` in the constructor config:
 * the registry adds/removes it on <body> and master.css does the rest.
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

  /** Tear everything down (beforeunload etc.). */
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