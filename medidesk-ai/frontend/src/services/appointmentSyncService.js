/**
 * appointmentSyncService.js
 *
 * Single source of truth for appointment API calls.
 *
 * Doctor  → local Flask (port 5000) as primary, cloud as mirror (fire-and-forget).
 * Secretary → cloud only (no local backend available).
 *
 * The cloud mirror for doctors uses the same offline-queue pattern as patients:
 * if the cloud call fails it is silently queued and replayed on reconnect.
 */

import api from '../api';
import cloudApi from '../cloudApi';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalise a cloud appointment to match the local schema field names. */
function normaliseCloud(a) {
  return {
    ...a,
    // Cloud uses "date"; local uses "appointment_date"
    appointment_date: a.date || a.appointment_date,
    _fromCloud: true,
  };
}

/** Normalise a local appointment for sending to cloud. */
function toCloudPayload(data) {
  return {
    patient_name: data.patient_name,
    patient_id:   data.patient_id   || null,
    date:         data.appointment_date || data.date,
    start_time:   data.start_time,
    end_time:     data.end_time,
    status:       data.status       || 'scheduled',
    notes:        data.notes        || '',
  };
}

// ── Queue helpers (reuse Electron IPC queue, keyed by "appt") ────────────────

async function loadApptQueue() {
  if (window.electronAPI?.loadSyncQueue) {
    const q = (await window.electronAPI.loadSyncQueue()) || [];
    return q.filter(i => i._type === 'appointment');
  }
  return [];
}

async function saveApptQueue(apptItems) {
  if (!window.electronAPI?.loadSyncQueue) return;
  // Merge with non-appointment items so we don't clobber patient queue
  const all = (await window.electronAPI.loadSyncQueue()) || [];
  const others = all.filter(i => i._type !== 'appointment');
  await window.electronAPI.saveSyncQueue([...others, ...apptItems]);
}

async function enqueueAppt(item) {
  let queue = await loadApptQueue();
  item = {
    ...item,
    status: 'pending',
    lastError: null,
    retryCount: item.retryCount || 0,
    lastAttemptAt: item.lastAttemptAt || 0,
  };
  if (item.action === 'update' && item.data.cloud_id) {
    const idx = queue.findIndex(i => i.action === 'update' && i.data.cloud_id === item.data.cloud_id);
    if (idx >= 0) { queue[idx] = item; } else { queue.push(item); }
  } else if (item.action === 'delete' && item.data.cloud_id) {
    queue = queue.filter(i => !(i.data.cloud_id === item.data.cloud_id && i.action === 'update'));
    const idx = queue.findIndex(i => i.action === 'delete' && i.data.cloud_id === item.data.cloud_id);
    if (idx >= 0) { queue[idx] = item; } else { queue.push(item); }
  } else {
    queue.push(item);
  }
  await saveApptQueue(queue);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch appointments.
 * @param {boolean} isSecretary
 * @param {object}  params  — { date?, start_date?, end_date? }
 */
export async function fetchAppointments(isSecretary, params = {}) {
  if (isSecretary) {
    const qs = new URLSearchParams(params).toString();
    const res = await cloudApi.get(`/appointments${qs ? '?' + qs : ''}`);
    return (res.data.appointments || []).map(normaliseCloud);
  }

  // Doctor: local primary
  const qs = new URLSearchParams(params).toString();
  const res = await api.get(`/api/appointments${qs ? '?' + qs : ''}`);
  return res.data.appointments || [];
}

/**
 * Fetch appointments for a week (doctor local only; secretary uses fetchAppointments with range).
 */
export async function fetchWeekAppointments(isSecretary, dateStr) {
  if (isSecretary) {
    // Compute Mon–Sun for the given date
    const d = new Date(dateStr);
    const day = d.getDay();
    const mon = new Date(d);
    mon.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return fetchAppointments(true, {
      start_date: mon.toISOString().split('T')[0],
      end_date:   sun.toISOString().split('T')[0],
    });
  }
  const res = await api.get(`/api/appointments/week?date=${dateStr}`);
  return res.data.appointments || [];
}

/**
 * Create appointment.
 * Returns { appointment, conflict } — conflict is non-null when a 409 is returned.
 */
export async function createAppointment(isSecretary, data) {
  if (isSecretary) {
    try {
      const res = await cloudApi.post('/appointments', toCloudPayload(data));
      return { appointment: normaliseCloud(res.data.appointment), conflict: null };
    } catch (err) {
      if (err.response?.status === 409) {
        return { appointment: null, conflict: err.response.data };
      }
      throw err;
    }
  }

  // Doctor: local first
  const res = await api.post('/api/appointments', data);
  const localAppt = { ...data, id: res.data.appointment_id };

  // Mirror to cloud — fire-and-forget with queue fallback
  cloudApi.post('/appointments', toCloudPayload(data)).catch(async () => {
    await enqueueAppt({ _type: 'appointment', action: 'create', data: localAppt });
  });

  return { appointment: localAppt, conflict: null };
}

/**
 * Update appointment.
 * Returns { appointment, conflict }.
 */
export async function updateAppointment(isSecretary, id, data) {
  if (isSecretary) {
    try {
      const res = await cloudApi.put(`/appointments/${id}`, toCloudPayload(data));
      return { appointment: normaliseCloud(res.data.appointment), conflict: null };
    } catch (err) {
      if (err.response?.status === 409) {
        return { appointment: null, conflict: err.response.data };
      }
      throw err;
    }
  }

  // Doctor: local first
  await api.put(`/api/appointments/${id}`, data);

  // Mirror to cloud
  cloudApi.put(`/appointments/${id}`, toCloudPayload(data)).catch(async () => {
    await enqueueAppt({ _type: 'appointment', action: 'update', data: { ...data, cloud_id: id } });
  });

  return { appointment: { ...data, id }, conflict: null };
}

/**
 * Delete (cancel) appointment.
 * Secretary: soft-delete via cloud.
 * Doctor: hard-delete locally + soft-delete on cloud.
 */
export async function deleteAppointment(isSecretary, id) {
  if (isSecretary) {
    await cloudApi.delete(`/appointments/${id}`);
    return;
  }
  // Doctor: local hard delete then queue cloud mirror delete for retry.
  await api.delete(`/api/appointments/${id}`);
  await enqueueAppt({ _type: 'appointment', action: 'delete', data: { cloud_id: id } });
}

/**
 * Replay queued appointment operations (called alongside patient replayQueue).
 */
export async function replayApptQueue() {
  const queue = await loadApptQueue();
  if (queue.length === 0) return { replayed: 0, failed: 0 };

  const remaining = [];
  let replayed = 0;

  for (const item of queue) {
    const retryCount = item.retryCount || 0;
    const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 10000);
    const nextRetryAt = (item.lastAttemptAt || 0) + backoffMs;
    if (Date.now() < nextRetryAt) {
      remaining.push(item);
      continue;
    }

    try {
      if (item.action === 'create') {
        await cloudApi.post('/appointments', toCloudPayload(item.data));
        replayed++;
      } else if (item.action === 'update' && item.data.cloud_id) {
        await cloudApi.put(`/appointments/${item.data.cloud_id}`, toCloudPayload(item.data));
        replayed++;
      } else if (item.action === 'delete') {
        if (!item.data.cloud_id) {
          console.warn('[sync] replayApptQueue: delete item missing cloud_id', item);
          replayed++;
        } else {
          await cloudApi.delete(`/appointments/${item.data.cloud_id}`);
          replayed++;
        }
      }
    } catch (err) {
      const newRetryCount = retryCount + 1;
      if (newRetryCount <= 10) {
        remaining.push({ ...item, status: 'pending', retryCount: newRetryCount, lastAttemptAt: Date.now(), lastError: err.message || err.toString() });
      } else {
        console.error('[sync] replayApptQueue: marking item as failed after 10 retries', item);
        remaining.push({ ...item, status: 'failed', retryCount: newRetryCount, lastAttemptAt: Date.now(), lastError: err.message || err.toString() });
      }
    }
  }

  await saveApptQueue(remaining);
  return { replayed, failed: remaining.filter(i => i.status === 'failed').length };
}

export async function loadApptQueueItems() {
  return await loadApptQueue();
}
