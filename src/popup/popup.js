/**
 * popup.js — toggle UI controller.
 * ============================================================================
 * Renders one switch per registered feature and keeps chrome.storage.local in
 * sync. The popup ALSO pings the background worker (message-routing flow per
 * the design doc) — but storage remains the single source of truth that the
 * content scripts actually react to.
 * ============================================================================
 */

import { FEATURES, DEFAULT_STATE } from '../content/features/index.js';
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

async function syncFromStorage() {
  const state = await store.getAll(DEFAULT_STATE);
  for (const feature of FEATURES) {
    const input = getInput(feature.id);
    if (input) input.checked = Boolean(state[feature.id]);
  }
}

async function handleToggle(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.matches('.toggle-input')) return;

  const featureId = input.dataset.featureId;
  const enabled = input.checked;

  // 1) Persist (single source of truth — content scripts apply via storage).
  await store.set(featureId, enabled);
  // 2) Notify the background worker (message-routing / extension point).
  try {
    await chrome.runtime.sendMessage({ type: MESSAGE_TYPE, featureId, enabled });
  } catch {
    /* no receiver (worker restarting?) — the storage change already applied */
  }
  statusEl.textContent = `${enabled ? 'Enabled' : 'Disabled'} ${featureId}`;
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
  });

  syncFromStorage().catch((err) => {
    console.error('[pt-tweaker] popup: failed to read state', err);
    statusEl.textContent = 'Failed to read settings';
  });
}

init();