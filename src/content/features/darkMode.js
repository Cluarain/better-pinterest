/**
 * darkMode.js
 * ============================================================================
 * CSS-driven feature — Dark Mode.
 * Body class: `pt-dark`
 *
 * This file only declares configuration. The actual styling lives in
 * `src/content/styles/master.css` under `body.pt-dark`.
 *
 * TODO(future): inject custom CSS variables instead of the current base rules
 * so the theme can be tuned (accent, surfaces, ...).
 * ============================================================================
 */

export const darkMode = {
  id: 'darkMode',
  title: 'Dark Mode',
  type: 'css',
  bodyClass: 'pt-dark',
  defaultValue: false,
  description: 'Dark theme base across Pinterest.',
};