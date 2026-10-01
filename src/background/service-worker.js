/**
 * service-worker.js
 * ============================================================================
 * Background worker (Manifest V3).
 *
 * Responsibilities:
 *   1. seed DEFAULT_STATE into chrome.storage.local on first install, and
 *   2. answer popup `PT_TWEAKER_TOGGLE` messages (extension point for future
 *      multi-tab routing / logging / analytics).
 *
 * The content script does NOT depend on this worker: it reacts to the same
 * `chrome.storage.onChanged` events and applies them directly. Keeping
 * storage as the single source of truth is what makes the message flow
 * optional / redundant-by-design.
 * ============================================================================
 */

import { DEFAULT_STATE } from '../content/features/index.js';

/** Message contract shared with popup.js and content/index.js. */
const MESSAGE_TYPE = 'PT_TWEAKER_TOGGLE';

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== 'install') return;
  // First run only: make sure every toggle has an explicit value in storage.
  // We never overwrite settings on updates.
  try {
    await chrome.storage.local.set({ ...DEFAULT_STATE });
  } catch (err) {
    console.error('[pt-tweaker] Failed to seed defaults', err);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== MESSAGE_TYPE) return; // not ours
  const { featureId, enabled } = message;

  // Storage is the single source of truth; the popup already wrote it there.
  // This handler is an extension point for future routing (e.g. broadcast to
  // all open Pinterest tabs without waiting for the storage event).
  try {
    sendResponse({ ok: true, featureId, enabled });
  } catch {
    /* channel may already be closed — ignore */
  }
});