import axios from 'axios';

const CLOUD_BASE = process.env.REACT_APP_CLOUD_URL || 'http://localhost:8000/api';

// ── STEP 2: Single source of tokens — in memory ONLY ─────────────────────────
// Tokens are loaded here exclusively via setCloudTokens() called from:
//   - App.jsx on startup (from get-session IPC)
//   - JoinClinic.jsx after login
// NO disk reads happen inside this file.

let _accessToken = null;
let _refreshToken = null;

export function setCloudTokens({ accessToken, refreshToken }) {
  _accessToken = accessToken || null;
  _refreshToken = refreshToken || null;

  // Persist to Electron disk so tokens survive app restarts
  if (window.electronAPI?.saveTokens) {
    window.electronAPI.saveTokens({ accessToken: _accessToken, refreshToken: _refreshToken });
  }
}

export function clearCloudTokens() {
  _accessToken = null;
  _refreshToken = null;
  if (window.electronAPI?.clearTokens) {
    window.electronAPI.clearTokens();
  }
}

export function getAccessToken() {
  return _accessToken;
}

// ── Axios instance ────────────────────────────────────────────────────────────

const cloudApi = axios.create({
  baseURL: CLOUD_BASE,
  headers: { 'Content-Type': 'application/json' },
});

// ── STEP 3: Request interceptor — STRICT ─────────────────────────────────────
// Every request MUST have a token. If not ready, reject immediately.
// This prevents unauthenticated requests from ever reaching the server.

cloudApi.interceptors.request.use((config) => {
  if (!_accessToken) {
    return Promise.reject(new Error('NO_TOKEN'));
  }
  config.headers['Authorization'] = `Bearer ${_accessToken}`;
  return config;
});

// ── STEP 4: Response interceptor — refresh logic ──────────────────────────────
// On 401: refresh ONCE, queue concurrent requests, retry after refresh.
// On refresh failure: clear tokens + trigger logout cleanly.

let _isRefreshing = false;
let _refreshQueue = []; // { resolve, reject }[]

cloudApi.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    // Only handle 401 with a refresh token available, and only retry once
    if (error.response?.status === 401 && !original._retried && _refreshToken) {
      original._retried = true;

      // ── STEP 4: While already refreshing, queue this request ─────────────
      if (_isRefreshing) {
        return new Promise((resolve, reject) => {
          _refreshQueue.push({ resolve, reject });
        }).then((newToken) => {
          original.headers['Authorization'] = `Bearer ${newToken}`;
          return cloudApi(original);
        });
      }

      // ── STEP 4: Start refresh ─────────────────────────────────────────────
      _isRefreshing = true;

      try {
        // Use plain axios (not cloudApi) to avoid triggering this interceptor again
        const res = await axios.post(`${CLOUD_BASE}/auth/refresh`, {
          refresh_token: _refreshToken,
        });

        const newAccessToken  = res.data.access_token;
        const newRefreshToken = res.data.refresh_token || _refreshToken; // rotated token or keep old

        // ── CRITICAL FIX: Update _accessToken BEFORE resolving queue ──────
        // This ensures the request interceptor uses the new token
        _accessToken = newAccessToken;
        _refreshToken = newRefreshToken;

        // Persist to disk (async, doesn't block)
        if (window.electronAPI?.saveTokens) {
          window.electronAPI.saveTokens({ accessToken: newAccessToken, refreshToken: newRefreshToken });
        }

        // ── STEP 5: Flush queued requests with new token ──────────────────
        _refreshQueue.forEach(({ resolve }) => resolve(newAccessToken));
        _refreshQueue = [];

        // Retry the original request (will use new token from interceptor)
        original.headers['Authorization'] = `Bearer ${newAccessToken}`;
        return cloudApi(original);

      } catch (refreshError) {
        // ── STEP 6: Refresh failed — clean logout ─────────────────────────
        _refreshQueue.forEach(({ reject }) => reject(refreshError));
        _refreshQueue = [];

        clearCloudTokens();

        // Trigger Electron logout → clears disk, resets window to login
        if (window.electronAPI?.logout) {
          window.electronAPI.logout();
        }

        return Promise.reject(refreshError);

      } finally {
        _isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default cloudApi;

// ── WebSocket / Real-time (SaaS mode only) ────────────────────────────────────
// In Electron mode: polling is used (existing behaviour, unchanged).
// In SaaS web mode: SocketIO connection is established after login.
//
// Usage:
//   import { connectRealtime, onRealtimeEvent, disconnectRealtime } from './cloudApi';
//   connectRealtime();
//   onRealtimeEvent('patient_updated', (data) => { ... });

let _socket = null;
const _handlers = {}; // event → [callback, ...]
let _lastSeq = 0;     // highest seq number processed — used for dedup + replay
const _processedSeqs = new Set(); // dedup window (last 500 seq numbers)
const _DEDUP_WINDOW = 500;

function _trackSeq(seq) {
  if (!seq) return true; // no seq = always process (legacy event)
  if (_processedSeqs.has(seq)) return false; // duplicate — skip
  _processedSeqs.add(seq);
  if (seq > _lastSeq) _lastSeq = seq;
  // Evict oldest entries to keep set bounded
  if (_processedSeqs.size > _DEDUP_WINDOW) {
    const oldest = Math.min(..._processedSeqs);
    _processedSeqs.delete(oldest);
  }
  return true; // new event — process it
}

export function connectRealtime() {
  // Only connect in web/SaaS mode — Electron uses polling
  if (window.electronAPI) return;
  if (_socket) return; // already connected
  if (!_accessToken) return;

  // Use require() wrapped in try/catch so webpack doesn't fail when
  // socket.io-client is not installed (Electron build).
  // eslint-disable-next-line
  let io;
  try {
    // This will be tree-shaken in Electron builds where socket.io-client is absent.
    // In SaaS web builds, install: npm install socket.io-client
    io = require('socket.io-client').io;
  } catch {
    console.info('[realtime] socket.io-client not available — real-time disabled (Electron mode)');
    return;
  }

  const WS_BASE = (process.env.REACT_APP_CLOUD_URL || 'http://localhost:8000')
    .replace('/api', '');

  _socket = io(WS_BASE, {
    auth: { token: `Bearer ${_accessToken}`, last_seq: _lastSeq },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10,
  });

    _socket.on('connect', () => {
      console.log('[realtime] connected');
    });

    _socket.on('disconnect', () => {
      console.log('[realtime] disconnected');
    });

    // On reconnect, send rejoin with last_seq so server replays missed events
    _socket.on('reconnect', () => {
      _socket.emit('rejoin', { token: `Bearer ${_accessToken}`, last_seq: _lastSeq });
    });

    // Replay missed events on reconnect
    _socket.on('missed_events', ({ events }) => {
      (events || []).forEach(({ event, data }) => {
        if (_trackSeq(data?.seq)) {
          (_handlers[event] || []).forEach(cb => cb(data));
        }
      });
    });

    // Forward all known events to registered handlers — with dedup
    const EVENTS = [
      'patient_created', 'patient_updated', 'patient_deleted',
      'message_new',
      'appointment_new', 'appointment_updated',
      'notification_new',
    ];
    EVENTS.forEach(evt => {
      _socket.on(evt, (data) => {
        if (_trackSeq(data?.seq)) {
          (_handlers[evt] || []).forEach(cb => cb(data));
        }
      });
    });
}

export function disconnectRealtime() {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}

export function onRealtimeEvent(event, callback) {
  if (!_handlers[event]) _handlers[event] = [];
  _handlers[event].push(callback);
  // Return unsubscribe function
  return () => {
    _handlers[event] = (_handlers[event] || []).filter(cb => cb !== callback);
  };
}

export function isRealtimeConnected() {
  return _socket?.connected ?? false;
}
