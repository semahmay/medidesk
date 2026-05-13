const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

function _encrypt(data) {
  const str = JSON.stringify(data);
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(str);
  }
  return Buffer.from(str, 'utf8');
}

function _decrypt(buf) {
  if (safeStorage.isEncryptionAvailable()) {
    return JSON.parse(safeStorage.decryptString(buf));
  }
  return JSON.parse(buf.toString('utf8'));
}

function queueFile(userId) {
  return path.join(app.getPath('userData'), `sync_queue_${userId}.enc`);
}

function saveQueue(userId, queue) {
  if (!userId) return;
  try {
    fs.writeFileSync(queueFile(userId), _encrypt(queue));
  } catch (e) {
    console.warn('[syncQueueStore] save failed:', e.message);
  }
}

function loadQueue(userId) {
  if (!userId) return [];
  try {
    if (fs.existsSync(queueFile(userId))) {
      return _decrypt(fs.readFileSync(queueFile(userId)));
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
