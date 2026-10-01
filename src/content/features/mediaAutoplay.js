/**
 * mediaAutoplay.js
 * ============================================================================
 * JS-driven feature — Media Autoplay.
 * Body class: `pt-autoplay-media`
 *
 * Pinterest stops/hovers media by default; when enabled this feature:
 *   1. force-autoplays every <video> it can reach (muted + loop, as required
 *      by browser autoplay policies), and
 *   2. replaces static/animated <img> pins (GIFs) with an equivalent
 *      <video autoplay muted loop> element (falling back to the GIF URL if
 *      the `.mp4` sibling is unavailable).
 *
 * Detecting newly rendered pins is handled by the shared `DomObserver`
 * wrapper — no per-feature MutationObserver boilerplate.
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

  /** Static images that may actually be animated content / GIFs. */
  gifImg: 'img[src*=".gif"], img[data-src*=".gif"], img[srcset*=".gif"]',

  /** Everything this feature processes (used for global scans). */
  media: 'video, img[src*=".gif"], img[data-src*=".gif"], img[srcset*=".gif"]',
};

export const mediaAutoplay = {
  id: 'mediaAutoplay',
  title: 'Media Autoplay',
  type: 'js',
  bodyClass: 'pt-autoplay-media',
  defaultValue: false,
  description: 'Autoplays videos and animated GIFs inside pins.',
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
      if (el.matches?.(MEDIA_SELECTORS.video)) {
        this._autoplayVideo(el);
      } else if (el.matches?.(MEDIA_SELECTORS.gifImg)) {
        this._gifToVideo(el);
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
   * Replace a static/animated GIF <img> with an autoplaying <video>.
   * We try the `.mp4` sibling of the `.gif` URL first (Pinterest's CDN
   * usually serves both); if the video fails to load we transparently
   * restore the original <img>.
   */
  _gifToVideo(img) {
    if (img.dataset?.ptGifVideo === '1') return;
    if (img.closest(MEDIA_SELECTORS.video)) return; // part of a player already
    if (!img.closest(MEDIA_SELECTORS.pin)) return; // only pin media — leave chrome alone

    const src = (img.currentSrc || img.src || img.dataset?.src || '').trim();
    if (!src || !/\.gif(\?|#|$)/i.test(src)) return;

    const container = img.parentElement;
    if (!container) return;

    const video = document.createElement('video');
    video.dataset.ptGifVideo = '1';
    video.muted = true;
    video.autoplay = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('muted', '');
    video.setAttribute('autoplay', '');
    video.setAttribute('loop', '');
    video.setAttribute('playsinline', '');

    const mp4 = src.replace(/\.gif(\?.*)?$/i, '.mp4$1');
    if (mp4 !== src) {
      const source = document.createElement('source');
      source.src = mp4;
      source.type = 'video/mp4';
      video.appendChild(source);
    }
    const sourceGif = document.createElement('source');
    sourceGif.src = src;
    sourceGif.type = 'video/gif';
    video.appendChild(sourceGif);

    // Keep the original so we can restore it if the video never loads.
    video._ptFallbackImg = img;

    container.replaceChild(video, img);
    this._autoplayVideo(video);

    video.addEventListener(
      'error',
      () => {
        video.replaceWith?.(video._ptFallbackImg);
        delete video._ptFallbackImg;
      },
      { once: true },
    );
  }

  /**
   * Undo everything on disable: remove our GIF→video replacements and stop
   * forcing autoplay on the rest.
   */
  _revert() {
    document.querySelectorAll('video[data-pt-gif-video="1"]').forEach((video) => {
      const fallback = video._ptFallbackImg;
      try {
        video.pause?.();
      } catch {
        /* noop */
      }
      if (fallback && fallback.parentNode) {
        video.replaceWith(fallback);
      } else {
        video.remove();
      }
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