import { useState } from 'react';
import axios from 'axios';
import { setSession } from '../App';
import { setCloudTokens } from '../cloudApi';
import { setUserId } from '../api';

const CLOUD_BASE = process.env.REACT_APP_CLOUD_URL || 'http://localhost:8000/api';

/**
 * JoinClinic — onboarding screen shown when no session exists.
 *
 * Secretary flow:
 *   Step 1: Enter name + clinicId → POST /auth/secretary/check
 *   Step 2a (invited):  Set password → POST /auth/secretary/set-password → auto-login
 *   Step 2b (active):   Enter password → POST /auth/secretary/login
 *
 * Doctor flow: unchanged (Google OAuth via Electron IPC)
 */
const JoinClinic = ({ onJoined }) => {
  const [step, setStep]           = useState('role');
  // 'role' | 'doctor' | 'sec-identify' | 'sec-set-password' | 'sec-login'

  const [name, setName]           = useState('');
  const [clinicId, setClinicId]   = useState('');
  const [password, setPassword]   = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  // ── Shared: apply a complete session ──────────────────────────────────────
  const applySession = (session) => {
    if (session.accessToken) {
      setCloudTokens({ accessToken: session.accessToken, refreshToken: session.refreshToken });
    }
    if (session.googleId) setUserId(session.googleId);
    setSession({
      clinicId: session.clinicId,
      userRole: session.userRole,
      userName: session.userName,
    });
  };

  // ── Doctor: Google OAuth via Electron ─────────────────────────────────────
  const handleDoctorLogin = async () => {
    if (loading) return;
    setLoading(true);
    setError('');

    if (!window.electronAPI?.startLogin) {
      setError('Google login is only available in the desktop app.');
      setLoading(false);
      return;
    }

    const result = await window.electronAPI.startLogin();

    if (!result.success) {
      const msg = result.error === 'cloud_timeout'
        ? 'Cloud server is offline. Start the cloud backend and try again.'
        : result.error === 'login_failed' || result.error?.includes('cancel')
          ? 'Login cancelled or failed. Please try again.'
          : `Login failed: ${result.error}`;
      setError(msg);
      setLoading(false);
      return;
    }

    applySession(result.session);
    onJoined({ googleId: result.session.googleId, name: result.session.name });
  };

  // ── Secretary Step 1: check status ────────────────────────────────────────
  const handleSecretaryCheck = async (e) => {
    e.preventDefault();
    const id = clinicId.trim().toUpperCase();
    const nm = name.trim();

    if (!id || !nm) { setError('Please fill in all fields.'); return; }
    if (!id.startsWith('MEDI-')) { setError('Clinic ID must start with MEDI-'); return; }

    setLoading(true);
    setError('');

    try {
      const res = await axios.post(`${CLOUD_BASE}/auth/secretary/check`, {
        clinic_id: id,
        name: nm,
      });

      const { status } = res.data;

      if (status === 'not_found') {
        setError('Secretary not found. Please contact your doctor.');
        setLoading(false);
        return;
      }

      if (status === 'invited') {
        setStep('sec-set-password');
      } else {
        setStep('sec-login');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reach server. Try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Secretary Step 2a: set password (first activation) ────────────────────
  const handleSetPassword = async (e) => {
    e.preventDefault();
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirmPw) { setError('Passwords do not match.'); return; }

    setLoading(true);
    setError('');

    try {
      await axios.post(`${CLOUD_BASE}/auth/secretary/set-password`, {
        clinic_id: clinicId.trim().toUpperCase(),
        name: name.trim(),
        password,
      });

      // Auto-login after activation
      await doLogin(password);
    } catch (err) {
      const serverMsg = err.response?.data?.error || '';
      const msg = serverMsg.includes('already activated')
        ? 'This account is already activated. Please login.'
        : serverMsg || 'Failed to activate account. Try again.';
      setError(msg);
      setLoading(false);
    }
  };

  // ── Secretary Step 2b: login (active account) ─────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!password) { setError('Password is required.'); return; }
    setLoading(true);
    setError('');
    await doLogin(password);
  };

  // ── Shared login call ──────────────────────────────────────────────────────
  const doLogin = async (pw) => {
    const id = clinicId.trim().toUpperCase();
    const nm = name.trim();

    try {
      if (window.electronAPI?.secretaryLogin) {
        // Electron path — IPC handles token persistence
        const result = await window.electronAPI.secretaryLogin({ clinicId: id, name: nm, password: pw });
        if (!result.success) {
          const msg = result.error?.includes('password') || result.error === 'invalid_credentials'
            ? 'Incorrect password.'
            : result.error?.includes('not activated')
              ? 'Account not activated yet.'
              : result.error === 'cloud_timeout'
                ? 'Cloud server is offline. Try again later.'
                : `Login failed: ${result.error}`;
          setError(msg);
          setLoading(false);
          return;
        }
        applySession(result.session);
        onJoined(null);
      } else {
        // Web fallback
        const res = await axios.post(`${CLOUD_BASE}/auth/secretary/login`, {
          clinic_id: id, name: nm, password: pw,
        });
        const { access_token, refresh_token, user } = res.data;
        setCloudTokens({ accessToken: access_token, refreshToken: refresh_token });
        setSession({ clinicId: user.clinic_id, userRole: user.role, userName: user.name });
        onJoined(null);
      }
    } catch (err) {
      const serverMsg = err.response?.data?.error || '';
      const msg = serverMsg.includes('Invalid password')
        ? 'Incorrect password.'
        : serverMsg.includes('not activated')
          ? 'Account not activated yet.'
          : serverMsg || 'Login failed. Try again.';
      setError(msg);
      setLoading(false);
    }
  };

  const resetToSecretaryStart = () => {
    setStep('sec-identify');
    setPassword('');
    setConfirmPw('');
    setError('');
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={s.overlay}>
      <div style={s.card}>
        <div style={s.logo}>M</div>
        <h1 style={s.title}>MediDesk AI</h1>

        {/* Role selection */}
        {step === 'role' && (
          <>
            <p style={s.subtitle}>Who are you?</p>
            <div style={s.roleRow}>
              <button style={s.roleBtn} onClick={() => setStep('doctor')}>
                <span style={s.roleIcon}>👨‍⚕️</span>
                <span style={s.roleName}>Doctor</span>
                <span style={s.roleHint}>Sign in with Google</span>
              </button>
              <button style={s.roleBtn} onClick={() => setStep('sec-identify')}>
                <span style={s.roleIcon}>🗂️</span>
                <span style={s.roleName}>Secretary</span>
                <span style={s.roleHint}>Join with Clinic ID</span>
              </button>
            </div>
          </>
        )}

        {/* Doctor login */}
        {step === 'doctor' && (
          <>
            <p style={s.subtitle}>Sign in with your Google account</p>
            {error && <div style={s.error}>{error}</div>}
            <button
              style={{ ...s.googleBtn, opacity: loading ? 0.7 : 1 }}
              onClick={handleDoctorLogin}
              disabled={loading}
            >
              {loading ? (
                <><span style={s.spinner} /> Signing in...</>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                  </svg>
                  Continue with Google
                </>
              )}
            </button>
            <button style={s.backBtn} onClick={() => { setStep('role'); setError(''); }}>← Back</button>
          </>
        )}

        {/* Secretary Step 1: identify */}
        {step === 'sec-identify' && (
          <>
            <p style={s.subtitle}>Enter your details to continue</p>
            <form onSubmit={handleSecretaryCheck} style={s.form}>
              <div style={s.field}>
                <label style={s.label}>Your Name</label>
                <input
                  style={s.input}
                  placeholder="e.g. Sara"
                  value={name}
                  onChange={e => { setName(e.target.value); setError(''); }}
                  disabled={loading}
                  autoFocus
                />
              </div>
              <div style={s.field}>
                <label style={s.label}>Clinic ID</label>
                <input
                  style={s.input}
                  placeholder="MEDI-XXXXX"
                  value={clinicId}
                  onChange={e => { setClinicId(e.target.value.toUpperCase()); setError(''); }}
                  disabled={loading}
                />
                <span style={s.hint}>Ask your doctor for the Clinic ID</span>
              </div>
              {error && <div style={s.error}>{error}</div>}
              <button
                style={{ ...s.btn, opacity: loading ? 0.7 : 1 }}
                type="submit"
                disabled={loading}
              >
                {loading ? 'Checking...' : 'Continue'}
              </button>
            </form>
            <button style={s.backBtn} onClick={() => { setStep('role'); setError(''); }}>← Back</button>
          </>
        )}

        {/* Secretary Step 2a: set password (first activation) */}
        {step === 'sec-set-password' && (
          <>
            <p style={s.subtitle}>Welcome, {name.trim()}. Set your password to activate your account.</p>
            <form onSubmit={handleSetPassword} style={s.form}>
              <div style={s.field}>
                <label style={s.label}>New Password</label>
                <input
                  style={s.input}
                  type="password"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(''); }}
                  disabled={loading}
                  autoFocus
                />
              </div>
              <div style={s.field}>
                <label style={s.label}>Confirm Password</label>
                <input
                  style={s.input}
                  type="password"
                  placeholder="Repeat your password"
                  value={confirmPw}
                  onChange={e => { setConfirmPw(e.target.value); setError(''); }}
                  disabled={loading}
                />
              </div>
              {error && <div style={s.error}>{error}</div>}
              <button
                style={{ ...s.btn, opacity: loading ? 0.7 : 1 }}
                type="submit"
                disabled={loading}
              >
                {loading ? 'Activating...' : 'Activate Account'}
              </button>
            </form>
            <button style={s.backBtn} onClick={resetToSecretaryStart}>← Back</button>
          </>
        )}

        {/* Secretary Step 2b: login (active account) */}
        {step === 'sec-login' && (
          <>
            <p style={s.subtitle}>Welcome back, {name.trim()}. Enter your password.</p>
            <form onSubmit={handleLogin} style={s.form}>
              <div style={s.field}>
                <label style={s.label}>Password</label>
                <input
                  style={s.input}
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(''); }}
                  disabled={loading}
                  autoFocus
                />
              </div>
              {error && <div style={s.error}>{error}</div>}
              <button
                style={{ ...s.btn, opacity: loading ? 0.7 : 1 }}
                type="submit"
                disabled={loading}
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
            <button style={s.backBtn} onClick={resetToSecretaryStart}>← Back</button>
          </>
        )}
      </div>
    </div>
  );
};

const s = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9999,
  },
  card: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    backdropFilter: 'blur(12px)',
    borderRadius: 20,
    padding: '44px 36px',
    width: 400,
    display: 'flex', flexDirection: 'column', alignItems: 'center',
  },
  logo: {
    width: 56, height: 56,
    background: 'linear-gradient(135deg, #1D9E75, #0ea5e9)',
    borderRadius: 14,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', fontWeight: 800, fontSize: 24, marginBottom: 14,
  },
  title:    { margin: '0 0 6px', fontSize: 24, fontWeight: 700, color: '#f1f5f9' },
  subtitle: { margin: '0 0 28px', fontSize: 14, color: '#94a3b8', textAlign: 'center' },
  roleRow:  { display: 'flex', gap: 14, width: '100%' },
  roleBtn: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 6, padding: '22px 12px',
    background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 12, cursor: 'pointer', transition: 'all 0.2s', color: '#f1f5f9',
  },
  roleIcon: { fontSize: 28 },
  roleName: { fontSize: 15, fontWeight: 700, color: '#f1f5f9' },
  roleHint: { fontSize: 11, color: '#64748b' },
  googleBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    width: '100%', height: 46,
    background: '#fff', color: '#1e293b',
    border: 'none', borderRadius: 10,
    fontSize: 15, fontWeight: 600, cursor: 'pointer', marginBottom: 12,
  },
  spinner: {
    display: 'inline-block', width: 14, height: 14,
    border: '2px solid rgba(0,0,0,0.2)', borderTopColor: '#1D9E75',
    borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginRight: 6,
  },
  form:  { width: '100%', display: 'flex', flexDirection: 'column', gap: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 13, fontWeight: 600, color: '#cbd5e1' },
  input: {
    height: 42, border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8,
    padding: '0 12px', fontSize: 14, outline: 'none',
    background: 'rgba(255,255,255,0.08)', color: '#f1f5f9',
  },
  hint: { fontSize: 11, color: '#64748b' },
  btn: {
    height: 44, background: '#1D9E75', color: '#fff',
    border: 'none', borderRadius: 8, fontSize: 15,
    fontWeight: 600, cursor: 'pointer', marginTop: 4,
  },
  error: {
    background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#fca5a5',
  },
  backBtn: {
    marginTop: 14, background: 'none', border: 'none',
    color: '#64748b', fontSize: 13, cursor: 'pointer',
  },
};

export default JoinClinic;
