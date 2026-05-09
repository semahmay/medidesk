/**
 * tokenStore.js
 * Persists JWT access + refresh tokens to disk so they survive app restarts.
 * Stored in the same userData folder as users.json / session.json.
 */

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

function tokenFile() {
  return path.join(app.getPath('userData'), 'tokens.json');
}

function saveTokens({ accessToken, refreshToken }) {
  fs.writeFileSync(
    tokenFile(),
    JSON.stringify({ accessToken, refreshToken }, null, 2),
    'utf8'
  );
}

function loadTokens() {
  try {
    if (fs.existsSync(tokenFile())) {
      return JSON.parse(fs.readFileSync(tokenFile(), 'utf8'));
    }
  } catch {}
  return { accessToken: null, refreshToken: null };
}

function clearTokens() {
  try {
    if (fs.existsSync(tokenFile())) fs.unlinkSync(tokenFile());
  } catch {}
}

module.exports = { saveTokens, loadTokens, clearTokens };
