/**
 * userStore.js
 * Manages two plain JSON files in the OS user-data folder:
 *   - users.json   → registry of all users who have ever logged in
 *   - session.json → the currently logged-in user's googleId
 *   - clinic.json  → the clinic session (clinic_id, user_role)
 */

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

function dataDir() {
  return app.getPath('userData'); // e.g. C:\Users\X\AppData\Roaming\medidesk-ai
}

function usersFile()   { return path.join(dataDir(), 'users.json'); }
function sessionFile() { return path.join(dataDir(), 'session.json'); }
function clinicFile()  { return path.join(dataDir(), 'clinic.json'); }

// ─── users.json ──────────────────────────────────────────────────────────────

function loadUsers() {
  try {
    if (fs.existsSync(usersFile())) {
      return JSON.parse(fs.readFileSync(usersFile(), 'utf8'));
    }
  } catch {}
  return {};
}

function saveUsers(users) {
  fs.writeFileSync(usersFile(), JSON.stringify(users, null, 2), 'utf8');
}

/**
 * Register or update a user in users.json.
 * Returns the (possibly updated) user record.
 */
function upsertUser(googleUser) {
  const users = loadUsers();
  const existing = users[googleUser.googleId] || {};

  users[googleUser.googleId] = {
    ...existing,
    googleId: googleUser.googleId,
    email: googleUser.email,
    name: googleUser.name,
    picture: googleUser.picture,
    lastLogin: new Date().toISOString(),
    firstLogin: existing.firstLogin || new Date().toISOString(),
  };

  saveUsers(users);
  return users[googleUser.googleId];
}

function getUser(googleId) {
  return loadUsers()[googleId] || null;
}

// ─── session.json ─────────────────────────────────────────────────────────────

function saveSession(googleId) {
  fs.writeFileSync(sessionFile(), JSON.stringify({ googleId }, null, 2), 'utf8');
}

function loadSession() {
  try {
    if (fs.existsSync(sessionFile())) {
      const { googleId } = JSON.parse(fs.readFileSync(sessionFile(), 'utf8'));
      return getUser(googleId) || null;
    }
  } catch {}
  return null;
}

function clearSession() {
  try {
    if (fs.existsSync(sessionFile())) fs.unlinkSync(sessionFile());
  } catch {}
}

// ─── clinic.json ──────────────────────────────────────────────────────────────

function saveClinicSession(clinicId, userRole, userName) {
  fs.writeFileSync(clinicFile(), JSON.stringify({ clinicId, userRole, userName }, null, 2), 'utf8');
}

function loadClinicSession() {
  try {
    if (fs.existsSync(clinicFile())) {
      return JSON.parse(fs.readFileSync(clinicFile(), 'utf8'));
    }
  } catch {}
  return null;
}

function clearClinicSession() {
  try {
    if (fs.existsSync(clinicFile())) fs.unlinkSync(clinicFile());
  } catch {}
}

module.exports = { upsertUser, getUser, saveSession, loadSession, clearSession, saveClinicSession, loadClinicSession, clearClinicSession };
