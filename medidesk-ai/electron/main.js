const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const { spawn } = require('child_process');
const { startGoogleLogin } = require('./googleAuth');
const { loadSession, clearSession, loadClinicSession, clearClinicSession } = require('./userStore');

let mainWindow = null;
let backendProcess = null;
let currentUser = null;
let backendStarting = false; // guard against double-start

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
    },
    show: false,
    title: 'MediDesk AI',
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

  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, '../frontend/build/index.html')}`;

  // No injection. React calls get-session IPC on mount instead.
  mainWindow.webContents.once('did-finish-load', () => {
    if (isDev) mainWindow.webContents.openDevTools();
  });

  mainWindow.loadURL(startUrl);
}

// ─── Backend health polling ───────────────────────────────────────────────────

/**
 * Poll /api/health until Flask responds, then call onReady().
 * Gives up after maxAttempts and calls onReady() anyway so the app still opens.
 */
function waitForBackend(onReady, maxAttempts = 20, intervalMs = 300) {
  const http = require('http');
  let attempts = 0;

  const check = () => {
    attempts++;
    const req = http.get('http://localhost:5000/api/health', (res) => {
      if (res.statusCode === 200) {
        console.log(`[backend] Ready after ${attempts} attempt(s)`);
        backendStarting = false; // confirmed running — release guard
        onReady(true);           // true = backend is up
      } else {
        retry();
      }
    });
    req.on('error', retry);
    req.setTimeout(500, () => { req.destroy(); retry(); });
  };

  const retry = () => {
    if (attempts >= maxAttempts) {
      console.warn('[backend] Health check timed out — loading dashboard with warning');
      backendStarting = false; // release guard even on timeout
      onReady(false);          // false = backend did not start
    } else {
      setTimeout(check, intervalMs);
    }
  };

  setTimeout(check, 500); // first check after 500ms
}

function startBackend(googleId) {
  // Guard: never start a second process if one is already running or starting
  if (backendStarting || backendProcess) {
    console.warn('[backend] startBackend() called but already running/starting — skipped');
    return;
  }
  backendStarting = true;

  const backendPath = app.isPackaged 
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'backend')
    : path.join(__dirname, '../backend');
  const python = process.platform === 'win32' ? 'python' : 'python3';

  backendProcess = spawn(python, ['app.py'], {
    cwd: backendPath,
    stdio: 'inherit',
    env: { ...process.env, MEDIDESK_USER_ID: googleId, PYTHONIOENCODING: 'utf-8' },
  });

  // NOTE: backendStarting is released only after the health check confirms the
  // server is actually responding (see waitForBackend). This prevents the guard
  // from being released before the process is ready to accept connections.
  // The close/error handlers also release it as a safety net.

  backendProcess.on('error', (e) => {
    console.error('[backend] Failed to start:', e);
    backendStarting = false;
  });
  backendProcess.on('close', (code) => {
    console.log(`[backend] Exited with code ${code}`);
    backendProcess = null;
    backendStarting = false;
  });
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}

/**
 * Kill old backend, wait for port 5000 to be free, then start new one.
 * On Windows, kill() is async — the process may still hold the port briefly.
 */
function restartBackendForUser(googleId) {
  return new Promise((resolve) => {
    if (!backendProcess) {
      startBackend(googleId);
      resolve();
      return;
    }

    const oldProcess = backendProcess;
    backendProcess = null; // clear immediately so startBackend guard passes
    let started = false;

    oldProcess.once('close', () => {
      if (started) return; // safety timeout already fired
      started = true;
      console.log('[backend] Old process exited, starting new one for', googleId);
      setTimeout(() => { startBackend(googleId); resolve(); }, 500);
    });

    oldProcess.kill();

    // Safety timeout — if process doesn't exit in 5s, force start anyway
    setTimeout(() => {
      if (started) return; // close handler already fired
      started = true;
      console.warn('[backend] Force-starting new backend after timeout');
      startBackend(googleId);
      resolve();
    }, 5000);
  });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });

  const savedUser = loadSession();

  if (savedUser) {
    currentUser = savedUser;
    console.log(`[auth] Restored session for ${currentUser.email}`);
    startBackend(currentUser.googleId);
    waitForBackend((backendReady) => {
      createAppWindow();
      loadDashboard(true);
      if (!backendReady) {
        // Notify React that the local backend failed to start
        setTimeout(() => {
          mainWindow?.webContents.send('backend-start-failed');
        }, 1000);
      }
    });
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
  if (process.platform !== 'darwin') { stopBackend(); app.quit(); }
});

app.on('before-quit', stopBackend);

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
    //    Uses http (not https) — cloud backend runs on plain HTTP locally.
    //    No fallback — if cloud is offline this throws and we return failure.
    const cloudRes = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ google_token: googleUser.googleAccessToken });
      const req = http.request({
        hostname: '127.0.0.1',
        port: 8000,
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

    // 4. Save everything to disk atomically
    saveTokens({ accessToken: access_token, refreshToken: refresh_token });
    saveClinicSession(clinic_id, 'doctor', googleUser.name);
    // session.json already written by googleAuth.js during OAuth

    // 5. Start local backend for this user
    currentUser = googleUser;
    await restartBackendForUser(googleUser.googleId);
    await new Promise(resolve => waitForBackend(resolve));

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
        hostname: '127.0.0.1',
        port: 8000,
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
  return path.join(app.getPath('userData'), `patient_cache_${clinicId}.json`);
}

ipcMain.handle('save-patient-cache', (_e, { clinicId, patients }) => {
  if (!clinicId) return;
  try {
    fs.writeFileSync(patientCacheFile(clinicId), JSON.stringify(patients, null, 2), 'utf8');
  } catch (e) {
    console.warn('[cache] Failed to save patient cache:', e.message);
  }
});

ipcMain.handle('load-patient-cache', (_e, clinicId) => {
  if (!clinicId) return [];
  try {
    const file = patientCacheFile(clinicId);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
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
  stopBackend();

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
