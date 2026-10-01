/**
 * popup.js — toggle UI controller.
 * ============================================================================
 * Renders one switch per registered feature, grouped into the same sections
 * declared in `FEATURE_GROUPS` (src/content/features/index.js), plus a control
 * for every declared feature setting (e.g. auto-scroll speed).
 *
 * chrome.storage.local stays the single source of truth: each change is written
 * there and the content script applies it via `storage.onChanged`. The popup
 * ALSO pings the background worker / active tab (message-routing flow per the
 * design doc) for immediate feedback.
 * ============================================================================
 */

import { FEATURE_GROUPS, FEATURES, DEFAULT_STATE, getFeature } from '../content/features/index.js';
import { Storage } from '../content/core/storage.js';
import { settingKey, parseSettingKey } from '../content/core/registry.js';

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

/** Build the DOM for one feature setting (currently only `select` is used). */
function createSettingRow(feature, setting) {
  const row = document.createElement('div');
  row.className = 'setting-row';
  row.dataset.featureId = feature.id;
  row.dataset.settingId = setting.id;

  const controlId = `setting-${feature.id}-${setting.id}`;

  const label = document.createElement('label');
  label.className = 'setting-label';
  label.htmlFor = controlId;
  label.textContent = setting.label;

  const control = document.createElement('select');
  control.className = 'setting-select';
  control.id = controlId;
  control.dataset.featureId = feature.id;
  control.dataset.settingId = setting.id;

  for (const option of setting.options ?? []) {
    const opt = document.createElement('option');
    opt.value = String(option.value);
    opt.textContent = option.label;
    control.append(opt);
  }

  row.append(label, control);
  return row;
}

/** Build a popup section for a logical feature group. */
function createGroup(group) {
  const section = document.createElement('section');
  section.className = 'group';
  section.dataset.groupId = group.id;

  const headingId = `group-${group.id}`;
  section.setAttribute('aria-labelledby', headingId);

  const heading = document.createElement('h2');
  heading.className = 'group-title';
  heading.id = headingId;
  heading.textContent = group.title;

  const items = document.createElement('div');
  items.className = 'group-items';

  for (const feature of group.features) {
    items.append(createRow(feature));
    for (const setting of feature.settings ?? []) {
      items.append(createSettingRow(feature, setting));
    }
  }

  section.append(heading, items);
  return section;
}

function getInput(featureId) {
  return listEl.querySelector(
    `.toggle-row[data-feature-id="${CSS.escape(featureId)}"] .toggle-input`,
  );
}

function getSettingControl(featureId, settingId) {
  return listEl.querySelector(
    `.setting-select[data-feature-id="${CSS.escape(featureId)}"]` +
      `[data-setting-id="${CSS.escape(settingId)}"]`,
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

    for (const setting of feature.settings ?? []) {
      const control = getSettingControl(feature.id, setting.id);
      if (!control) continue;
      const value = state[settingKey(feature.id, setting.id)];
      control.value = value == null ? String(setting.defaultValue) : String(value);
    }
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

async function handleSettingChange(event) {
  const control = event.target;
  if (!(control instanceof HTMLSelectElement) || !control.matches('.setting-select')) return;

  const { featureId, settingId } = control.dataset;
  const feature = getFeature(featureId);
  const setting = feature?.settings?.find((entry) => entry.id === settingId);
  const value = control.value;

  // Settings travel through storage only; the content script routes
  // `<featureId>.<settingId>` keys to registry.applySetting().
  await store.set(settingKey(featureId, settingId), value);

  const label = setting?.label ?? settingId;
  const option = setting?.options?.find((entry) => String(entry.value) === value);
  statusEl.textContent = `${label}: ${option?.label ?? value}`;
}

function init() {
  for (const group of FEATURE_GROUPS) listEl.append(createGroup(group));

  listEl.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.matches('.toggle-input')) {
      handleToggle(event);
    } else if (target instanceof HTMLSelectElement && target.matches('.setting-select')) {
      handleSettingChange(event);
    }
  });

  // Keep the popup in sync if another popup/tab changes a toggle or a setting.
  store.onChanged((changes) => {
    for (const [key, change] of Object.entries(changes)) {
      const input = getInput(key);
      if (input && typeof change.newValue === 'boolean') {
        input.checked = change.newValue;
        continue;
      }
      const parsed = parseSettingKey(key);
      if (parsed && change.newValue != null) {
        const control = getSettingControl(parsed.featureId, parsed.settingId);
        if (control) control.value = String(change.newValue);
      }
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