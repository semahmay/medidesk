const { app, BrowserWindow, ipcMain, session, safeStorage, clipboard } = require('electron');
const path = require('path');
const { startGoogleLogin } = require('./googleAuth');
const { loadSession, clearSession, loadClinicSession, clearClinicSession } = require('./userStore');

// ── Backend configuration (MUST be set in environment) ──────────────────────
const BACKEND_HOST = process.env.BACKEND_HOST;
const BACKEND_PORT = parseInt(process.env.BACKEND_PORT, 10) || 80;
if (!BACKEND_HOST) {
  console.error('FATAL: BACKEND_HOST environment variable is not set. Set it to your backend IP or domain.');
  process.exit(1);
}
// ────────────────────────────────────────────────────────────────────────────

let mainWindow = null;
let currentUser = null;

// Auto-update configuration
const isDev = !app.isPackaged;
let autoUpdater = null;

function initAutoUpdater() {
  if (isDev) {
    console.log('[updater] Running in development mode - skipping auto-update');
    return;
  }

  try {
    const { autoUpdater: updater } = require('electron-updater');
    autoUpdater = updater;

    autoUpdater.logger = require('electron-log');
    autoUpdater.logger.transports.file.level = 'info';
    autoUpdater.logger.transports.console.level = 'debug';

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      console.log('[updater] Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
      console.log('[updater] Update available:', info.version);
      mainWindow?.webContents.send('update-available', info);
    });

    autoUpdater.on('update-not-available', (info) => {
      console.log('[updater] No updates available');
    });

    autoUpdater.on('download-progress', (progress) => {
      console.log(`[updater] Download progress: ${progress.percent.toFixed(1)}%`);
      mainWindow?.webContents.send('update-progress', progress);
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[updater] Update downloaded:', info.version);
      mainWindow?.webContents.send('update-downloaded', info);
    });

    autoUpdater.on('error', (err) => {
      console.error('[updater] Error:', err.message);
    });

    // Check for updates after app starts
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => {
        console.warn('[updater] Check failed:', err.message);
      });
    }, 5000);

  } catch (err) {
    console.warn('[updater] Auto-updater not available:', err.message);
  }
}

// ─── Window helpers ───────────────────────────────────────────────────────────

function createAppWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 720,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    show: false,
    title: 'MediDesk AI',
    backgroundColor: '#0f172a',
    minWidth: 400,
    minHeight: 600,
  });

  // Content Security Policy - strict to prevent XSS
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          `connect-src 'self' http://${BACKEND_HOST} https://${BACKEND_HOST}`,
          "frame-ancestors 'none'",
          "form-action 'self'",
          "base-uri 'self'",
        ].join('; '),
      },
    });
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

function loadDashboard(withSession = false) {
  if (!mainWindow) return;

  if (withSession) {
    mainWindow.setResizable(true);
    mainWindow.setSize(1280, 800);
  } else {
    // No session yet — show compact login size for JoinClinic
    mainWindow.setResizable(false);
    mainWindow.setSize(480, 720);
  }
  mainWindow.center();

  const startUrl = `file://${path.join(__dirname, '../frontend/build/index.html')}`;

  mainWindow.loadURL(startUrl);
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });

  // Clean up any legacy plaintext cache files from previous versions
  try {
    const userData = app.getPath('userData');
    const files = fs.readdirSync(userData);
    files.forEach(f => {
      if (f.startsWith('patient_cache_') && f.endsWith('.json')) {
        try { fs.unlinkSync(path.join(userData, f)); } catch {}
      }
    });
  } catch {}

  const savedUser = loadSession();

  if (savedUser) {
    currentUser = savedUser;
    console.log(`[auth] Restored session for ${currentUser.email}`);
    // Production: all data comes from cloud — no local backend needed.
    // Load dashboard immediately without waiting for a local Flask process.
    createAppWindow();
    loadDashboard(true);
  } else {
    // No session — load React app at login size, JoinClinic renders automatically
    createAppWindow();
    loadDashboard(false);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createAppWindow();
      loadDashboard(false);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') { app.quit(); }
});

app.on('before-quit', () => {});

// ─── IPC shared dependencies ──────────────────────────────────────────────────
// Required here so all IPC handlers below can use them without inline requires.

const http  = require('http');
const https = require('https');
const { saveClinicSession } = require('./userStore');
const { saveTokens, loadTokens, clearTokens } = require('./tokenStore');
const { saveQueue, loadQueue } = require('./syncQueueStore');

// ─── IPC: Auth ────────────────────────────────────────────────────────────────

ipcMain.handle('start-login', async () => {
  try {
    // 1. Google OAuth — returns googleUser + googleAccessToken
    const googleUser = await startGoogleLogin();
    console.log(`[auth] Google login: ${googleUser.email} (${googleUser.googleId})`);

    // 2. Exchange Google access token for JWT from cloud backend
    //    Uses http — cloud backend runs behind Nginx on port 80 (BACKEND_HOST).
    //    No fallback — if cloud is offline this throws and we return failure.
    const cloudRes = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ google_token: googleUser.googleAccessToken });
      const req = http.request({
        hostname: BACKEND_HOST,
        port: BACKEND_PORT,
        path: '/api/auth/google',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) reject(new Error(parsed.error || 'cloud_auth_failed'));
            else resolve(parsed);
          } catch { reject(new Error('cloud_parse_failed')); }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('cloud_timeout')); });
      req.write(body);
      req.end();
    });

    // 3. cloudRes = { access_token, refresh_token, clinic_id, user }
    const { access_token, refresh_token, clinic_id } = cloudRes;
    if (!access_token || !clinic_id) throw new Error('incomplete_cloud_response');

    // 4. Save everything to disk atomically (encrypted via safeStorage)
    saveTokens({ accessToken: access_token, refreshToken: refresh_token });
    saveClinicSession(clinic_id, 'doctor', googleUser.name);
    // Session already persisted by googleAuth.js via saveSession() → session.enc

    // 5. Set currentUser (no local backend needed — all data comes from cloud)
    currentUser = googleUser;

    // 6. Expand window to dashboard size now that login succeeded
    mainWindow?.setResizable(true);
    mainWindow?.setSize(1280, 800);
    mainWindow?.center();

    // 7. Return complete session — React reads this and renders dashboard
    return {
      success: true,
      session: {
        googleId:     googleUser.googleId,
        name:         googleUser.name,
        email:        googleUser.email,
        clinicId:     clinic_id,
        userRole:     'doctor',
        userName:     googleUser.name,
        accessToken:  access_token,
        refreshToken: refresh_token,
      },
    };
  } catch (err) {
    console.error('[auth] Doctor login failed:', err.message);
    // Do NOT save any partial session on failure
    return { success: false, error: err.message || 'login_failed' };
  }
});

// ─── IPC: Secretary login ─────────────────────────────────────────────────────

ipcMain.handle('secretary-login', async (_e, { clinicId, name, password }) => {
  try {
    if (!clinicId || !name || !password) throw new Error('missing_fields');

    // 1. Authenticate with cloud — password required, no fallback
    const cloudRes = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ clinic_id: clinicId, name, password });
      const req = http.request({
        hostname: BACKEND_HOST,
        port: BACKEND_PORT,
        path: '/api/auth/secretary/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) reject(new Error(parsed.error || 'invalid_credentials'));
            else resolve(parsed);
          } catch { reject(new Error('cloud_parse_failed')); }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('cloud_timeout')); });
      req.write(body);
      req.end();
    });

    const { access_token, refresh_token } = cloudRes;
    if (!access_token) throw new Error('no_token_returned');

    // 2. Save to disk
    saveTokens({ accessToken: access_token, refreshToken: refresh_token });
    saveClinicSession(clinicId, 'secretary', name);

    // Set currentUser so get-current-user IPC and TopBar have a user object
    currentUser = { name, role: 'secretary', clinicId, googleId: null };

    // Expand window to dashboard size
    mainWindow?.setResizable(true);
    mainWindow?.setSize(1280, 800);
    mainWindow?.center();

    // 3. Return complete session
    return {
      success: true,
      session: {
        clinicId,
        userRole:     'secretary',
        userName:     name,
        accessToken:  access_token,
        refreshToken: refresh_token,
      },
    };
  } catch (err) {
    console.error('[auth] Secretary login failed:', err.message);
    return { success: false, error: err.message || 'invalid_credentials' };
  }
});

ipcMain.handle('get-current-user', () => currentUser);

// ─── IPC: Clinic session + tokens ────────────────────────────────────────────

// Single call React uses on startup — returns everything needed to restore session.
// Reads disk files that are always written before the window loads.
ipcMain.handle('get-session', () => {
  const tokens = loadTokens();
  const clinic = loadClinicSession();

  // For secretary sessions, reconstruct a minimal currentUser from clinic.json
  // so TopBar can display the secretary's name without a Google profile.
  let resolvedUser = currentUser || null;
  if (!resolvedUser && clinic?.userRole === 'secretary' && clinic?.userName) {
    resolvedUser = { name: clinic.userName, role: 'secretary', clinicId: clinic.clinicId, googleId: null };
  }

  return {
    googleUser: resolvedUser,
    tokens: tokens?.accessToken ? tokens : null,
    clinic: clinic?.clinicId ? clinic : null,
  };
});

ipcMain.handle('save-clinic-session', (_e, { clinicId, userRole, userName }) => {
  saveClinicSession(clinicId, userRole, userName);
});

ipcMain.handle('get-clinic-session', () => {
  return loadClinicSession();
});

// ─── IPC: JWT Tokens ──────────────────────────────────────────────────────────

ipcMain.handle('save-tokens', (_e, tokens) => {
  saveTokens(tokens);
});

ipcMain.handle('load-tokens', () => {
  return loadTokens();
});

ipcMain.handle('clear-tokens', () => {
  clearTokens();
});

// ─── IPC: Offline sync queue ──────────────────────────────────────────────────

ipcMain.handle('save-sync-queue', (_e, queue) => {
  // Use clinicId+userName for secretary to avoid collision between users.
  // Sanitize to remove filesystem-invalid characters (Windows-safe).
  const clinic = loadClinicSession();
  const rawKey = currentUser?.googleId
    || (clinic?.userRole === 'secretary' ? `${clinic.clinicId}_${clinic.userName}` : 'anonymous');
  const userId = rawKey.replace(/[/\\:*?"<>|]/g, '_');
  saveQueue(userId, queue);
});

ipcMain.handle('load-sync-queue', () => {
  const clinic = loadClinicSession();
  const rawKey = currentUser?.googleId
    || (clinic?.userRole === 'secretary' ? `${clinic.clinicId}_${clinic.userName}` : 'anonymous');
  const userId = rawKey.replace(/[/\\:*?"<>|]/g, '_');
  return loadQueue(userId);
});

// ─── IPC: Secretary offline patient cache ─────────────────────────────────────
// Persists the last known cloud patient list to disk so secretary can see
// stale data after an app restart while offline.

const fs = require('fs');

function patientCacheFile(clinicId) {
  return path.join(app.getPath('userData'), `patient_cache_${clinicId}.enc`);
}

ipcMain.handle('save-patient-cache', (_e, { clinicId, patients }) => {
  if (!clinicId) return;
  try {
    const str = JSON.stringify(patients);
    const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(str) : Buffer.from(str, 'utf8');
    fs.writeFileSync(patientCacheFile(clinicId), buf);
  } catch (e) {
    console.warn('[cache] Failed to save patient cache:', e.message);
  }
});

ipcMain.handle('load-patient-cache', (_e, clinicId) => {
  if (!clinicId) return [];
  try {
    const file = patientCacheFile(clinicId);
    if (fs.existsSync(file)) {
      const buf = fs.readFileSync(file);
      if (safeStorage.isEncryptionAvailable()) {
        return JSON.parse(safeStorage.decryptString(buf));
      }
      return JSON.parse(buf.toString('utf8'));
    }
  } catch (e) {
    console.warn('[cache] Failed to load patient cache:', e.message);
  }
  return [];
});

ipcMain.handle('logout', async () => {
  currentUser = null;
  clearSession();
  clearClinicSession();
  clearTokens();

  // Clear ALL browser storage so no stale data persists for the next user
  try {
    // First: explicitly wipe AI chat history keys before the full storage clear
    // (belt-and-suspenders — clearStorageData covers localStorage but this runs first)
    await mainWindow?.webContents.executeJavaScript(`
      try {
        Object.keys(localStorage)
          .filter(k => k.startsWith('aichat_'))
          .forEach(k => localStorage.removeItem(k));
      } catch(e) {}
    `);

    await mainWindow?.webContents.session.clearStorageData({
      storages: ['localstorage', 'indexeddb', 'cookies', 'cachestorage', 'serviceworkers']
    });
    await mainWindow?.webContents.session.clearCache();
    console.log('[auth] Cleared Electron session storage');
  } catch (e) {
    console.warn('[auth] Could not clear session storage:', e.message);
  }

  // Go straight back to the React app — JoinClinic renders automatically
  // because get-session will return no clinic. No login.html needed.
  mainWindow?.setSize(480, 720);
  mainWindow?.setResizable(false);
  mainWindow?.center();
  loadDashboard(false);
});

// ─── IPC: Window controls ─────────────────────────────────────────────────────

ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('minimize-window', () => mainWindow?.minimize());
ipcMain.handle('maximize-window', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.handle('close-window', () => mainWindow?.close());

// ─── IPC: Network status ──────────────────────────────────────────────────────────

ipcMain.handle('check-network', async () => {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: BACKEND_HOST,
      port: BACKEND_PORT,
      path: '/api/health',
      method: 'GET',
      timeout: 5000,
    }, (res) => {
      resolve({ online: res.statusCode < 400 });
    });
    req.on('error', () => resolve({ online: false }));
    req.on('timeout', () => { req.destroy(); resolve({ online: false }); });
    req.end();
  });
});

// ─── IPC: App info ────────────────────────────────────────────────────────────────

ipcMain.handle('get-build-info', () => {
  return {
    version: app.getVersion(),
    name: app.getName(),
    platform: process.platform,
    arch: process.arch,
  };
});

// ─── IPC: Clipboard ───────────────────────────────────────────────────────────────

ipcMain.handle('copy-to-clipboard', (_e, text) => {
  clipboard.writeText(text);
  return true;
});

// ─── IPC: Auto-update controls ───────────────────────────────────────────────────

ipcMain.handle('check-for-updates', async () => {
  if (!autoUpdater) return { available: false, error: 'Auto-updater not available' };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { available: !!result?.updateInfo, info: result?.updateInfo };
  } catch (err) {
    return { available: false, error: err.message };
  }
});

ipcMain.handle('download-update', async () => {
  if (!autoUpdater) return { error: 'Auto-updater not available' };
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('install-update', () => {
  if (autoUpdater) {
    autoUpdater.quitAndInstall(false, true);
  }
});

// Initialize auto-updater when app is ready
app.whenReady().then(() => {
  initAutoUpdater();
});
