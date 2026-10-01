/**
 * autoScroll.js
 * ============================================================================ * JS-driven feature — Auto Scroll («-driven feature — Auto Scroll ("last visible element" mode).
 *
 * Логика:
 *   1. Каждый кадр страница плавно едет плавно едет вниз со скоростью `speed` px/s
 *      (никаких easing-сегментов и пауз — непрерыв).
 *   2. Раз в CHECK_INTERVAL_MS пересчитываем «последний видимый элемент»
 *      (сам упирается в кромку вьюпорта) и, если он уехал дальше,
 *      сдвигаем цель вниз — к его нижней кромке. Едем же *   3. цельута, сразу перепроверяем элемент (не ждём секунду),
 *      чтобы не было пауз. Если элемент не сменился — не сменился — ждём следующий *      плановый тик: значитовый тик: значит, дошли до конца или ещё не подгрузился контент.
 *
 * Ползунок `speed` — это буквально пиксели в секунду. Никаких клампов
 * длительности, поэтому скорость ощущается линейно.
 *
 * Smoothness-приёмы:
 *   - позиция в float, пишем АБСОЛЮТНОЕ значение scrollTop, не `+=`; *   - просевший кадр клампим (MAX_FRAME_DT), чтобы не было прыжка;
 *   - `html.pt-autoscroll` форdt через EMA, чтобы микро скоростьги не превращались в рывки;
 *   - цель форсит `scroll-behavior: auto`.
 *
 * Экспортирует переиспользуемые `Easing` и `slowScrollTo` (не используются * фичей, но оставлены как публичные утилиты).
 * ============================================================================
 */

import { BaseFeature } from '../core/registry.js';

/** частоепверяем «последний видимый элемент», ms. */
const CHECK_INTERVAL_MS = 1000;

/** Если цель достигнута — не ждём полный тик, а перепроверяем через это, ms. */
const ARRIVAL_RECHECK_MS = 150;

/** Просевший кадр клампим — иначе один лаг превращается в прыжок. */
const MAX_FRAME_DT = 1 / 20;

/** Мельче этого (px по любой стороне) элемент игнорируем — мусорные узлы. */
const MIN_ELEMENT_SIZE = 8;

/** Смещение целевой линии от верха вьюпорта, px. */
const TARGET_TOP_OFFSET = 0;

/**
 * Setting descriptor. `type: 'range'` → в попапе это ползунок; значение
 * (px/s) хранится под ключом `autoScroll.speed`.
 */
const SPEED_SETTING = {
  id: 'speed',
  label: 'Scroll speed',
  type: 'range',
  defaultValue: 100,
  min: 10,
  max: 1000,
  step: 10,
  unit: 'px/s',
};

export const autoScroll = {
  id: 'autoScroll',
  title: 'Auto Scroll',
  type: 'js',
  htmlClass: 'pt-autoscroll',
  defaultValue: false,
  description:
    'Smoothly scrolls down, following the last visible element on the page.',
  settings: [SPEED_SETTING],
};

/* ==========================================================================
 * Easing (публичные утилиты, фичей не используются)
 * ======================================================================== */

export const Easing = Object.freeze({
  linear: (t) => t,
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outCubic: (t) => 1 - (1 - t) ** 3,
});

/* ==========================================================================
 * slowScrollTo (публичная утилита, фичей не используется)
 * ======================================================================== */

let activeAnimation = null;

export function slowScrollTo(targetY, duration = 600, options = {}) {
  const {
    easing = Easing.inOutQuad,
    scroller = document.scrollingElement || document.documentElement,
    onUpdate,
    cancelPrevious = true,
  } = options;

  if (!scroller) {
    return { cancel() { }, cancelled: true, finished: Promise.resolve(0) };
  }

  if (cancelPrevious && activeAnimation) activeAnimation.cancel();

  const maxY = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const from = scroller.scrollTop;
  const to = Math.min(Math.max(targetY, 0), maxY);
  const distance = to - from;

  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reducedMotion || duration <= 0 || Math.abs(distance) < 0.5) {
    scroller.scrollTop = to;
    onUpdate?.(to);
    return { cancel() { }, cancelled: false, finished: Promise.resolve(to) };
  }

  let rafId = 0;
  let startTs = 0;
  let cancelled = false;
  let settle;
  const finished = new Promise((resolve) => {
    settle = resolve;
  });

  const handle = {
    get cancelled() {
      return cancelled;
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (activeAnimation === handle) activeAnimation = null;
      settle(scroller.scrollTop);
    },
    finished,
  };

  const step = (timestamp) => {
    if (cancelled) return;
    if (startTs === 0) startTs = timestamp;

    const progress = Math.min((timestamp - startTs) / duration, 1);
    const y = from + distance * easing(progress);

    scroller.scrollTop = y;
    onUpdate?.(y);

    if (progress < 1) {
      rafId = requestAnimationFrame(step);
    } else {
      if (activeAnimation === handle) activeAnimation = null;
      settle(y);
    }
  };

  activeAnimation = handle;
  rafId = requestAnimationFrame(step);
  return handle;
}

/* ==========================================================================
 * Feature
 * ======================================================================== */

export class AutoScrollFeature extends BaseFeature {
  constructor(config = autoScroll) {
    super(config);

    /** requestAnimationFrame id (0 = остановлен). */
    this._rafId = 0;
    /** Timestamp предыдущего кадра (0 = первый кадр ещё не пришёл). */
    this._lastTs = 0;

    /** Наша float-позиция скролла (в неё же пишем scrollTop). */
    this._pos = 0;
    /** Последнее записанное значение — чтобы ловить внешний скролл. */
    this._applied = 0;

    /** Куда едем: scroll-координата, при которой нижняя кромка отслеживаемого
     *  элемента окажется у верхней границы вьюпорта. */
    this._targetY = 0;

    /** Последний найденный «последний видимый элемент» (для сравнения). */
    this._lastEl = null;

    /** Тайминги для периодического пересчёта. */
    this._lastCheckTs = 0;
    this._nextCheckTs = 0;

    /** Сглаженный dt для плавной скорости. */
    this._smoothDt = 1 / 60;

    /** Фича включена и цикл крутится. */
    this._running = false;
  }

  init() {
    this._onFrame = this._onFrame.bind(this);
  }

  /** Скорость читается живьём каждый кадр, кэшировать нечего. */
  onSettings() { }

  onEnable() {
    this._running = true;
    this._lastEl = null;
    this._lastTs = 0;
    this._lastCheckTs = 0;
    this._nextCheckTs = 0;
    this._smoothDt = 1 / 60;

    const scroller = this._scroller();
    this._pos = scroller ? scroller.scrollTop : 0;
    this._applied = this._pos;
    this._targetY = this._pos;

    // Сразу ищем первый элемент, чтобы не ждать секунду до первого _recheck
    this._recheck();

    if (!this._rafId) this._rafId = requestAnimationFrame(this._onFrame);
  }

  onDisable() {
    this._running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
    this._lastEl = null;
  }

  // ─── rAF loop ─────────────────────────────────────────────────────────────

  _onFrame(timestamp) {
    if (!this._running) {
      this._rafId = 0;
      return;
    }
    this._rafId = requestAnimationFrame(this._onFrame);

    if (this._lastTs === 0) {
      this._lastTs = timestamp;
      this._nextCheckTs = timestamp + CHECK_INTERVAL_MS;
      return;
    }

    let dt = (timestamp - this._lastTs) / 1000;
    this._lastTs = timestamp;
    if (dt <= 0) return;
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;

    // ── Сглаживание dt через EMA ──────────────────────────────────────────
    // Это убирает микро-рывки от переменного dt (лаги браузера).
    // Коэффициент 0.8/0.2 — баланс между плавностью и отзывчивостью.
    this._smoothDt = this._smoothDt * 0.8 + dt * 0.2;

    const scroller = this._scroller();
    if (!scroller) return;

    // ── Защита от внешнего скролла ────────────────────────────────────────
    // Если пользователь прокрутил вручную, синхронизируем позицию.
    if (Math.abs(scroller.scrollTop - this._applied) > 2) {
      this._pos = scroller.scrollTop;
      this._applied = this._pos;
    }

    // ── Пересчёт цели ─────────────────────────────────────────────────────
    const reached = this._pos >= this._targetY - 0.5;
    const dueByTimer = timestamp >= this._nextCheckTs;
    const dueByArrival = reached && (timestamp - this._lastCheckTs >= ARRIVAL_RECHECK_MS);

    if (dueByTimer || dueByArrival) {
      this._lastCheckTs = timestamp;
      if (dueByTimer) this._nextCheckTs = timestamp + CHECK_INTERVAL_MS;
      this._recheck();
    }

    // ── Движение ──────────────────────────────────────────────────────────
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const speed = this._resolveSpeed(this.settingValues.speed);
    const target = Math.min(this._targetY, maxScroll);

    const remaining = target - this._pos;

    if (Math.abs(remaining) > 0.5) {
      // Линейное движение со сглаженным dt.
      let step = Math.sign(remaining) * speed * this._smoothDt;

      // Clamp на последнем шаге: не перескакиваем цель, а аккуратно докатываемся.
      if (Math.abs(step) > Math.abs(remaining)) {
        step = remaining;
      }

      this._pos += step;
    } else {
      this._pos = target;
    }

    // Ограничиваем диапазон
    if (this._pos < 0) this._pos = 0;
    else if (this._pos > maxScroll) this._pos = maxScroll;

    // ── Запись scrollTop ──────────────────────────────────────────────────
    // Пишем только при заметном изменении (>0.5px), чтобы не дёргать DOM
    // микро-изменениями, которые браузер всё равно округлит до integer.
    if (Math.abs(this._pos - this._applied) > 0.5) {
      this._applied = this._pos;
      scroller.scrollTop = this._pos;
    }
  }

  // ─── Поиск и цель ─────────────────────────────────────────────────────────

  /** Пересчитать цель по текущему «последнему видимому» элементу. */
  _recheck() {
    const el = this._findLastVisible();
    if (!el) return;

    const scroller = this._scroller();
    if (!scroller) return;

    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;

    // ── КЛЮЧЕВОЙ ФИКС ────────────────────────────────────────────────────
    // Ограничиваем смещение высотой вьюпорта, чтобы «длинные» элементы
    // не устраивали прыжки цели на тысячи пикселей.
    // Если элемент маленький (bottom < vh) — используем его bottom.
    // Если элемент большой (bottom > vh) — используем vh (один экран вниз).
    const offset = Math.min(rect.bottom, vh);

    // Цель: scroll-координата, при которой нижняя кромка элемента
    // окажется у верхней границы вьюпорта.
    // Используем _pos вместо scroller.scrollTop для внутренней консистентности.
    const target = this._pos + offset - TARGET_TOP_OFFSET;

    // Цель двигаем только вперёд — назад не откатываемся.
    if (target > this._targetY) {
      this._targetY = target;
      this._lastEl = el;
    }
  }

  /**
   * Ищем «последний видимый элемент» — тот, что лежит у нижней кромки
   * вьюпорта. elementsFromPoint возвращает реально видимые элементы в порядке
   * от верхнего (paint order) к нижнему, поэтому крупные обёртки-контейнеры
   * сами отсеиваются — приоритет у листовых узлов.
   */
  _findLastVisible() {
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const vw = window.innerWidth || document.documentElement.clientWidth;

    let bestEl = null;
    let bestBottom = -Infinity;

    // ── КЛЮЧЕВОЙ ФИКС ────────────────────────────────────────────────────
    // Вместо одной точки у нижней кромки (vh-2), которая ловит «длинные»
    // элементы с огромным rect.bottom, проверяем точки в верхней и средней
    // части вьюпорта. Это даёт стабильный результат без «прыжков» цели.
    const yPoints = [vh * 0.25, vh * 0.5, vh * 0.75];
    const xPoints = [vw * 0.5, vw * 0.3, vw * 0.7];

    for (const y of yPoints) {
      for (const x of xPoints) {
        const stack =
          typeof document.elementsFromPoint === 'function'
            ? document.elementsFromPoint(x, y)
            : [document.elementFromPoint(x, y)].filter(Boolean);

        for (const el of stack) {
          if (!el || el === document.documentElement || el === document.body) {
            continue;
          }
          if (!(el instanceof HTMLElement)) continue;
          if (el.hasAttribute('data-pt-autoscroll-anchor')) continue;

          const rect = el.getBoundingClientRect();
          if (rect.width < MIN_ELEMENT_SIZE || rect.height < MIN_ELEMENT_SIZE) {
            continue;
          }

          // ── ФИКС: фильтруем «длинные» контейнеры ──────────────────────
          // Элементы, занимающие >80% высоты вьюпорта — обычно обёртки
          // (main, section, div), а не контент. Их rect.bottom может быть
          // огромным, что вызывает прыжки цели.
          if (rect.height > vh * 0.8) continue;

          // Фиксированные/липкие оверлеи (шапки, футеры, чаты) — не контент.
          const pos = window.getComputedStyle(el).position;
          if (pos === 'fixed' || pos === 'sticky') continue;

          // Элемент должен быть хотя бы частично виден
          if (rect.top >= vh || rect.bottom <= 0) continue;

          // Выбираем элемент с наибольшим rect.bottom (самый нижний)
          if (rect.bottom > bestBottom) {
            bestBottom = rect.bottom;
            bestEl = el;
          }
        }
      }
    }

    return bestEl;
  }

  // ─── Хелперы ──────────────────────────────────────────────────────────────

  /** @returns {number} clamped px/s (default as fallback) */
  _resolveSpeed(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return SPEED_SETTING.defaultValue;
    return Math.min(Math.max(numeric, SPEED_SETTING.min), SPEED_SETTING.max);
  }

  /** The element that actually scrolls the page (the viewport scroller). */
  _scroller() {
    return document.scrollingElement || document.documentElement;
  }
}