/**
 * patientSyncService.js — Sync V3
 *
 * Doctor:    local DB = primary, cloud = mirror. Reads merge both.
 * Secretary: cloud = only source.
 *
 * V3 additions over V2:
 * - 409 conflict: immediately fetches cloud version + registers CONFLICT error
 *   in syncErrorQueue so the UI can open the merge modal.
 * - Network / server failures: registers NETWORK/SERVER error in syncErrorQueue
 *   with exact error message — no silent data loss.
 * - pushSyncError integrated at every failure point.
 * - replayQueue: still processes ALL items independently.
 */

import cloudApi from '../cloudApi';
import api from '../api';
import { pushSyncError, resolvePatientErrors } from './syncErrorQueue';

const _syncQueueSubscribers = new Set();

function _notifySyncQueueSubscribers() {
  _syncQueueSubscribers.forEach(cb => {
    try { cb(); } catch (err) { console.warn('[patientSyncService] subscriber error', err); }
  });
}

export function subscribeSyncQueueUpdates(callback) {
  _syncQueueSubscribers.add(callback);
  return () => _syncQueueSubscribers.delete(callback);
}

function generateId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeEntityId(patient) {
  return patient?.global_id || patient?.cloud_id || patient?.id || null;
}

function linkDependencies(queue) {
  const entityMap = new Map();
  queue.sort((a, b) => a.createdAt - b.createdAt);
  for (const item of queue) {
    const entityId = item.entityId || normalizeEntityId(item.patient);
    if (!entityId) {
      item.dependsOn = null;
      continue;
    }
    item.entityId = entityId;
    const last = entityMap.get(entityId);
    item.dependsOn = last?.id || null;
    entityMap.set(entityId, item);
  }
}

async function loadQueue() {
  if (window.electronAPI?.loadSyncQueue) {
    return (await window.electronAPI.loadSyncQueue()) || [];
  }
  return [];
}

async function saveQueue(queue) {
  if (window.electronAPI?.saveSyncQueue) {
    await window.electronAPI.saveSyncQueue(queue);
  }
  _notifySyncQueueSubscribers();
}

async function enqueue(item) {
  const queue = await loadQueue();
  const entityId = item.entityId || normalizeEntityId(item.patient);
  if (!entityId) {
    console.warn('[sync] enqueue: missing entityId, dropping item', item);
    return;
  }

  const now = Date.now();
  const payload = {
    id: generateId(),
    entityId,
    type: item.action,
    action: item.action,
    patient: item.patient,
    createdAt: item.createdAt || now,
    status: item.status || 'pending',
    dependsOn: null,
    retryCount: item.retryCount || 0,
    lastAttemptAt: item.lastAttemptAt || 0,
    lastError: null,
  };

  const existing = queue.filter(q => q.entityId === entityId && q.status !== 'done');
  const lastItem = existing[existing.length - 1];

  if (payload.type === 'create') {
    const duplicate = existing.find(i => i.type === 'create');
    if (duplicate) {
      duplicate.patient = { ...duplicate.patient, ...payload.patient };
      duplicate.createdAt = Math.min(duplicate.createdAt, payload.createdAt);
      duplicate.status = 'pending';
      duplicate.retryCount = 0;
      duplicate.lastError = null;
      linkDependencies(queue);
      await saveQueue(queue);
      replayQueue().catch(err => console.warn('[sync] replayQueue failed', err));
      return;
    }
  }

  if (payload.type === 'update') {
    const pendingCreate = existing.find(i => i.type === 'create' && i.status !== 'failed');
    if (pendingCreate) {
      pendingCreate.patient = { ...pendingCreate.patient, ...payload.patient };
      pendingCreate.createdAt = Math.min(pendingCreate.createdAt, payload.createdAt);
      pendingCreate.status = 'pending';
      pendingCreate.retryCount = 0;
      pendingCreate.lastError = null;
      linkDependencies(queue);
      await saveQueue(queue);
      replayQueue().catch(() => {});
      return;
    }
    const lastUpdate = existing.filter(i => i.type === 'update').pop();
    if (lastUpdate) {
      lastUpdate.patient = { ...lastUpdate.patient, ...payload.patient };
      lastUpdate.lastError = null;
      lastUpdate.retryCount = 0;
      linkDependencies(queue);
      await saveQueue(queue);
      replayQueue().catch(err => console.warn('[sync] replayQueue failed', err));
      return;
    }
  }

  if (payload.type === 'delete') {
    const existingDeleteIndex = queue.findIndex(i => i.entityId === entityId && i.type === 'delete');
    if (existingDeleteIndex >= 0) {
      queue.splice(existingDeleteIndex, 1);
    }
    const pendingCreateIndex = queue.findIndex(i => i.entityId === entityId && i.type === 'create' && i.status !== 'failed');
    if (pendingCreateIndex >= 0) {
      queue.splice(pendingCreateIndex, 1);
    }
  }

  queue.push(payload);
  linkDependencies(queue);
  await saveQueue(queue);
  replayQueue().catch(err => console.warn('[sync] replayQueue failed', err));
}

// ── Fetch the current cloud version of a patient ─────────────────────────────
// Used immediately after a 409 to populate the merge modal.

async function fetchCloudPatientVersion(patient) {
  try {
    if (patient.global_id) {
      const res = await cloudApi.get(`/patients/by-global/${patient.global_id}`);
      return res.data.patient || null;
    }
    if (patient.cloud_id) {
      const res = await cloudApi.get(`/patients/${patient.cloud_id}`);
      return res.data.patient || null;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Push new patient to cloud ─────────────────────────────────────────────────

export async function syncPatientToCloud(patient) {
  try {
    const res = await cloudApi.post('/patients', {
      full_name:   patient.full_name,
      phone:       patient.phone       || '',
      email:       patient.email       || '',
      notes:       patient.notes       || '',
      appointment: patient.appointment || '',
      status:      patient.status      || 'Active',
      global_id:   patient.global_id   || undefined,
    });
    const cloudPatient = res.data.patient;
    // Clear any prior error for this patient on success
    await resolvePatientErrors(patient.global_id, patient.id).catch(err => console.warn('[sync] resolvePatientErrors failed', err));
    return cloudPatient ? { cloud_id: cloudPatient.id, global_id: cloudPatient.global_id } : null;
  } catch (err) {
    const errorCode = err.response?.status === 409 ? 'CONFLICT'
                    : !navigator.onLine ? 'NETWORK' : 'SERVER';
    await pushSyncError({
      action: 'create',
      patient,
      error: err.response?.data?.detail || err.message || 'Cloud create failed',
      errorCode,
    });
    console.warn('[sync] Cloud create failed, queuing:', err.message);
    await enqueue({ action: 'create', patient, timestamp: Date.now() });
    return null;
  }
}

// ── Update existing patient in cloud ─────────────────────────────────────────
// On 409: fetches cloud version and attaches it to the error record so the
// UI can open the merge modal immediately.

export async function updateCloudPatient(patient) {
  const payload = {
    full_name:   patient.full_name,
    phone:       patient.phone       || '',
    email:       patient.email       || '',
    notes:       patient.notes       || '',
    appointment: patient.appointment || '',
    status:      patient.status      || 'Active',
    updated_at:  patient.updated_at || new Date().toISOString(),
  };

  try {
    if (patient.global_id) {
      await cloudApi.put(`/patients/by-global/${patient.global_id}`, payload);
    } else if (patient.cloud_id) {
      await cloudApi.put(`/patients/${patient.cloud_id}`, payload);
    } else {
      console.warn('[sync] updateCloudPatient: no global_id or cloud_id — cannot update');
      return { ok: false, conflict: false };
    }
    // Clear any prior error for this patient on success
    await resolvePatientErrors(patient.global_id, patient.id).catch(() => {});
    return { ok: true, conflict: false };

  } catch (err) {
    if (err.response?.status === 409) {
      console.warn('[sync] updateCloudPatient: 409 conflict — fetching cloud version for merge');
      // Fetch the latest cloud version immediately so the UI can diff it
      const cloudVersion = await fetchCloudPatientVersion(patient);
      await pushSyncError({
        action:     'update',
        patient:    { ...patient, ...payload },
        error:      `Conflict: another user updated this patient. Cloud version is newer (${cloudVersion?.updated_at || 'unknown time'}).`,
        errorCode:  'CONFLICT',
        cloudVersion,  // ← attached so ConflictModal can show cloud side
      });
      return { ok: false, conflict: true, cloudVersion };
    }
    // Network / server error — queue + register error
    const errorCode = !navigator.onLine ? 'NETWORK' : 'SERVER';
    await pushSyncError({
      action: 'update',
      patient,
      error: err.message || 'Cloud update failed',
      errorCode,
    });
    console.warn('[sync] Cloud update failed, queuing:', err.message);
    await enqueue({ action: 'update', patient, timestamp: Date.now() });
    return { ok: false, conflict: false };
  }
}

// ── cloud_id write-back with retry ────────────────────────────────────────────

async function writeBackCloudId(localId, cloudId, globalId, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await api.put(`/api/patients/${localId}`, { cloud_id: cloudId, global_id: globalId });
      return true;
    } catch {
      if (i < retries - 1) await new Promise(r => setTimeout(r, 500));
    }
  }
  console.warn(`[sync] writeBackCloudId: failed after ${retries} attempts for localId=${localId}`);
  return false;
}

// ── Replay offline queue ──────────────────────────────────────────────────────

export async function replayQueue() {
  const queue = await loadQueue();
  if (queue.length === 0) return { replayed: 0, failed: 0 };

  const grouped = new Map();
  queue.sort((a, b) => a.createdAt - b.createdAt);
  for (const item of queue) {
    const entityId = item.entityId || normalizeEntityId(item.patient);
    if (!entityId) {
      continue;
    }
    item.entityId = entityId;
    const items = grouped.get(entityId) || [];
    items.push(item);
    grouped.set(entityId, items);
  }

  const remaining = [];
  let replayed = 0;

  for (const [entityId, items] of grouped.entries()) {
    let blocked = false;

    for (const item of items) {
      if (item.status === 'done') {
        continue;
      }
      if (blocked || item.status === 'failed') {
        remaining.push(item);
        blocked = true;
        continue;
      }

      const retryCount = item.retryCount || 0;
      const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 30000);
      const nextRetryAt = (item.lastAttemptAt || 0) + backoffMs;
      if (Date.now() < nextRetryAt) {
        remaining.push(item);
        blocked = true;
        continue;
      }

      try {
        if (item.action === 'create') {
          const res = await cloudApi.post('/patients', {
            full_name:   item.patient.full_name,
            phone:       item.patient.phone       || '',
            email:       item.patient.email       || '',
            notes:       item.patient.notes       || '',
            appointment: item.patient.appointment || '',
            status:      item.patient.status      || 'Active',
            global_id:   item.patient.global_id,
          });
          const cloudPatient = res.data.patient;
          const cloudId = cloudPatient?.id;
          const cloudGlobalId = cloudPatient?.global_id;
          if (cloudId && item.patient.id) {
            writeBackCloudId(item.patient.id, cloudId, cloudGlobalId || item.patient.global_id);
          }
          await resolvePatientErrors(item.patient.global_id, item.patient.id).catch(err => console.warn('[sync] resolvePatientErrors failed', err));
          replayed++;
          continue;
        }

        if (item.action === 'update') {
          if (item.patient.global_id) {
            await cloudApi.put(`/patients/by-global/${item.patient.global_id}`, {
              ...item.patient,
              updated_at: item.patient.updated_at || new Date().toISOString(),
            });
          } else if (item.patient.cloud_id) {
            await cloudApi.put(`/patients/${item.patient.cloud_id}`, { ...item.patient });
          } else {
            console.warn('[sync] replayQueue: update item has no global_id or cloud_id — dropping');
            replayed++;
            continue;
          }
          await resolvePatientErrors(item.patient.global_id, item.patient.id).catch(err => console.warn('[sync] resolvePatientErrors failed', err));
          replayed++;
          continue;
        }

        if (item.action === 'delete') {
          const deleteId = item.globalId || item.cloudId || item.patient?.global_id || item.patient?.cloud_id;
          if (deleteId) {
            try {
              if (item.globalId || item.patient?.global_id) {
                await cloudApi.delete(`/patients/by-global/${item.globalId || item.patient.global_id}`);
              } else if (item.cloudId || item.patient?.cloud_id) {
                await cloudApi.delete(`/patients/${item.cloudId || item.patient.cloud_id}`);
              }
            } catch (deleteErr) {
              if (deleteErr.response?.status === 404) {
                console.log('[sync] replayQueue: delete 404 — already gone, treating as success');
              } else {
                throw deleteErr;
              }
            }
          }
          replayed++;
          continue;
        }
      } catch (err) {
        if (err.response?.status === 409) {
          console.warn('[sync] replayQueue: 409 conflict on replay', item.patient?.global_id);
          const cloudVersion = await fetchCloudPatientVersion(item.patient).catch(err => { console.warn('[sync] fetchCloudPatientVersion failed', err); return null; });
          await pushSyncError({
            action:    item.action,
            patient:   item.patient,
            error:     `Conflict during replay: cloud version is newer.`,
            errorCode: 'CONFLICT',
            cloudVersion,
          }).catch(err => console.warn('[sync] pushSyncError failed', err));
          remaining.push({
            ...item,
            status: 'failed',
            lastError: err.response?.data?.message || err.message || 'Conflict',
          });
          blocked = true;
          continue;
        }

        const newRetryCount = retryCount + 1;
        if (newRetryCount <= 10) {
          remaining.push({
            ...item,
            status: 'pending',
            retryCount: newRetryCount,
            lastAttemptAt: Date.now(),
            lastError: err.message || err.toString(),
          });
          blocked = true;
        } else {
          console.error('[sync] replayQueue: item failed permanently after 10 retries', item);
          await pushSyncError({
            action:    item.action,
            patient:   item.patient,
            error:     `Failed after 10 retries. Last error: ${err.message}`,
            errorCode: !navigator.onLine ? 'NETWORK' : 'SERVER',
          }).catch(() => {});
          remaining.push({
            ...item,
            status: 'failed',
            lastError: err.message || err.toString(),
          });
          blocked = true;
        }
      }
    }
  }

  await saveQueue(remaining);
  if (replayed > 0 || remaining.length > 0) {
    console.log(`[sync] replayQueue: replayed=${replayed} remaining=${remaining.length}`);
  }
  return { replayed, failed: remaining.filter(i => i.status === 'failed').length };
}

// ── Queue helpers (for UI) ────────────────────────────────────────────────────

export async function getQueueCount() {
  const queue = await loadQueue();
  return queue.length;
}

export async function loadSyncQueueItems() {
  return await loadQueue();
}

// ── Secretary offline write helper ───────────────────────────────────────────

export async function secretaryCloudWrite(patient, updatedFields) {
  const globalId = patient.global_id;
  const cloudId  = patient.cloud_id || patient.id;

  const payload = {
    full_name:   updatedFields.full_name   ?? patient.full_name,
    phone:       updatedFields.phone       ?? patient.phone       ?? '',
    email:       updatedFields.email       ?? patient.email       ?? '',
    notes:       updatedFields.notes       ?? patient.notes       ?? '',
    appointment: updatedFields.appointment ?? patient.appointment ?? '',
    status:      updatedFields.status      ?? patient.status      ?? 'Active',
    updated_at:  patient.updated_at,
  };

  try {
    if (globalId) {
      await cloudApi.put(`/patients/by-global/${globalId}`, payload);
    } else if (cloudId) {
      await cloudApi.put(`/patients/${cloudId}`, payload);
    } else {
      console.warn('[sync] secretaryCloudWrite: no identity key — cannot write');
      return { ok: false, queued: false };
    }
    return { ok: true };
  } catch (err) {
    if (err.response?.status === 409) {
      console.warn('[sync] secretaryCloudWrite: 409 conflict');
      const cloudVersion = await fetchCloudPatientVersion(patient).catch(err => { console.warn('[sync] fetchCloudPatientVersion failed', err); return null; });
      await pushSyncError({
        action: 'update',
        patient: { ...patient, ...payload },
        error: `Conflict: cloud version is newer.`,
        errorCode: 'CONFLICT',
        cloudVersion,
      }).catch(err => console.warn('[sync] pushSyncError failed', err));
      return {
        ok: false, queued: false, conflict: true,
        serverUpdatedAt: err.response?.data?.server_updated_at || null,
        cloudVersion,
      };
    }
    const errorCode = !navigator.onLine ? 'NETWORK' : 'SERVER';
    await pushSyncError({
      action: 'update',
      patient: { ...patient, ...payload, global_id: globalId, cloud_id: cloudId },
      error: err?.message || 'Network error',
      errorCode,
    }).catch(err => console.warn('[sync] pushSyncError failed', err));
    console.warn('[sync] secretaryCloudWrite: failed, queuing for retry:', err?.message);
    await enqueue({
      action: 'update',
      patient: { ...patient, ...payload, global_id: globalId, cloud_id: cloudId },
      timestamp: Date.now(),
    });
    return { ok: false, queued: true, conflict: false };
  }
}

// ── Delete patient from cloud (queue-safe) ────────────────────────────────────
// Always goes through the sync queue — never fire-and-forget.
// 404 on replay = already deleted = success.

export async function deleteCloudPatient(patient) {
  const globalId = patient.global_id;
  const cloudId  = patient.cloud_id;

  if (!globalId && !cloudId) {
    console.warn('[sync] deleteCloudPatient: no identity key — skipping cloud delete');
    return;
  }

  try {
    if (globalId) {
      await cloudApi.delete(`/patients/by-global/${globalId}`);
    } else {
      await cloudApi.delete(`/patients/${cloudId}`);
    }
    // Success — no queue needed
  } catch (err) {
    if (err.response?.status === 404) {
      // Already deleted on cloud — treat as success
      return;
    }
    // Network / server failure — queue for replay
    console.warn('[sync] deleteCloudPatient: failed, queuing:', err.message);
    await enqueue({
      action:   'delete',
      entityId: globalId || String(cloudId),
      patient:  { global_id: globalId, cloud_id: cloudId, id: patient.id },
      timestamp: Date.now(),
    });
    await pushSyncError({
      action:    'delete',
      patient,
      error:     err.message || 'Cloud delete failed',
      errorCode: !navigator.onLine ? 'NETWORK' : 'SERVER',
    });
  }
}

// ── Cloud patient fetch ───────────────────────────────────────────────────────

export async function fetchCloudPatients(page = 1, limit = 50, search = '') {
  try {
    const res = await cloudApi.get(`/patients?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`);
    return (res.data.patients || []).map(p => ({
      ...p,
      cloud_id: p.id,
      global_id: p.global_id,
      _fromCloud: true,
    }));
  } catch (err) {
    console.warn('[sync] Could not fetch cloud patients:', err.message);
    return null;
  }
}

// ── Merge local + cloud ───────────────────────────────────────────────────────

export function mergePatients(local, cloud) {
  if (!cloud || cloud.length === 0) return { merged: local, localUpdates: [] };

  const localByGlobalId = new Map(local.filter(p => p.global_id).map(p => [p.global_id, p]));
  const localByCloudId  = new Map(local.filter(p => p.cloud_id).map(p => [String(p.cloud_id), p]));

  const merged = [...local];
  const localUpdates = [];

  for (const cloudPatient of cloud) {
    if (cloudPatient.global_id && localByGlobalId.has(cloudPatient.global_id)) {
      const localRecord = localByGlobalId.get(cloudPatient.global_id);
      const localIdx    = merged.findIndex(p => p.global_id === cloudPatient.global_id);

      const cloudTime = cloudPatient.updated_at ? new Date(cloudPatient.updated_at).getTime() : 0;
      const localTime = localRecord.updated_at  ? new Date(localRecord.updated_at).getTime()  : 0;

      if (cloudTime > localTime) {
        const updatedFields = {
          full_name:   cloudPatient.full_name,
          phone:       cloudPatient.phone,
          email:       cloudPatient.email,
          notes:       cloudPatient.notes,
          appointment: cloudPatient.appointment,
          status:      cloudPatient.status,
          updated_at:  cloudPatient.updated_at,
          updated_by:  cloudPatient.updated_by,
          cloud_id:    cloudPatient.id,
          global_id:   cloudPatient.global_id,
        };
        merged[localIdx] = { ...localRecord, ...updatedFields, _fromCloud: true };
        if (localRecord.id) {
          localUpdates.push({ id: localRecord.id, fields: updatedFields });
        }
      }
    } else if (!cloudPatient.global_id && cloudPatient.cloud_id &&
               localByCloudId.has(String(cloudPatient.cloud_id))) {
      continue;
    } else {
      merged.push(cloudPatient);
    }
  }

  return { merged, localUpdates };
}
