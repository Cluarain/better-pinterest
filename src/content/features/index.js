/**
 * features/index.js
 * ============================================================================
 * Feature catalogue — the ONE place every feature is declared.
 *
 * Adding a feature is exactly three steps:
 *   1. drop a new file in src/content/features/
 *        - CSS-driven: a plain config object (id / title / htmlClass / ...),
 *        - JS-driven:  a BaseFeature subclass with init/onEnable/onDisable.
 *   2. import it and add it to the `FEATURES` array below,
 *   3. add the matching rule(s) to src/content/styles/master.css.
 * Nothing else in the codebase needs to change.
 * ============================================================================
 */

import { darkMode } from './darkMode.js';
import { leftMenu } from './leftMenu.js';
import { searchBar } from './searchBar.js';
import { tabsBar } from './tabsBar.js';
import { pinBurger } from './pinBurger.js';
import { mediaAutoplay, MediaAutoplayFeature } from './mediaAutoplay.js';

/**
 * Ordered feature list. Plain configs are auto-wrapped into CssFeature
 * instances by FeatureRegistry.register(); instances are used as-is.
 */
export const FEATURES = [
  darkMode,
  leftMenu,
  searchBar,
  tabsBar,
  pinBurger,
  new MediaAutoplayFeature(mediaAutoplay),
];

/**
 * Default persisted state — the fallback used when storage is empty
 * (shared by popup, content bootstrap and background onInstalled).
 * @type {Readonly<Record<string, boolean>>}
 */
export const DEFAULT_STATE = Object.freeze(
  FEATURES.reduce((acc, feature) => {
    acc[feature.id] = feature.defaultValue;
    return acc;
  }, {}),
);

/** Look up a feature/config by id. */
export const getFeature = (id) => FEATURES.find((feature) => feature.id === id);