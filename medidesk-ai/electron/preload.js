const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Auth — promise-based, no event listeners
  startLogin:      () => ipcRenderer.invoke('start-login'),
  secretaryLogin:  (data) => ipcRenderer.invoke('secretary-login', data),
  getCurrentUser:  () => ipcRenderer.invoke('get-current-user'),
  logout:          () => ipcRenderer.invoke('logout'),

  // Session — single call returns everything (Phase 1)
  getSession: () => ipcRenderer.invoke('get-session'),

  // Clinic session persistence (used by useClinicSession.js saveSession)
  saveClinicSession: (data) => ipcRenderer.invoke('save-clinic-session', data),

  // JWT token persistence (used by cloudApi.js setCloudTokens)
  saveTokens: (tokens) => ipcRenderer.invoke('save-tokens', tokens),
  clearTokens: () => ipcRenderer.invoke('clear-tokens'),

  // Offline sync queue persistence (used by patientSyncService.js)
  saveSyncQueue: (queue) => ipcRenderer.invoke('save-sync-queue', queue),
  loadSyncQueue: () => ipcRenderer.invoke('load-sync-queue'),

  // Secretary offline patient cache (persists to disk, survives restart)
  savePatientCache: (data) => ipcRenderer.invoke('save-patient-cache', data),
  loadPatientCache: (clinicId) => ipcRenderer.invoke('load-patient-cache', clinicId),

  // App info + window controls
  getVersion:      () => ipcRenderer.invoke('get-app-version'),
  minimizeWindow:  () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow:  () => ipcRenderer.invoke('maximize-window'),
  closeWindow:     () => ipcRenderer.invoke('close-window'),

  // Network + build info
  checkNetwork:    () => ipcRenderer.invoke('check-network'),
  getBuildInfo:    () => ipcRenderer.invoke('get-build-info'),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),

  // Auto-update APIs
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate:  () => ipcRenderer.invoke('install-update'),
  onUpdateAvailable: (cb) => {
    ipcRenderer.on('update-available', (_e, info) => cb(info));
    return () => ipcRenderer.removeAllListeners('update-available');
  },
  onUpdateProgress: (cb) => {
    ipcRenderer.on('update-progress', (_e, progress) => cb(progress));
    return () => ipcRenderer.removeAllListeners('update-progress');
  },
  onUpdateDownloaded: (cb) => {
    ipcRenderer.on('update-downloaded', (_e, info) => cb(info));
    return () => ipcRenderer.removeAllListeners('update-downloaded');
  },

  // Platform
  platform: process.platform,
});
