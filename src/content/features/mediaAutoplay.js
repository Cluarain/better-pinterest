/**
 * mediaAutoplay.js
 * ============================================================================
 * JS-driven feature — Media Autoplay + GIF Originals.
 * HTML class: `pt-autoplay-media`
 *
 * 1. force-autoplays every <video> it can reach (muted + loop);
 * 2. for GIF pins Pinterest often renders as a static .jpg preview with the
 *    real .gif hidden inside `srcset` (4x / originals). This feature swaps
 *    `src` to that original .gif and removes `srcset`, so the animated GIF
 *    is shown instead of the jpg thumbnail.
 *
 * ONLY GIF pins are touched — regular image pins are left alone.
 *
 * IMPORTANT (selector maintenance):
 *   Pinterest swaps generated class names on every deploy. All DOM selectors
 *   are collected in `MEDIA_SELECTORS` below — verify/update them when
 *   Pinterest changes its markup.
 * ============================================================================
 */

import { BaseFeature } from '../core/registry.js';
import { DomObserver } from '../core/observer.js';

/**
 * DOM selectors for this feature.
 * TODO(user): verify against Pinterest's current DOM.
 */
export const MEDIA_SELECTORS = {
  /** Pin card containers (any match works — first wins). */
  pin: '[data-test-id="pin"], [data-grid-item="true"]',

  /** Elements that should be autoplayed. */
  video: 'video',

  /**
   * GIF candidates:
   *   - .gif directly in src / data-src (rare now), OR
   *   - .gif hidden in srcset / data-srcset (jpg preview case — the common one).
   */
  gifImg:
    'img[src*=".gif"], img[data-src*=".gif"], ' +
    'img[srcset*=".gif"], img[data-srcset*=".gif"]',

  /** Everything this feature processes (used for global scans). */
  media:
    'video, img[src*=".gif"], img[data-src*=".gif"], ' +
    'img[srcset*=".gif"], img[data-srcset*=".gif"]',
};

export const mediaAutoplay = {
  id: 'mediaAutoplay',
  title: 'Media Autoplay',
  type: 'js',
  htmlClass: 'pt-autoplay-media',
  defaultValue: false,
  description:
    'Autoplays videos and GIF pins.',
};

export class MediaAutoplayFeature extends BaseFeature {
  constructor(config = mediaAutoplay) {
    super(config);
    /** @type {DomObserver|null} */
    this._observer = null;
  }

  /** One-time setup — called by FeatureRegistry.initAll on page load. */
  init() {
    this._observer = new DomObserver();
    this._observer.on((mutations) => this._onMutations(mutations));
  }

  onEnable() {
    this._observer?.observe();
    // Handle media that was already on the page before enabling.
    this._process(document.querySelectorAll(MEDIA_SELECTORS.media));
  }

  onDisable() {
    this._observer?.disconnect();
    this._revert();
  }

  _onMutations(mutations) {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const elements = [node, ...node.querySelectorAll(MEDIA_SELECTORS.media)];
        this._process(elements);
      }
    }
  }

  _process(elements) {
    for (const el of elements) {
      if (!(el instanceof Element)) continue;
      if (el.matches?.(MEDIA_SELECTORS.video)) {
        this._autoplayVideo(el);
      } else if (el.matches?.(MEDIA_SELECTORS.gifImg)) {
        this._gifToOriginal(el);
      }
    }
  }

  _autoplayVideo(video) {
    if (video.dataset?.ptAutoplayed === '1') return; // already handled
    video.dataset.ptAutoplayed = '1';
    video.muted = true;
    video.autoplay = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('muted', '');
    video.setAttribute('autoplay', '');
    video.setAttribute('loop', '');
    video.setAttribute('playsinline', '');
    if (!video.hasAttribute('preload')) video.preload = 'metadata';
    // Some Pinterest players swap `src` in place — retry once media is ready.
    video.addEventListener('loadedmetadata', () => this._tryPlay(video), { once: true });
    this._tryPlay(video);
  }

  _tryPlay(video) {
    try {
      const result = video.play();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      /* autoplay can be rejected; this feature is best-effort by design */
    }
  }

  /**
   * Replace the jpg preview of a GIF pin with the original animated .gif.
   *
   * Pinterest serves GIF pins like:
   *   src    = https://i.pinimg.com/236x/<id>.jpg
   *   srcset = ...236x/<id>.jpg 1x, ...474x/<id>.jpg 2x,
   *            ...736x/<id>.jpg 3x, .../originals/<id>.gif 4x
   *
   * We pick the .gif entry from srcset and assign it to `src`, then drop
   * `srcset` entirely so the browser cannot fall back to the jpg variants.
   * Original values are stored in `data-pt-prev-*` for a clean revert.
   */
  _gifToOriginal(img) {
    if (!(img instanceof HTMLImageElement)) return;
    if (img.dataset?.ptGifOriginal === '1') return; // already handled
    if (img.closest(MEDIA_SELECTORS.video)) return; // part of a <video> player
    if (!img.closest(MEDIA_SELECTORS.pin)) return; // only pin media — leave chrome alone

    const gifUrl = this._findGifUrl(img);
    if (!gifUrl) return;

    // If the current src already points at this gif, nothing to do.
    const current = (img.currentSrc || img.getAttribute('src') || '').trim();
    if (current === gifUrl) {
      img.dataset.ptGifOriginal = '1';
      return;
    }

    // Remember original attributes so we can undo on disable.
    img.dataset.ptGifOriginal = '1';
    if (img.hasAttribute('src')) img.dataset.ptPrevSrc = img.getAttribute('src');
    else delete img.dataset.ptPrevSrc;
    if (img.hasAttribute('srcset')) img.dataset.ptPrevSrcset = img.getAttribute('srcset');
    else delete img.dataset.ptPrevSrcset;

    // Drop srcset first — otherwise the browser may keep picking a jpg.
    img.removeAttribute('srcset');
    img.src = gifUrl;
  }

  /**
   * Find the original .gif URL for a pin <img>.
   * Priority: srcset → data-srcset → src → data-src.
   * @returns {string|null}
   */
  _findGifUrl(img) {
    const srcset =
      img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
    if (srcset) {
      for (const entry of srcset.split(',')) {
        const url = entry.trim().split(/\s+/)[0];
        if (url && /\.gif(\?|#|$)/i.test(url)) return url;
      }
    }
    const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
    if (/\.gif(\?|#|$)/i.test(src)) return src;
    return null;
  }

  /**
   * Undo everything on disable: restore original src/srcset on GIF imgs and
   * stop forcing autoplay on the rest.
   */
  _revert() {
    document.querySelectorAll('img[data-pt-gif-original="1"]').forEach((img) => {
      const prevSrc = img.dataset.ptPrevSrc;
      const prevSrcset = img.dataset.ptPrevSrcset;

      delete img.dataset.ptGifOriginal;
      delete img.dataset.ptPrevSrc;
      delete img.dataset.ptPrevSrcset;

      if (prevSrcset != null) img.setAttribute('srcset', prevSrcset);
      if (prevSrc != null) img.setAttribute('src', prevSrc);
    });

    document.querySelectorAll(MEDIA_SELECTORS.video).forEach((video) => {
      if (video.dataset?.ptAutoplayed !== '1') return;
      delete video.dataset.ptAutoplayed;
      video.removeAttribute('autoplay');
      try {
        video.pause?.();
      } catch {
        /* noop */
      }
    });
  }
}