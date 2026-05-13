const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

function tokenFile() {
  return path.join(app.getPath('userData'), 'tokens.enc');
}

function saveTokens({ accessToken, refreshToken }) {
  const data = JSON.stringify({ accessToken, refreshToken });
  try {
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(tokenFile(), safeStorage.encryptString(data));
    } else {
      fs.writeFileSync(tokenFile(), Buffer.from(data, 'utf8'));
    }
  } catch (e) {
    console.error('[tokenStore] save failed:', e.message);
  }
}

function loadTokens() {
  try {
    if (fs.existsSync(tokenFile())) {
      const buf = fs.readFileSync(tokenFile());
      if (safeStorage.isEncryptionAvailable()) {
        return JSON.parse(safeStorage.decryptString(buf));
      }
      return JSON.parse(buf.toString('utf8'));
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
