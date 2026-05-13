/**
 * appointmentSyncService.js — Cloud-only appointment service.
 *
 * All operations go directly to the cloud backend.
 * Both doctor and secretary use the same cloudApi calls.
 * Offline queue fallback is preserved for network failures.
 */

import cloudApi from '../cloudApi';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalise a cloud appointment to consistent field names. */
function normaliseCloud(a) {
  return {
    ...a,
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

// ── Queue helpers ─────────────────────────────────────────────────────────────

async function loadApptQueue() {
  if (window.electronAPI?.loadSyncQueue) {
    const q = (await window.electronAPI.loadSyncQueue()) || [];
    return q.filter(i => i._type === 'appointment');
  }
  return [];
}

async function saveApptQueue(apptItems) {
  if (!window.electronAPI?.loadSyncQueue) return;
  const all = (await window.electronAPI.loadSyncQueue()) || [];
  const others = all.filter(i => i._type !== 'appointment');
  await window.electronAPI.saveSyncQueue([...others, ...apptItems]);
}

async function enqueueAppt(item) {
  let queue = await loadApptQueue();
  item = { ...item, status: 'pending', lastError: null, retryCount: item.retryCount || 0, lastAttemptAt: item.lastAttemptAt || 0 };
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
 * Fetch appointments from cloud.
 * @param {boolean} _isSecretary — kept for API compatibility, ignored (both use cloud)
 * @param {object}  params  — { date?, start_date?, end_date? }
 */
export async function fetchAppointments(_isSecretary, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await cloudApi.get(`/appointments${qs ? '?' + qs : ''}`);
  return (res.data.appointments || []).map(normaliseCloud);
}

/**
 * Fetch appointments for a week.
 */
export async function fetchWeekAppointments(_isSecretary, dateStr) {
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

/**
 * Create appointment.
 * Returns { appointment, conflict }.
 */
export async function createAppointment(_isSecretary, data) {
  try {
    const res = await cloudApi.post('/appointments', toCloudPayload(data));
    return { appointment: normaliseCloud(res.data.appointment), conflict: null };
  } catch (err) {
    if (err.response?.status === 409) {
      return { appointment: null, conflict: err.response.data };
    }
    // Queue for retry on network failure
    await enqueueAppt({ _type: 'appointment', action: 'create', data });
    throw err;
  }
}

/**
 * Update appointment.
 * Returns { appointment, conflict }.
 */
export async function updateAppointment(_isSecretary, id, data) {
  try {
    const res = await cloudApi.put(`/appointments/${id}`, toCloudPayload(data));
    return { appointment: normaliseCloud(res.data.appointment), conflict: null };
  } catch (err) {
    if (err.response?.status === 409) {
      return { appointment: null, conflict: err.response.data };
    }
    await enqueueAppt({ _type: 'appointment', action: 'update', data: { ...data, cloud_id: id } });
    throw err;
  }
}

/**
 * Delete (cancel) appointment.
 */
export async function deleteAppointment(_isSecretary, id) {
  try {
    await cloudApi.delete(`/appointments/${id}`);
  } catch (err) {
    if (err.response?.status === 404) return; // already gone
    await enqueueAppt({ _type: 'appointment', action: 'delete', data: { cloud_id: id } });
    throw err;
  }
}

/**
 * Replay queued appointment operations.
 */
export async function replayApptQueue() {
  const queue = await loadApptQueue();
  if (queue.length === 0) return { replayed: 0, failed: 0 };

  const remaining = [];
  let replayed = 0;

  for (const item of queue) {
    const retryCount = item.retryCount || 0;
    const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 10000);
    if (Date.now() < (item.lastAttemptAt || 0) + backoffMs) {
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
      } else if (item.action === 'delete' && item.data.cloud_id) {
        await cloudApi.delete(`/appointments/${item.data.cloud_id}`);
        replayed++;
      }
    } catch (err) {
      const newRetry = retryCount + 1;
      remaining.push({ ...item, status: newRetry <= 10 ? 'pending' : 'failed', retryCount: newRetry, lastAttemptAt: Date.now(), lastError: err.message });
    }
  }

  await saveApptQueue(remaining);
  return { replayed, failed: remaining.filter(i => i.status === 'failed').length };
}

export async function loadApptQueueItems() {
  return await loadApptQueue();
}
