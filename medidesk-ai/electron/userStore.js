const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

function dataDir() {
  return app.getPath('userData');
}

function sessionFile() { return path.join(dataDir(), 'session.enc'); }
function clinicFile()  { return path.join(dataDir(), 'clinic.enc'); }

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

function _writeEncrypted(file, data) {
  try {
    fs.writeFileSync(file, _encrypt(data));
  } catch (e) {
    console.error('[userStore] write failed:', e.message);
  }
}

function _readEncrypted(file) {
  try {
    if (fs.existsSync(file)) {
      return _decrypt(fs.readFileSync(file));
    }
  } catch {}
  return null;
}

function _deleteFile(file) {
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

function saveSession(userData) {
  _writeEncrypted(sessionFile(), userData);
}

function loadSession() {
  return _readEncrypted(sessionFile());
}

function clearSession() {
  _deleteFile(sessionFile());
}

function saveClinicSession(clinicId, userRole, userName) {
  _writeEncrypted(clinicFile(), { clinicId, userRole, userName });
}

function loadClinicSession() {
  return _readEncrypted(clinicFile());
}

function clearClinicSession() {
  _deleteFile(clinicFile());
}

module.exports = { saveSession, loadSession, clearSession, saveClinicSession, loadClinicSession, clearClinicSession };
