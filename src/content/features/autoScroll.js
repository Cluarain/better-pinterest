/**
 * autoScroll.js
 * ============================================================================
 * JS-driven feature — Auto Scroll.
 *
 * Continuously scrolls the feed so you never touch the wheel. Unlike the CSS
 * toggles this feature is *configurable*: it declares a `settings` schema
 * (`speed`) which the popup renders as a dropdown and the registry persists
 * under the storage key `autoScroll.speed` (see `settingKey` in core/registry).
 *
 * The scroll loop runs on requestAnimationFrame and advances the page by
 * `pixelsPerSecond * deltaTime`, so the perceived speed is identical on 60 Hz
 * and 120 Hz displays.
 * ============================================================================
 */

import { BaseFeature } from '../core/registry.js';

/** Named speeds → pixels scrolled per second. */
export const SCROLL_SPEEDS = Object.freeze({
  slow: 110,
  normal: 240,
  fast: 440,
});

/** Setting descriptor shared by the config and the runtime fallback. */
const SPEED_SETTING = {
  id: 'speed',
  label: 'Scroll speed',
  type: 'select',
  defaultValue: 'normal',
  options: [
    { value: 'slow', label: 'Slow' },
    { value: 'normal', label: 'Normal' },
    { value: 'fast', label: 'Fast' },
  ],
};

export const autoScroll = {
  id: 'autoScroll',
  title: 'Auto Scroll',
  type: 'js',
  defaultValue: false,
  description: 'Scrolls the feed automatically at a chosen speed.',
  settings: [SPEED_SETTING],
};

export class AutoScrollFeature extends BaseFeature {
  constructor(config = autoScroll) {
    super(config);
    /** requestAnimationFrame id of the running loop (0 = stopped). */
    this._rafId = 0;
    /** Timestamp of the previous frame, ms (0 = first frame still pending). */
    this._lastTs = 0;
    /** Resolved scroll speed, px/s. */
    this._pps = this._resolveSpeed(this.settingValues.speed);
  }

  init() {
    this._onFrame = this._onFrame.bind(this);
  }

  /** Keep the live speed in sync while the feature is running. */
  onSettings() {
    this._pps = this._resolveSpeed(this.settingValues.speed);
  }

  onEnable() {
    this._pps = this._resolveSpeed(this.settingValues.speed);
    this._lastTs = 0;
    if (!this._rafId) this._rafId = requestAnimationFrame(this._onFrame);
  }

  onDisable() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = 0;
  }

  /**
   * @param {string} speed named speed key
   * @returns {number} pixels per second (normal as fallback)
   */
  _resolveSpeed(speed) {
    return SCROLL_SPEEDS[speed] ?? SCROLL_SPEEDS[SPEED_SETTING.defaultValue];
  }

  /** rAF loop — scrolls by the elapsed time so the speed is frame-rate independent. */
  _onFrame(timestamp) {
    if (!this.enabled) {
      this._rafId = 0;
      return;
    }
    this._rafId = requestAnimationFrame(this._onFrame);

    if (!this._lastTs) {
      this._lastTs = timestamp;
      return;
    }
    const deltaSeconds = (timestamp - this._lastTs) / 1000;
    this._lastTs = timestamp;
    if (deltaSeconds <= 0) return;

    const scroller = document.scrollingElement || document.documentElement;
    if (scroller) scroller.scrollTop += this._pps * deltaSeconds;
  }
}
