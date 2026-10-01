/**
 * popup.js — toggle UI controller.
 * ============================================================================
 * Renders one switch per registered feature and keeps chrome.storage.local in
 * sync. The popup ALSO pings the background worker (message-routing flow per
 * the design doc) — but storage remains the single source of truth that the
 * content scripts actually react to.
 * ============================================================================
 */

import { FEATURES, DEFAULT_STATE, getFeature } from '../content/features/index.js';
import { Storage } from '../content/core/storage.js';

/** Message contract shared with the background worker and content script. */
const MESSAGE_TYPE = 'PT_TWEAKER_TOGGLE';

const store = new Storage('local');
const listEl = document.getElementById('featureList');
const statusEl = document.getElementById('status');

/** Build the DOM for a single toggle row. */
function createRow(feature) {
  const label = document.createElement('label');
  label.className = 'toggle-row';
  label.setAttribute('data-feature-id', feature.id);

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'toggle-input';
  input.dataset.featureId = feature.id;
  input.setAttribute('aria-describedby', `desc-${feature.id}`);

  const body = document.createElement('span');
  body.className = 'toggle-body';

  const titleRow = document.createElement('span');
  titleRow.className = 'toggle-title-row';

  const title = document.createElement('span');
  title.className = 'toggle-title';
  title.textContent = feature.title;

  const badge = document.createElement('span');
  badge.className = `toggle-badge toggle-badge--${feature.type}`;
  badge.textContent = feature.type === 'js' ? 'JS' : 'CSS';

  const desc = document.createElement('span');
  desc.className = 'toggle-desc';
  desc.id = `desc-${feature.id}`;
  desc.textContent = feature.description;

  titleRow.append(title, badge);

  const track = document.createElement('span');
  track.className = 'toggle-track';
  track.setAttribute('aria-hidden', 'true');
  const thumb = document.createElement('span');
  thumb.className = 'toggle-thumb';
  track.appendChild(thumb);

  body.append(titleRow, desc);
  label.append(input, body, track);
  return label;
}

function getInput(featureId) {
  return listEl.querySelector(
    `.toggle-row[data-feature-id="${CSS.escape(featureId)}"] .toggle-input`,
  );
}

/**
 * Mirror the stored darkMode state onto the popup document itself.
 * The control-panel rules live in master.css under `html.pt-dark` — the same
 * class the content script toggles on the Pinterest page.
 */
function applyPopupTheme(state) {
  document.documentElement.classList.toggle('pt-dark', Boolean(state.darkMode));
}

async function syncFromStorage() {
  const state = await store.getAll(DEFAULT_STATE);
  for (const feature of FEATURES) {
    const input = getInput(feature.id);
    if (input) input.checked = Boolean(state[feature.id]);
  }
  applyPopupTheme(state);
}

async function handleToggle(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.matches('.toggle-input')) return;

  const featureId = input.dataset.featureId;
  const feature = getFeature(featureId);
  const enabled = input.checked;
  const tag = feature?.title ?? featureId;

  // 1) Persist (single source of truth — content scripts apply via storage).
  await store.set(featureId, enabled);

  // 2) Notify the background worker (message-routing / extension point).
  try {
    await chrome.runtime.sendMessage({ type: MESSAGE_TYPE, featureId, enabled });
  } catch {
    /* optional channel — the storage change already applies everywhere */
  }

  // 3) Push directly to the active tab and report whether a content script
  //    actually received it. If the tab has no receiver, the Pinterest page
  //    was opened before the extension was (re)loaded and needs a refresh.
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = tab?.id
      ? await chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPE, featureId, enabled })
      : null;
    if (response?.ok) {
      statusEl.textContent = `${enabled ? 'Enabled' : 'Disabled'} ${tag} — applied on page`;
      return;
    }
  } catch {
    /* no content script in the active tab */
  }
  statusEl.textContent = `Saved ${tag}. Open or reload pinterest.com to see it.`;
}

function init() {
  for (const feature of FEATURES) listEl.append(createRow(feature));

  listEl.addEventListener('change', handleToggle);

  // Keep the popup in sync if another popup/tab changes a setting.
  store.onChanged((changes) => {
    for (const [featureId, change] of Object.entries(changes)) {
      const input = getInput(featureId);
      if (input && typeof change.newValue === 'boolean') input.checked = change.newValue;
    }
    if ('darkMode' in changes) {
      applyPopupTheme({ darkMode: changes.darkMode.newValue });
    }
  });

  syncFromStorage().catch((err) => {
    console.error('[pt-tweaker] popup: failed to read state', err);
    statusEl.textContent = 'Failed to read settings';
  });
}

init();