/**
 * syncQueueStore.js
 * Persists the offline patient sync queue to disk per user.
 * File: sync_queue_<googleId>.json in Electron userData folder.
 */

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

function queueFile(userId) {
  return path.join(app.getPath('userData'), `sync_queue_${userId}.json`);
}

function saveQueue(userId, queue) {
  if (!userId) return;
  fs.writeFileSync(queueFile(userId), JSON.stringify(queue, null, 2), 'utf8');
}

function loadQueue(userId) {
  if (!userId) return [];
  try {
    if (fs.existsSync(queueFile(userId))) {
      return JSON.parse(fs.readFileSync(queueFile(userId), 'utf8'));
    }
  } catch {}
  return [];
}

function clearQueue(userId) {
  if (!userId) return;
  try {
    if (fs.existsSync(queueFile(userId))) fs.unlinkSync(queueFile(userId));
  } catch {}
}

module.exports = { saveQueue, loadQueue, clearQueue };
