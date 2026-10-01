/**
 * index.js — content script ENTRY POINT.
 * ============================================================================
 * Manifest V3 content scripts cannot use static ES imports, so this file is a
 * plain (non-module) script that dynamic-imports the extension ES modules via
 * chrome.runtime.getURL(). Every imported file must be listed under
 * `web_accessible_resources` in manifest.json.
 *
 * Boot sequence (see bootstrap()):
 *   1. subscribe to storage changes IMMEDIATELY (events arriving before the
 *      registry is up are buffered and flushed later — no lost toggles),
 *   2. register every feature and apply the persisted state,
 *   3. inject the single master stylesheet  (<style id="pt-master-styles">),
 *   4. keep reacting to storage/messages for the rest of the session.
 * ============================================================================
 */
(() => {
  'use strict';

  // Live status marker on <html> — the DOM is shared between the page and the
  // content script's isolated world, so unlike window.__ptTweaker it is visible
  // BOTH in the Elements panel and from the page console:
  //   loading → ready | error   (see document.documentElement.dataset.ptTweaker)
  try {
    document.documentElement.dataset.ptTweaker = 'loading';
  } catch {
    /* documentElement not ready */
  }

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

  /** @type {import('./core/registry.js').FeatureRegistry|null} */
  let registry = null;
  let bootstrapped = false;

  /**
   * Parser for `<featureId>.<settingId>` storage keys — supplied by the
   * registry module during bootstrap (content scripts can't statically import).
   * @type {((key: string) => { featureId: string, settingId: string }|null)|null}
   */
  let parseSettingKey = null;

  // ---------------------------------------------------------------------------
  // Storage changes that arrive while bootstrap() is still running (e.g. the
  // user flips a popup toggle in the first second of page load) are buffered
  // here and re-applied in bootstrap() right after the registry is ready.
  // ---------------------------------------------------------------------------
  const pendingChanges = [];

  // Debug bridge — lets the PAGE console (default DevTools context, where
  // isolated-world globals like window.__ptTweaker are invisible) toggle
  // features directly:
  //   document.dispatchEvent(new CustomEvent('pt-tweaker:toggle',
  //     { detail: { id: 'darkMode', enabled: true } }))
  document.addEventListener('pt-tweaker:toggle', (event) => {
    const { id, enabled } = event?.detail ?? {};
    if (!registry || typeof enabled !== 'boolean' || !registry.has(id)) return;
    registry.apply(id, enabled);
    console.info(`${LOG_PREFIX} "${id}" = ${enabled} (via pt-tweaker:toggle event)`);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!bootstrapped || !registry) {
      pendingChanges.push(changes);
      return;
    }
    applyChanges(changes);
  });

  /** @param {Record<string, {newValue?: *}>} changes */
  function applyChanges(changes) {
    for (const [key, change] of Object.entries(changes)) {
      // Feature toggle — the storage key IS the feature id (boolean value).
      if (registry?.has(key)) {
        if (typeof change.newValue === 'boolean') registry.apply(key, change.newValue);
        continue;
      }
      // Feature setting — the storage key is "<featureId>.<settingId>".
      const parsed = parseSettingKey ? parseSettingKey(key) : null;
      if (parsed && registry?.has(parsed.featureId)) {
        registry.applySetting(parsed.featureId, parsed.settingId, change.newValue);
      }
    }
  }

  /**
   * Inject master.css exactly once as a <style> element.
   * @returns {Promise<void>} never rejects — failures are logged, not fatal.
   */
  async function injectMasterStyles() {
    try {
      if (document.getElementById(STYLE_ID)) return;
      const response = await fetch(MASTER_CSS_URL);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const css = await response.text();
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    } catch (err) {
      // Feature toggles (html classes) keep working even without the CSS —
      // the visual rules will simply be missing until the page reloads.
      console.warn(
        `${LOG_PREFIX} master.css injection failed (html classes still toggle, styles missing):`,
        err,
      );
    }
  }

  async function bootstrap() {
    console.info(`${LOG_PREFIX} content script injected on ${location.href}`);

    // Re-apply any storage change that was buffered while modules loaded.
    const [
      { FeatureRegistry, parseSettingKey: parseKey },
      { Storage },
      { FEATURES, DEFAULT_STATE },
    ] = await Promise.all([
      import(MODULE_URLS.registry),
      import(MODULE_URLS.storage),
      import(MODULE_URLS.features),
    ]);

    parseSettingKey = parseKey;

    const store = new Storage('local');

    registry = new FeatureRegistry();
    FEATURES.forEach((feature) => registry.register(feature));

    // Mirror the live state into <html data-pt-state> — inspectable from the
    // page console / Elements panel (works across isolated-world boundaries).
    registry.onStateChange = (state) => {
      try {
        document.documentElement.dataset.ptState = JSON.stringify(state);
      } catch {
        /* no documentElement */
      }
    };

    const state = await store.getAll(DEFAULT_STATE);
    registry.initAll(state);

    await injectMasterStyles();

    // Secondary transport: direct messages from the popup (idempotent — the
    // same state change also arrives via the storage event above).
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.type !== MESSAGE_TYPE) return;
      const { featureId, enabled } = message;
      if (registry?.has(featureId)) registry.apply(featureId, enabled);
      try {
        sendResponse?.({ ok: true });
      } catch {
        /* channel may already be closed */
      }
    });

    // Debug handle — tune selectors from the DevTools console.
    try {
      window.__ptTweaker = { registry, state, DEFAULT_STATE, applyChanges };
    } catch {
      /* non-window context; nothing to attach to */
    }

    bootstrapped = true;
    const buffered = pendingChanges.splice(0);
    for (const changes of buffered) applyChanges(changes);

    try {
      document.documentElement.dataset.ptTweaker = 'ready';
    } catch {
      /* no documentElement */
    }
    console.info(`${LOG_PREFIX} bootstrap complete, applying`, registry.state);
    return { registry, state };
  }

  bootstrap().catch((err) => {
    try {
      document.documentElement.dataset.ptTweaker = 'error';
    } catch {
      /* no documentElement */
    }
    console.error(
      `${LOG_PREFIX} bootstrap failed — NO feature classes will be applied. Check:`,
      err,
    );
    console.error(
      `${LOG_PREFIX}  1) every file imported via import(chrome.runtime.getURL(...)) ` +
        'is listed under "web_accessible_resources" in manifest.json;',
    );
    console.error(
      `${LOG_PREFIX}  2) the page URL matches "content_scripts.matches" in manifest.json;`,
    );
    console.error(
      `${LOG_PREFIX}  3) the extension was re-loaded on chrome://extensions and the Pinterest tab was refreshed.`,
    );
    console.error(
      `${LOG_PREFIX}  4) "<html data-pt-tweaker>" in the Elements panel reads ` +
        "'error' if this failure happened — the first error above is the cause.",
    );
  });
})();