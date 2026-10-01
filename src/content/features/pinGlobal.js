/**
 * pinGlobal.js
 * ============================================================================
 * CSS-driven features — GLOBAL pin appearance ("оформление пинов").
 *
 * This is the shared home for EVERY tweak that affects how pins look and is
 * grouped as the "Pins" section in the popup. Drop new pin-appearance features
 * here (one `export const` per feature, each with its own `htmlClass`) and add
 * the matching rules to `src/content/styles/master.css`.
 *
 * Current features:
 *   hidePinMenu → html.pt-hide-pin-menu-footer
 *                 (the "⋯" / more-options menu shown over a pin on hover)
 * ============================================================================
 */

export const hidePinMenu = {
  id: 'hidePinMenu',
  title: 'Hide Pin Menu',
  type: 'css',
  htmlClass: 'pt-hide-pin-menu-footer',
  defaultValue: false,
  description: 'Hides "more options" menu on pins.',
};
