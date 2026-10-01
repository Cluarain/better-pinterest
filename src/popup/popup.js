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

/** Build the DOM for one feature setting — a slider (`range`) or a `select`. */
function createSettingRow(feature, setting) {
  const row = document.createElement('div');
  row.className = 'setting-row';
  row.dataset.featureId = feature.id;
  row.dataset.settingId = setting.id;

  const controlId = `setting-${feature.id}-${setting.id}`;

  const head = document.createElement('div');
  head.className = 'setting-head';

  const label = document.createElement('label');
  label.className = 'setting-label';
  label.htmlFor = controlId;
  label.textContent = setting.label;
  head.append(label);

  let control;
  if (setting.type === 'range') {
    const value = document.createElement('span');
    value.className = 'setting-value';
    head.append(value);
    control = createRangeInput(feature, setting, controlId);
  } else {
    control = createSelectInput(feature, setting, controlId);
  }

  row.append(head, control);
  return row;
}

/** `<input type="range">` — its live readout lives in `.setting-head`. */
function createRangeInput(feature, setting, controlId) {
  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'setting-range-input';
  input.id = controlId;
  input.dataset.featureId = feature.id;
  input.dataset.settingId = setting.id;
  input.dataset.unit = setting.unit ?? '';
  input.min = String(setting.min ?? 0);
  input.max = String(setting.max ?? 100);
  input.step = String(setting.step ?? 1);
  return input;
}

/** `<select>` built from `setting.options`. */
function createSelectInput(feature, setting, controlId) {
  const select = document.createElement('select');
  select.className = 'setting-select';
  select.id = controlId;
  select.dataset.featureId = feature.id;
  select.dataset.settingId = setting.id;

  for (const option of setting.options ?? []) {
    const opt = document.createElement('option');
    opt.value = String(option.value);
    opt.textContent = option.label;
    select.append(opt);
  }
  return select;
}

/** Refresh the `"{value} {unit}"` readout next to a range slider. */
function syncRangeReadout(input) {
  const value = input.closest('.setting-row')?.querySelector('.setting-value');
  if (!value) return;
  const unit = input.dataset.unit ? ` ${input.dataset.unit}` : '';
  value.textContent = `${input.value}${unit}`;
}

/** Push a stored value onto a control (range values are clamped to min/max). */
function applyControlValue(control, setting, value) {
  if (control instanceof HTMLInputElement && control.type === 'range') {
    const min = Number(setting.min ?? 0);
    const max = Number(setting.max ?? 100);
    const numeric = Number(value);
    const chosen = Number.isFinite(numeric) ? numeric : Number(setting.defaultValue);
    control.value = String(Math.min(Math.max(chosen, min), max));
    syncRangeReadout(control);
    return;
  }
  control.value = value == null ? String(setting.defaultValue) : String(value);
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
  const id = CSS.escape(featureId);
  const sid = CSS.escape(settingId);
  return listEl.querySelector(
    `.setting-select[data-feature-id="${id}"][data-setting-id="${sid}"], ` +
      `.setting-range-input[data-feature-id="${id}"][data-setting-id="${sid}"]`,
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
      applyControlValue(control, setting, state[settingKey(feature.id, setting.id)]);
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
      // statusEl.textContent = `${enabled ? 'Enabled' : 'Disabled'} ${tag} — applied on page`;
      return;
    }
  } catch {
    /* no content script in the active tab */
  }
  // statusEl.textContent = `Saved ${tag}. Open or reload pinterest.com to see it.`;
}

async function handleSettingChange(event) {
  const control = event.target;

  // Slider (`range`) → persist a number.
  if (control instanceof HTMLInputElement && control.matches('.setting-range-input')) {
    const { featureId, settingId } = control.dataset;
    // const setting = getFeature(featureId)?.settings?.find((e) => e.id === settingId);
    await store.set(settingKey(featureId, settingId), Number(control.value));
    // const unit = control.dataset.unit ? ` ${control.dataset.unit}` : '';
    // statusEl.textContent = `${setting?.label ?? settingId}: ${control.value}${unit}`;
    return;
  }

  // Dropdown (`select`) → persist the string value.
  if (control instanceof HTMLSelectElement && control.matches('.setting-select')) {
    const { featureId, settingId } = control.dataset;
    const feature = getFeature(featureId);
    const setting = feature?.settings?.find((e) => e.id === settingId);
    const value = control.value;
    await store.set(settingKey(featureId, settingId), value);
    const label = setting?.label ?? settingId;
    const option = setting?.options?.find((e) => String(e.value) === value);
    statusEl.textContent = `${label}: ${option?.label ?? value}`;
  }
}

function init() {
  for (const group of FEATURE_GROUPS) listEl.append(createGroup(group));

  listEl.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.matches('.toggle-input')) {
      handleToggle(event);
      return;
    }
    if (target instanceof HTMLInputElement && target.matches('.setting-range-input')) {
      handleSettingChange(event);
      return;
    }
    if (target instanceof HTMLSelectElement && target.matches('.setting-select')) {
      handleSettingChange(event);
    }
  });

  // Live readout while dragging a slider (before the value is persisted).
  listEl.addEventListener('input', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.matches('.setting-range-input')) {
      syncRangeReadout(target);
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
        const feature = getFeature(parsed.featureId);
        const setting = feature?.settings?.find((e) => e.id === parsed.settingId);
        const control = getSettingControl(parsed.featureId, parsed.settingId);
        if (control && setting) applyControlValue(control, setting, change.newValue);
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