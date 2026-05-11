/**
 * syncErrorQueue.js — Persistent sync error registry.
 *
 * Stores sync failures (conflicts, network errors, server errors) so the UI
 * can surface them to the user instead of swallowing them silently.
 *
 * Backed by localStorage for persistence across page reloads.
 * Max 50 entries — oldest are evicted.
 */

const STORAGE_KEY = 'medidesk_sync_errors';
const MAX_ERRORS  = 50;

// ── Subscriber pattern ────────────────────────────────────────────────────────

const _subscribers = new Set();

function _notifySubscribers() {
  _subscribers.forEach(cb => {
    try { cb(); } catch (e) { console.warn('[syncErrorQueue] subscriber error', e); }
  });
}

/**
 * Subscribe to error queue changes.
 * Returns an unsubscribe function.
 */
export function subscribeSyncErrorChanges(callback) {
  _subscribers.add(callback);
  return () => _subscribers.delete(callback);
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function loadErrors() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveErrors(errors) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(errors.slice(-MAX_ERRORS)));
  } catch {
    // localStorage full — skip
  }
  _notifySubscribers();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Push a sync error into the registry.
 * @param {{ action, patient, error, errorCode, cloudVersion? }} item
 */
export async function pushSyncError(item) {
  const errors = loadErrors();
  errors.push({
    id:          `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action:      item.action,
    patientId:   item.patient?.id || null,
    globalId:    item.patient?.global_id || null,
    patientName: item.patient?.full_name || 'Unknown patient',
    error:       item.error || 'Unknown error',
    errorCode:   item.errorCode || 'UNKNOWN',
    cloudVersion: item.cloudVersion || null,
    timestamp:   new Date().toISOString(),
    resolved:    false,
  });
  saveErrors(errors);
}

/**
 * Mark all errors for a patient as resolved (called after successful sync).
 */
export async function resolvePatientErrors(globalId, localId) {
  const errors = loadErrors();
  const updated = errors.map(e =>
    (e.globalId === globalId || e.patientId === localId)
      ? { ...e, resolved: true }
      : e
  );
  saveErrors(updated);
}

/**
 * Mark a single error as resolved by id (used by SyncCenter dismiss button).
 */
export async function resolveSyncError(id) {
  const errors = loadErrors();
  const updated = errors.map(e => e.id === id ? { ...e, resolved: true } : e);
  saveErrors(updated);
}

/**
 * Get ALL errors (resolved + unresolved).
 * Used by SyncCenter to show the full list.
 */
export async function getSyncErrors() {
  return loadErrors();
}

/**
 * Get only unresolved errors.
 * Used internally and by TopBar badge count.
 */
export function getUnresolvedErrors() {
  return loadErrors().filter(e => !e.resolved);
}

/**
 * Clear all errors — alias used by SyncCenter "Clear all" button.
 */
export async function clearAllSyncErrors() {
  saveErrors([]);
}

/**
 * Clear all errors — original name kept for backward compatibility.
 */
export function clearAllErrors() {
  saveErrors([]);
}
