/**
 * index.js — content script ENTRY POINT.
 * ============================================================================
 * Manifest V3 content scripts cannot use static ES imports, so this file is a
 * plain (non-module) script that dynamic-imports the extension ES modules via
 * chrome.runtime.getURL(). Every imported file must be listed under
 * `web_accessible_resources` in manifest.json.
 *
 * Boot sequence (see bootstrap()):
 *   1. inject the single master stylesheet  (<style id="pt-master-styles">),
 *   2. read the persisted state once,
 *   3. register every feature and apply the initial state,
 *   4. react to storage changes (popup toggles) for the rest of the session.
 * ============================================================================
 */
(() => {
  'use strict';

  const LOG_PREFIX = '[pt-tweaker]';
  const STYLE_ID = 'pt-master-styles';
  const MASTER_CSS_URL = chrome.runtime.getURL('src/content/styles/master.css');

  /** Message contract shared with popup.js and the background worker. */
  const MESSAGE_TYPE = 'PT_TWEAKER_TOGGLE';

  const MODULE_URLS = {
    registry: chrome.runtime.getURL('src/content/core/registry.js'),
    storage: chrome.runtime.getURL('src/content/core/storage.js'),
    features: chrome.runtime.getURL('src/content/features/index.js'),
  };

  /**
   * Inject master.css exactly once as a <style> element.
   * The stylesheet stays constant for the whole page life; toggles only ever
   * add/remove classes on <body> (no per-toggle style writes, no flicker).
   */
  async function injectMasterStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const response = await fetch(MASTER_CSS_URL);
    if (!response.ok) {
      throw new Error(`master.css load failed (HTTP ${response.status})`);
    }
    const css = await response.text();
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  async function bootstrap() {
    const [{ FeatureRegistry }, { Storage }, { FEATURES, DEFAULT_STATE }] = await Promise.all([
      import(MODULE_URLS.registry),
      import(MODULE_URLS.storage),
      import(MODULE_URLS.features),
    ]);

    await injectMasterStyles();

    const store = new Storage('local');
    const state = await store.getAll(DEFAULT_STATE);

    const registry = new FeatureRegistry();
    FEATURES.forEach((feature) => registry.register(feature));
    registry.initAll(state);

    // React to popup toggles (chrome.storage.local => single source of truth).
    store.onChanged((changes) => {
      for (const [featureId, change] of Object.entries(changes)) {
        if (!registry.has(featureId)) continue;
        if (typeof change.newValue !== 'boolean') continue;
        registry.apply(featureId, change.newValue);
      }
    });

    // Secondary transport: direct messages from the popup (idempotent — the
    // same state change also arrives via the storage event above).
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.type !== MESSAGE_TYPE) return;
      const { featureId, enabled } = message;
      if (registry.has(featureId)) registry.apply(featureId, enabled);
      try {
        sendResponse?.({ ok: true });
      } catch {
        /* channel may already be closed */
      }
    });

    // Debug handle — tune selectors from the DevTools console.
    try {
      window.__ptTweaker = { registry, state, DEFAULT_STATE };
    } catch {
      /* non-window context; nothing to attach to */
    }

    console.debug(`${LOG_PREFIX} bootstrap complete`, registry.state);
  }

  bootstrap().catch((err) => console.error(`${LOG_PREFIX} bootstrap failed`, err));
})();