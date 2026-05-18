const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

function dataDir() {
  return app.getPath('userData');
}

function legacyFile(name) {
  return path.join(dataDir(), name);
}

// Clean up legacy plaintext files that may remain from previous versions
function _cleanLegacy() {
  ['tokens.json', 'session.json', 'users.json', 'clinic.json'].forEach(f => {
    try { if (fs.existsSync(legacyFile(f))) fs.unlinkSync(legacyFile(f)); } catch {}
  });
}

function tokenFile() {
  _cleanLegacy();
  return path.join(dataDir(), 'tokens.enc');
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
      if (!buf || buf.length === 0) {
        console.warn('[tokenStore] token file is empty, clearing');
        clearTokens();
        return { accessToken: null, refreshToken: null };
      }
      if (safeStorage.isEncryptionAvailable()) {
        try {
          const decrypted = safeStorage.decryptString(buf);
          const parsed = JSON.parse(decrypted);
          if (!parsed.accessToken || typeof parsed.accessToken !== 'string') {
            console.warn('[tokenStore] invalid token format in encrypted file, clearing');
            clearTokens();
            return { accessToken: null, refreshToken: null };
          }
          return parsed;
        } catch (decryptErr) {
          console.warn('[tokenStore] failed to decrypt token file, clearing:', decryptErr.message);
          clearTokens();
          return { accessToken: null, refreshToken: null };
        }
      }
      const parsed = JSON.parse(buf.toString('utf8'));
      if (!parsed.accessToken || typeof parsed.accessToken !== 'string') {
        console.warn('[tokenStore] invalid token format in plaintext file, clearing');
        clearTokens();
        return { accessToken: null, refreshToken: null };
      }
      return parsed;
    }
  } catch (err) {
    console.warn('[tokenStore] failed to load tokens:', err.message);
  }
  return { accessToken: null, refreshToken: null };
}

function clearTokens() {
  try {
    if (fs.existsSync(tokenFile())) fs.unlinkSync(tokenFile());
  } catch {}
  // Remove any legacy plaintext files
  _cleanLegacy();
}

module.exports = { saveTokens, loadTokens, clearTokens };
