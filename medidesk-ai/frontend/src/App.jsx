import { useState, useEffect, Component } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard-New';
import Appointments from './pages/Appointments';
import MedicalReference from './pages/MedicalReference';
import Analytics from './pages/Analytics';
import ClinicChat from './pages/ClinicChat';
import JoinClinic from './pages/JoinClinic';
import ConflictMergeModal from './components/ConflictMergeModal';
import SyncCenter from './components/SyncCenter';
import { isDoctor } from './utils/roleUtils';
import { setUserId } from './api';
import { setCloudTokens, connectRealtime, disconnectRealtime } from './cloudApi';
import { UXProvider, useUX } from './context/UXContext';
import './new-design.css';
import './modal.css';

// ── Error Boundary ────────────────────────────────────────────────────────────
// Catches any unhandled render error in the component tree.
// Without this, a single component crash produces a white screen with no recovery.

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught error:', error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', gap: 16,
          background: '#0f172a', color: '#f1f5f9', fontFamily: 'sans-serif',
          padding: 32, textAlign: 'center',
        }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Something went wrong</h2>
          <p style={{ margin: 0, fontSize: 14, color: '#94a3b8', maxWidth: 400 }}>
            An unexpected error occurred. Your data is safe — please reload the app.
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: '10px 24px', background: '#1D9E75', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
              cursor: 'pointer', marginTop: 8,
            }}
          >
            Try again
          </button>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre style={{
              marginTop: 16, padding: 12, background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8,
              fontSize: 11, color: '#fca5a5', maxWidth: 600,
              overflow: 'auto', textAlign: 'left', maxHeight: 200,
            }}>
              {this.state.error.toString()}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

// ── In-memory session store (replaces localStorage-based useClinicSession) ────
// Single source of truth for the current session inside React.
// Written once on startup from the IPC get-session response.
// Written again after login from JoinClinic.
let _session = { clinicId: '', userRole: '', userName: '' };

export function setSession({ clinicId, userRole, userName = '' }) {
  _session = { clinicId, userRole, userName };
}

export function getSession() {
  return _session;
}

export function clearSessionMemory() {
  _session = { clinicId: '', userRole: '', userName: '' };
}

// ─────────────────────────────────────────────────────────────────────────────

function App() {
  const [loading, setLoading]               = useState(true);
  const [currentUser, setCurrentUser]       = useState(null);
  const [clinicReady, setClinicReady]       = useState(false);

  useEffect(() => {
    const init = async () => {
      // ── Electron path ──────────────────────────────────────────────────────
      if (window.electronAPI?.getSession) {
        // Single IPC call. Reads disk files that are always ready before the
        // window loads. No injection, no events, no timeouts, no race condition.
        const { googleUser, tokens, clinic } = await window.electronAPI.getSession();

        // 1. Load JWT tokens into cloudApi memory BEFORE any cloud request fires
        if (tokens?.accessToken) {
          setCloudTokens({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
        }

        // 2. Load Google user into api.js memory (X-User-ID header)
        if (googleUser?.googleId) {
          setUserId(googleUser.googleId);
          setCurrentUser(googleUser);
        }

        // 3. Load clinic session into memory
        if (clinic?.clinicId) {
          setSession({ clinicId: clinic.clinicId, userRole: clinic.userRole, userName: clinic.userName });
          setClinicReady(true);
        }
        // else: clinicReady stays false → JoinClinic renders

        setLoading(false);
        return;
      }

      // ── Browser / dev mode (no Electron) — not supported in cloud-only mode
      setLoading(false);
    };

    init();

    // Offline → online toast
    const handleOnline  = () => {};
    const handleOffline = () => {};
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  if (!clinicReady) {
    return (
      <JoinClinic
        onJoined={(user) => {
          if (user?.googleId) {
            setUserId(user.googleId);
            setCurrentUser(user);
          }
          setClinicReady(true);
        }}
      />
    );
  }

  return (
    <UXProvider>
      <AppInner
        currentUser={currentUser}
      />
    </UXProvider>
  );
}

// Inner component so it can use useUX (must be inside UXProvider)
function AppInner({ currentUser }) {
  const { showToast, conflictData, closeConflict, openConflict, showSyncCenter, setShowSyncCenter } = useUX();

  useEffect(() => {
    const attemptReplay = async () => {
      try {
        const { replayQueue } = await import('./services/patientSyncService');
        await replayQueue();
      } catch (err) {
        console.warn('[sync] replayQueue trigger failed', err);
      }
    };

    const handleOnline  = () => {
      showToast('Back online — syncing your changes.', 'success', 4000);
      attemptReplay();
    };
    const handleOffline = () => showToast('You are offline. Changes will sync when reconnected.', 'info', 5000);
    const handleFocus = () => attemptReplay();

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleFocus);

    const heartbeat = setInterval(() => {
      if (navigator.onLine) attemptReplay();
    }, 30000);

    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleFocus);
      clearInterval(heartbeat);
    };
  }, [showToast]);

  useEffect(() => {
    connectRealtime();
    return () => disconnectRealtime();
  }, []);

  return (
    <ErrorBoundary>
      <Router>
        <div className="app-container">
          <Routes>
            <Route path="/" element={<Dashboard currentUser={currentUser} />} />
            <Route path="/appointments" element={<Appointments currentUser={currentUser} />} />
            <Route path="/clinic-chat" element={<ClinicChat />} />

            {/* Doctor-only routes */}
            <Route
              path="/medical-reference"
              element={isDoctor(getSession().userRole)
                ? <MedicalReference currentUser={currentUser} />
                : <Navigate to="/" replace />}
            />
            <Route
              path="/analytics"
              element={isDoctor(getSession().userRole)
                ? <Analytics currentUser={currentUser} />
                : <Navigate to="/" replace />}
            />
          </Routes>
        </div>
      </Router>

      {/* ── Global: Conflict Merge Modal ── */}
      {conflictData && (
        <ConflictMergeModal data={conflictData} onClose={closeConflict} />
      )}

      {/* ── Global: Sync Center panel ── */}
      {showSyncCenter && (
        <SyncCenter
          onClose={() => setShowSyncCenter(false)}
          lastSyncMs={Date.now()}
          onOpenConflict={(err) => {
            setShowSyncCenter(false);
            if (err?.patient && err?.cloudVersion) {
              openConflict({
                local:       err.patient,
                cloud:       err.cloudVersion,
                patientName: err.patient?.full_name,
                onKeepLocal: async () => {
                  try {
                    const p = err.patient;
                    const forcePayload = { ...p, updated_at: new Date().toISOString() };
                    if (p.global_id) {
                      await (await import('./cloudApi')).default.put(`/patients/by-global/${p.global_id}`, { ...forcePayload, force: true });
                    } else if (p.cloud_id) {
                      await (await import('./cloudApi')).default.put(`/patients/${p.cloud_id}`, { ...forcePayload, force: true });
                    }
                    showToast('✅ Local version saved to cloud.', 'success', 4000);
                  } catch (e) {
                    showToast('Force overwrite failed: ' + (e?.message || ''), 'error', 6000);
                  }
                },
                onAcceptCloud: async () => {
                  showToast('Please reload the patient from the list to see the cloud version.', 'info', 5000);
                },
                onManualMerge: async (mergedData) => {
                  try {
                    const p = err.patient;
                    const payload = { ...mergedData, updated_at: new Date().toISOString() };
                    if (p.global_id) await (await import('./cloudApi')).default.put(`/patients/by-global/${p.global_id}`, { ...payload, force: true });
                    showToast('Merged version saved.', 'success', 4000);
                  } catch (e) {
                    showToast('Merge failed: ' + (e?.message || ''), 'error', 6000);
                  }
                },
              });
            }
          }}
          onRetryError={async () => {
            const { replayQueue } = await import('./services/patientSyncService');
            await replayQueue();
            setShowSyncCenter(false);
            showToast('↻ Retry initiated. Check Sync Center for results.', 'info', 4000);
          }}
        />
      )}
    </ErrorBoundary>
  );
}

export default App;
