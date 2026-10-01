/**
 * mediaAutoplay.js
 * ============================================================================
 * JS-driven feature — Media Autoplay + GIF Originals.
 * HTML class: `pt-autoplay-media`
 *
 * 1. Autoplay every <video> inside pins (muted + loop + playsinline).
 * 2. Force-reveal the "placeholders" — until hover Pinterest renders only a jpg
 *    (pinrep-video--placeholder) and never creates a <video>. We dispatch
 *    synthetic pointer/mouse events into the center of the pin so Pinterest
 *    injects the <video>, and the MutationObserver autoplays it right away.
 * 3. GIF pins that Pinterest serves as a static jpg with the original .gif in
 *    `srcset` — we swap `src` for the original and drop `srcset`.
 *
 * Performance:
 *   - Every element is processed at most once (data marker).
 *   - IntersectionObserver defers work until the element enters the viewport.
 *   - MutationObserver only walks the added subtrees.
 *
 * Selectors maintenance:
 *   Pinterest changes class names on every deploy — all selectors live in
 *   MEDIA_SELECTORS.
 * ============================================================================
 */

import { BaseFeature } from '../core/registry.js';
import { DomObserver } from '../core/observer.js';

export const MEDIA_SELECTORS = {
  pin: '[data-test-id="pin"], [data-grid-item="true"]',
  video: 'video',
  videoPlaceholder: '[data-test-id="pinrep-video--placeholder"]',

  gifImg:
    'img[src*=".gif"], img[data-src*=".gif"], ' +
    'img[srcset*=".gif"], img[data-srcset*=".gif"]',

  media:
    'video, [data-test-id="pinrep-video--placeholder"], ' +
    'img[src*=".gif"], img[data-src*=".gif"], ' +
    'img[srcset*=".gif"], img[data-srcset*=".gif"]',
};

const MARK = 'ptMediaDone';    // element already processed
const GIF_MARK = 'ptGifOriginal';  // src swapped to the .gif
const HOVER_MARK = 'ptHoverNudged';  // pin already received a synthetic hover

/** Fallback release delay for the synthetic hover, ms (if no <video> appears). */
const HOVER_RELEASE_MS = 500;
/** Hover release delay after the <video> appears, ms. */
const HOVER_RELEASE_AFTER_VIDEO_MS = 100;

export const mediaAutoplay = {
  id: 'mediaAutoplay',
  title: 'Media Autoplay',
  type: 'js',
  htmlClass: 'pt-autoplay-media',
  defaultValue: false,
  description: 'Autoplays videos and GIF pins.',
};

export class MediaAutoplayFeature extends BaseFeature {
  constructor(config = mediaAutoplay) {
    super(config);
    /** @type {DomObserver|null} */
    this._observer = null;
    /** @type {IntersectionObserver|null} */
    this._io = null;
    /** @type {Map<Element, number>} pin → delayed hover-release timer id */
    this._pendingLeave = new Map();
  }

  init() {
    this._observer = new DomObserver();
    this._observer.on((mutations) => this._onMutations(mutations));

    this._io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this._processOne(entry.target);
          this._io.unobserve(entry.target);
        }
      },
      { rootMargin: '300px 0px', threshold: 0 }
    );
  }

  onEnable() {
    this._observer?.observe();
    this._scan(document);
  }

  onDisable() {
    this._observer?.disconnect();
    this._io?.disconnect();
    this._clearPendingLeave();
    this._revert();
  }

  /** Clear every pending hover-release timer (so none fire after disable). */
  _clearPendingLeave() {
    for (const tid of this._pendingLeave.values()) clearTimeout(tid);
    this._pendingLeave.clear();
  }

  // ─── Mutation plumbing ────────────────────────────────────────────────────

  _onMutations(mutations) {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList' || !mutation.addedNodes.length) continue;
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        this._scan(node);
      }
    }
  }

  /** Collect media elements inside root and hand them to the IntersectionObserver. */
  _scan(root) {
    const found = [];
    if (root instanceof Element && root.matches?.(MEDIA_SELECTORS.media)) {
      found.push(root);
    }
    const nested = root.querySelectorAll?.(MEDIA_SELECTORS.media);
    if (nested?.length) found.push(...nested);

    for (const el of found) {
      if (el.dataset?.[MARK] === '1') continue;
      this._io?.observe(el);
    }
  }

  // ─── Processing ──────────────────────────────────────────────────────────

  _processOne(el) {
    if (!(el instanceof Element)) return;

    if (el.matches(MEDIA_SELECTORS.video)) {
      if (el.dataset[MARK] === '1') return;
      el.dataset[MARK] = '1';
      this._autoplayVideo(el);
      return;
    }

    if (el.matches(MEDIA_SELECTORS.videoPlaceholder)) {
      const pin = el.closest(MEDIA_SELECTORS.pin);
      if (!pin || pin.dataset[HOVER_MARK] === '1') return;
      pin.dataset[HOVER_MARK] = '1';
      this._nudgePinToRevealVideo(pin);
      return;
    }

    if (el.matches(MEDIA_SELECTORS.gifImg)) {
      if (el.dataset[GIF_MARK] === '1') return;
      this._gifToOriginal(el);
    }
  }


  /**
   * Pinterest only creates the <video> on hover. We dispatch synthetic
   * pointer/mouse enter events into the center of the pin anchor, wait for the
   * <video> to appear and release the hover right away so the pin does not get
   * stuck in the hover state.
   */
  _nudgePinToRevealVideo(pin) {
    const target = pin.querySelector('a[href*="/pin/"]') || pin;
    const point = this._centerOf(target);

    // Set the fallback timer BEFORE dispatching: even if the event or the code
    // that follows throws, the hover is still released and never "sticks".
    const tid = setTimeout(() => this._releasePin(pin), HOVER_RELEASE_MS);
    this._pendingLeave.set(pin, tid);

    this._dispatchPointer(target, 'enter', point);
  }

  _releasePin(pin) {
    const tid = this._pendingLeave.get(pin);
    if (tid) {
      clearTimeout(tid);
      this._pendingLeave.delete(pin);
    }

    if (!pin.isConnected) return;
    if (pin.dataset[HOVER_MARK] !== '1') return;
    pin.dataset[HOVER_MARK] = '2'; // released

    const target = pin.querySelector('a[href*="/pin/"]') || pin;
    const point = this._centerOf(target);
    this._dispatchPointer(target, 'leave', point);
  }

  _centerOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  /**
   * Single dispatcher for synthetic pointer/mouse events.
   * - pointerover/out + mouseover/out — bubble and carry relatedTarget;
   * - pointerenter/leave + mouseenter/leave — do NOT bubble (as in the browser).
   */
  _dispatchPointer(target, phase, point) {
    const isEnter = phase === 'enter';

    // [type, bubbles]
    const events = isEnter
      ? [
        ['pointerover', true],
        ['pointerenter', false],
        ['pointermove', true],
        ['mouseover', true],
        ['mouseenter', false],
        ['mousemove', true],
      ]
      : [
        ['pointerout', true],
        ['pointerleave', false],
        ['mouseout', true],
        ['mouseleave', false],
      ];

    const PointerCtor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;

    for (const [type, bubbles] of events) {
      const isPointer = type.startsWith('pointer');
      const Ctor = isPointer ? PointerCtor : MouseEvent;

      const init = {
        bubbles,
        cancelable: true,
        composed: true,
        view: window,
        clientX: point.x,
        clientY: point.y,
        // relatedTarget only makes sense for non-enter/move events:
        relatedTarget: isEnter ? null : document.body,
      };

      if (isPointer) {
        init.pointerId = 1;
        init.pointerType = 'mouse';
        init.isPrimary = true;
      }

      try {
        target.dispatchEvent(new Ctor(type, init));
      } catch {
        /* ignore */
      }
    }
  }

  // ─── Video autoplay ──────────────────────────────────────────────────────

  _autoplayVideo(video) {
    if (video.dataset?.ptAutoplayed === '1') return;
    video.dataset.ptAutoplayed = '1';

    video.muted = true;
    video.defaultMuted = true;
    video.autoplay = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('muted', '');
    video.setAttribute('autoplay', '');
    video.setAttribute('loop', '');
    video.setAttribute('playsinline', '');
    if (!video.hasAttribute('preload') || video.preload === 'none') {
      video.preload = 'auto';
    }

    const kick = () => this._tryPlay(video);
    kick();

    // Pinterest often swaps the blob: src after mounting — this resets
    // playbackState. Restart on every key event.
    video.addEventListener('loadeddata', kick, { once: true });
    video.addEventListener('canplay', kick, { once: true });
    video.addEventListener('loadedmetadata', kick, { once: true });
    video.addEventListener('loadstart', kick, { once: true });

    const pin = video.closest(MEDIA_SELECTORS.pin);
    if (pin && pin.dataset[HOVER_MARK] === '1') {
      // Small delay so Pinterest has time to "bind" the video to the pin.
      setTimeout(() => this._releasePin(pin), HOVER_RELEASE_AFTER_VIDEO_MS);
    }
  }

  _tryPlay(video) {
    try {
      const r = video.play();
      if (r && typeof r.catch === 'function') r.catch(() => { });
    } catch { /* autoplay best-effort */ }
  }

  // ─── GIF → animated original ─────────────────────────────────────────────

  _gifToOriginal(img) {
    if (!(img instanceof HTMLImageElement)) return;
    if (img.dataset[GIF_MARK] === '1') return;
    if (img.closest(MEDIA_SELECTORS.video)) return;
    if (!img.closest(MEDIA_SELECTORS.pin)) return;

    const gifUrl = this._findGifUrl(img);
    if (!gifUrl) return;

    const current = (img.currentSrc || img.getAttribute('src') || '').trim();
    if (current === gifUrl) {
      img.dataset[GIF_MARK] = '1';
      return;
    }

    img.dataset[GIF_MARK] = '1';
    if (img.hasAttribute('src')) img.dataset.ptPrevSrc = img.getAttribute('src');
    else delete img.dataset.ptPrevSrc;
    if (img.hasAttribute('srcset')) img.dataset.ptPrevSrcset = img.getAttribute('srcset');
    else delete img.dataset.ptPrevSrcset;

    // Remove srcset first — otherwise the browser may pick the jpg variant.
    img.removeAttribute('srcset');
    img.src = gifUrl;
  }

  /** @returns {string|null} */
  _findGifUrl(img) {
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
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

  // ─── Revert on disable ───────────────────────────────────────────────────

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

    document.querySelectorAll('video[data-pt-autoplayed="1"]').forEach((video) => {
      delete video.dataset.ptAutoplayed;
      video.removeAttribute('autoplay');
      try { video.pause?.(); } catch { /* noop */ }
    });

    document.querySelectorAll('[data-pt-hover-nudged="1"]').forEach((el) => {
      delete el.dataset.ptHoverNudged;
    });
    document.querySelectorAll('[data-pt-media-done="1"]').forEach((el) => {
      delete el.dataset.ptMediaDone;
    });
  }
}