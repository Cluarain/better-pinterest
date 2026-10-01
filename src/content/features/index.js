/**
 * features/index.js
 * ============================================================================
 * Feature catalogue — the ONE place every feature is declared.
 *
 * Files are split by logic; `FEATURE_GROUPS` below is the single source of
 * truth for both the flat feature list and the popup sections:
 *
 *   darkMode.js      → Theme         (appearance)
 *   bars.js          → Bars & Panels (leftMenu + searchBar + tabsBar)
 *   pinGlobal.js     → Pins          (every pin-appearance tweak lives here)
 *   mediaAutoplay.js → Feed & Media  (JS)
 *   autoScroll.js    → Feed & Media  (JS, configurable)
 *
 * Adding a feature is exactly three steps:
 *   1. drop a new file in src/content/features/
 *        - CSS-driven: a plain config object (id / title / htmlClass / ...),
 *        - JS-driven:  a BaseFeature subclass with init/onEnable/onDisable.
 *   2. import it and add it to the matching group in `FEATURE_GROUPS`,
 *   3. add the matching rule(s) to src/content/styles/master.css.
 * Nothing else in the codebase needs to change.
 *
 * Settings: a feature may declare `settings: [{ id, label, type, options,
 * defaultValue }]`. Those are persisted under `<featureId>.<settingId>` keys
 * (see settingKey/parseSettingKey in core/registry.js) and rendered by the
 * popup — still nothing else in the codebase needs to change.
 * ============================================================================
 */

import { settingKey } from '../core/registry.js';
import { darkMode } from './darkMode.js';
import { leftMenu, searchBar, tabsBar } from './bars.js';
import { hidePinMenu } from './pinGlobal.js';
import { mediaAutoplay, MediaAutoplayFeature } from './mediaAutoplay.js';
import { autoScroll, AutoScrollFeature } from './autoScroll.js';

/**
 * Ordered feature GROUPS — both the popup sections and the flat FEATURES list
 * are derived from this single array, so grouping stays in one place.
 * @type {Array<{ id: string, title: string, features: Array<Object> }>}
 */
export const FEATURE_GROUPS = [
  {
    id: 'theme',
    title: 'Theme',
    features: [darkMode],
  },
  {
    id: 'panels',
    title: 'Bars & Panels',
    features: [leftMenu, searchBar, tabsBar],
  },
  {
    id: 'pins',
    title: 'Pins',
    features: [hidePinMenu],
  },
  {
    id: 'feed',
    title: 'Feed & Media',
    features: [
      new MediaAutoplayFeature(mediaAutoplay),
      new AutoScrollFeature(autoScroll),
    ],
  },
];

/**
 * Flat, ordered feature list. Plain configs are auto-wrapped into CssFeature
 * instances by FeatureRegistry.register(); instances are used as-is.
 */
export const FEATURES = FEATURE_GROUPS.flatMap((group) => group.features);

/**
 * Default persisted state — the fallback used when storage is empty (shared by
 * popup, content bootstrap and background onInstalled). Keys are feature ids
 * (boolean toggles) plus `<featureId>.<settingId>` for every declared setting
 * (e.g. `autoScroll.speed`).
 * @type {Readonly<Record<string, boolean|string|number>>}
 */
export const DEFAULT_STATE = Object.freeze({
  ...FEATURES.reduce((acc, feature) => {
    acc[feature.id] = feature.defaultValue;
    return acc;
  }, {}),
  ...FEATURES.reduce((acc, feature) => {
    for (const setting of feature.settings ?? []) {
      acc[settingKey(feature.id, setting.id)] = setting.defaultValue;
    }
    return acc;
  }, {}),
});

/** Look up a feature/config by id. */
export const getFeature = (id) => FEATURES.find((feature) => feature.id === id);