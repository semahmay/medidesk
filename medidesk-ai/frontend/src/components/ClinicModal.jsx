import { useState, useEffect, useCallback } from 'react';
import cloudApi from '../cloudApi';
import { saveSession, getSession } from '../hooks/useClinicSession';

const ClinicModal = ({ onClose, currentUser }) => {
  const [clinicId, setClinicId]               = useState(getSession().clinicId || '');
  const [copied, setCopied]                   = useState(false);
  const [creating, setCreating]               = useState(false);
  const [error, setError]                     = useState('');
  const [secretaries, setSecretaries]         = useState([]);
  const [loadingStaff, setLoadingStaff]       = useState(false);
  const [showAddForm, setShowAddForm]         = useState(false);
  const [newName, setNewName]                 = useState('');
  const [newEmail, setNewEmail]               = useState('');
  const [addingSecretary, setAddingSecretary] = useState(false);
  const [addError, setAddError]               = useState('');
  const [resettingId, setResettingId]         = useState(null); // secretary id being reset

  const hasClinic = !!clinicId;

  const loadSecretaries = useCallback(async () => {
    if (!hasClinic) return;
    setLoadingStaff(true);
    try {
      const res = await cloudApi.get('/clinic/secretaries');
      setSecretaries(res.data.secretaries || []);
    } catch (err) {
      console.error('Failed to load secretaries:', err);
    } finally {
      setLoadingStaff(false);
    }
  }, [hasClinic]);

  useEffect(() => { loadSecretaries(); }, [loadSecretaries]);

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const doctorName = currentUser?.name || 'Doctor';
      const res = await cloudApi.post('/clinic/create', { name: doctorName });
      const newClinicId = res.data.clinic_id;
      saveSession({ clinicId: newClinicId, userRole: 'doctor', userName: doctorName });
      setClinicId(newClinicId);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create clinic.');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(clinicId);
      } else {
        const el = document.createElement('textarea');
        el.value = clinicId;
        el.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(el);
        el.focus(); el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const handleAddSecretary = async (e) => {
    e.preventDefault();
    const nm = newName.trim();
    if (!nm) { setAddError('Name is required.'); return; }
    setAddingSecretary(true);
    setAddError('');
    try {
      const res = await cloudApi.post('/clinic/secretaries/create', {
        name: nm,
        email: newEmail.trim() || undefined,
      });
      setSecretaries(prev => [...prev, res.data.user]);
      setNewName('');
      setNewEmail('');
      setShowAddForm(false);
    } catch (err) {
      setAddError(err.response?.data?.error || 'Failed to add secretary.');
    } finally {
      setAddingSecretary(false);
    }
  };

  const getEffectiveStatus = (sec) =>
    sec.status || (sec.password_hash ? 'active' : 'invited');

  const handleResetPassword = async (sec) => {
    if (!window.confirm(`Reset password for "${sec.name}"? They will need to set a new password before logging in.`)) return;
    setResettingId(sec.id);
    try {
      await cloudApi.post(`/clinic/secretaries/${sec.id}/reset-password`);
      // Update local state to reflect invited status
      setSecretaries(prev => prev.map(s =>
        s.id === sec.id ? { ...s, status: 'invited', password_hash: null } : s
      ));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to reset password.');
    } finally {
      setResettingId(null);
    }
  };

  return (
    <div style={s.backdrop} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>

        <div style={s.header}>
          <div style={s.headerIcon}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <div>
            <h2 style={s.title}>Your Clinic</h2>
            <p style={s.subtitle}>Manage your clinic and staff</p>
          </div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={s.body}>
          {!hasClinic ? (
            <>
              <p style={s.desc}>
                You don't have a clinic set up yet. Create one to get your Clinic ID and invite your secretary.
              </p>
              {error && <div style={s.errorBox}>{error}</div>}
              <button
                style={{ ...s.createBtn, opacity: creating ? 0.7 : 1 }}
                onClick={handleCreate}
                disabled={creating}
              >
                {creating ? 'Creating...' : 'Create Clinic'}
              </button>
            </>
          ) : (
            <>
              <p style={s.sectionLabel}>Clinic ID</p>
              <div style={s.idBox}>
                <span style={s.idText}>{clinicId}</span>
                <button
                  style={{ ...s.copyBtn, background: copied ? '#10b981' : '#1D9E75' }}
                  onClick={handleCopy}
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <div style={s.infoRow}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span style={s.infoText}>Secretary enters this ID in the Join Clinic screen</span>
              </div>

              <div style={s.divider} />

              <div style={s.staffHeader}>
                <p style={{ ...s.sectionLabel, margin: 0 }}>Clinic Staff</p>
                <button
                  style={s.addBtn}
                  onClick={() => { setShowAddForm(v => !v); setAddError(''); }}
                >
                  {showAddForm ? 'Cancel' : '+ Add Secretary'}
                </button>
              </div>

              {showAddForm && (
                <form onSubmit={handleAddSecretary} style={s.addForm}>
                  <input
                    style={s.addInput}
                    placeholder="Name (required)"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    disabled={addingSecretary}
                    autoFocus
                  />
                  <input
                    style={s.addInput}
                    placeholder="Email (optional)"
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    disabled={addingSecretary}
                  />
                  {addError && <div style={s.addError}>{addError}</div>}
                  <button
                    style={{ ...s.addSubmitBtn, opacity: addingSecretary ? 0.7 : 1 }}
                    type="submit"
                    disabled={addingSecretary}
                  >
                    {addingSecretary ? 'Adding...' : 'Add Secretary'}
                  </button>
                </form>
              )}

              {loadingStaff ? (
                <p style={s.emptyText}>Loading staff...</p>
              ) : secretaries.length === 0 ? (
                <p style={s.emptyText}>No secretaries yet. Add one above.</p>
              ) : (
                <div style={s.staffList}>
                  {secretaries.map(sec => {
                    const status = getEffectiveStatus(sec);
                    const isActive = status === 'active';
                    return (
                      <div key={sec.id} style={s.staffRow}>
                        <div style={s.staffAvatar}>{sec.name.charAt(0).toUpperCase()}</div>
                        <div style={s.staffInfo}>
                          <span style={s.staffName}>{sec.name}</span>
                          {sec.email && <span style={s.staffEmail}>{sec.email}</span>}
                        </div>
                        <span style={{
                          ...s.badge,
                          background: isActive ? '#dcfce7' : '#fef9c3',
                          color: isActive ? '#166534' : '#854d0e',
                          border: `1px solid ${isActive ? '#86efac' : '#fde047'}`,
                        }}>
                          {isActive ? '● Active' : '○ Invited'}
                        </span>
                        {/* Password reset — only shown for active secretaries */}
                        {isActive && (
                          <button
                            onClick={() => handleResetPassword(sec)}
                            disabled={resettingId === sec.id}
                            title="Reset secretary password"
                            style={{
                              padding: '4px 8px', fontSize: 11, fontWeight: 600,
                              background: resettingId === sec.id ? '#e2e8f0' : '#fff',
                              color: '#dc2626', border: '1px solid #fecaca',
                              borderRadius: 5, cursor: resettingId === sec.id ? 'not-allowed' : 'pointer',
                              whiteSpace: 'nowrap', flexShrink: 0,
                            }}
                          >
                            {resettingId === sec.id ? '...' : '↺ Reset'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const s = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
  },
  modal: {
    background: '#fff', borderRadius: 14, width: 420,
    maxHeight: '85vh', overflowY: 'auto',
    boxShadow: '0 12px 40px rgba(0,0,0,0.15)',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px',
    background: '#f8fafb', borderBottom: '1px solid #e2e8f0',
    position: 'sticky', top: 0, zIndex: 1,
  },
  headerIcon: {
    width: 34, height: 34, borderRadius: 8, background: '#1D9E75',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  title:    { margin: 0, fontSize: 15, fontWeight: 700, color: '#1a202c' },
  subtitle: { margin: 0, fontSize: 12, color: '#64748b' },
  closeBtn: {
    marginLeft: 'auto', background: 'none', border: 'none',
    fontSize: 16, color: '#94a3b8', cursor: 'pointer', padding: '4px 6px',
  },
  body:         { padding: '20px' },
  sectionLabel: { margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' },
  desc:         { margin: '0 0 20px', fontSize: 14, color: '#475569', lineHeight: 1.6 },
  idBox: {
    display: 'flex', alignItems: 'center', gap: 10,
    background: '#f0fdf4', border: '1.5px solid #86efac',
    borderRadius: 10, padding: '12px 16px', marginBottom: 8,
  },
  idText: {
    flex: 1, fontSize: 20, fontWeight: 800,
    letterSpacing: '2px', color: '#166534', fontFamily: 'monospace',
  },
  copyBtn: {
    padding: '6px 14px', border: 'none', borderRadius: 6,
    color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', transition: 'background 0.2s',
  },
  infoRow:  { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 },
  infoText: { fontSize: 12, color: '#94a3b8' },
  divider:  { height: 1, background: '#e2e8f0', margin: '20px 0' },
  staffHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  addBtn: {
    background: '#1D9E75', color: '#fff', border: 'none',
    borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  addForm: {
    display: 'flex', flexDirection: 'column', gap: 8,
    background: '#f8fafb', border: '1px solid #e2e8f0',
    borderRadius: 10, padding: '14px', marginBottom: 14,
  },
  addInput: {
    height: 36, border: '1px solid #e2e8f0', borderRadius: 6,
    padding: '0 10px', fontSize: 13, outline: 'none', background: '#fff',
  },
  addError: {
    fontSize: 12, color: '#dc2626', background: '#fef2f2',
    border: '1px solid #fecaca', borderRadius: 6, padding: '6px 10px',
  },
  addSubmitBtn: {
    height: 36, background: '#1D9E75', color: '#fff',
    border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  staffList: { display: 'flex', flexDirection: 'column', gap: 8 },
  staffRow: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
    background: '#f8fafb', border: '1px solid #e2e8f0', borderRadius: 8,
  },
  staffAvatar: {
    width: 32, height: 32, borderRadius: '50%', background: '#e0f2fe', color: '#0369a1',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 700, flexShrink: 0,
  },
  staffInfo:  { flex: 1, display: 'flex', flexDirection: 'column', gap: 2 },
  staffName:  { fontSize: 13, fontWeight: 600, color: '#1e293b' },
  staffEmail: { fontSize: 11, color: '#94a3b8' },
  badge: {
    fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 20, whiteSpace: 'nowrap',
  },
  emptyText: { fontSize: 13, color: '#94a3b8', textAlign: 'center', padding: '16px 0', margin: 0 },
  createBtn: {
    width: '100%', height: 44, background: '#1D9E75', color: '#fff',
    border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer',
  },
  errorBox: {
    background: '#fef2f2', border: '1px solid #fecaca',
    borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#dc2626', marginBottom: 12,
  },
};

export default ClinicModal;
