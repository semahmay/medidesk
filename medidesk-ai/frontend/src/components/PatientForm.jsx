import React, { useState, useEffect, useRef, useCallback } from 'react';
import cloudApi from '../cloudApi';
import VoiceRecorder from './VoiceRecorder';
import ConfirmModal from './ConfirmModal';
import DuplicateCheckModal from './DuplicateCheckModal';
import { getSession } from '../hooks/useClinicSession';
import { isSecretary } from '../utils/roleUtils';
import { useUX } from '../context/UXContext';
import { updateCloudPatient } from '../services/patientSyncService';

const PatientForm = ({ patient, onClose, onSave }) => {
  const { clinicId, userRole } = getSession();
  const secretary = isSecretary(userRole);
  const [syncStatus, setSyncStatus] = useState('');
  const [formData, setFormData] = useState({
    full_name: '', phone: '', email: '', appointment: '', status: 'Active', notes: ''
  });
  const [quickMode, setQuickMode] = useState(false);
  const [customFields, setCustomFields] = useState({});
  const [columns, setColumns]           = useState([]);
  const [loading, setLoading]           = useState(false);
  const [isDirty, setIsDirty]           = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [conflictModal, setConflictModal] = useState(false);
  const initialDataRef = useRef(null);
  const { showToast, reportSyncIssue } = useUX();

  // ── Smart Duplicate Detection ───────────────────────────────────────────────
  const [possibleDuplicates, setPossibleDuplicates] = useState([]);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateChecking, setDuplicateChecking] = useState(false);
  const [duplicatesFound, setDuplicatesFound] = useState(false);
  const debounceTimer = useRef(null);
  const pendingSubmitRef = useRef(null);

  const handleTranscriptionComplete = (transcription) => {
    setFormData(prev => ({ ...prev, notes: prev.notes ? `${prev.notes}\n\n${transcription}` : transcription }));
  };

  useEffect(() => {
    fetchColumns();
  }, []);

  // ── Duplicate detection: debounced check on name/phone change ──────────────
  const checkDuplicates = useCallback(async (name, phone) => {
    if (!name && !phone) {
      setPossibleDuplicates([]);
      setDuplicatesFound(false);
      return;
    }
    setDuplicateChecking(true);
    try {
      const res = await cloudApi.get(`/patients/duplicates`, {
        params: { name, phone },
      });
      const dups = res.data.duplicates || [];
      setPossibleDuplicates(dups);
      setDuplicatesFound(dups.length > 0);
    } catch {
      // Non-critical — silently skip
    } finally {
      setDuplicateChecking(false);
    }
  }, []);

  useEffect(() => {
    if (patient) return; // Only check for new patients
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const name = formData.full_name.trim();
    const phone = formData.phone.trim();
    if (!name && !phone) {
      setDuplicatesFound(false);
      setPossibleDuplicates([]);
      return;
    }
    debounceTimer.current = setTimeout(() => {
      checkDuplicates(name, phone);
    }, 400);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [formData.full_name, formData.phone, patient, checkDuplicates]);

  useEffect(() => {
    if (patient) {
      setFormData({
        full_name: patient.full_name || '',
        phone: patient.phone || '',
        email: patient.email || '',
        appointment: patient.appointment || '',
        status: patient.status || 'Active',
        notes: patient.notes || ''
      });
      const customData = {};
      columns.forEach(col => {
        if (!col.is_default && patient.custom_fields?.[col.column_name]) {
          customData[col.column_name] = patient.custom_fields[col.column_name];
        }
      });
      setCustomFields(customData);
    }
  }, [patient, columns]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        const form = e.target.closest('form');
        if (form) {
          const inputs = Array.from(form.querySelectorAll('input, select, textarea'));
          const currentIndex = inputs.indexOf(e.target);
          if (currentIndex < inputs.length - 1) {
            e.preventDefault();
            inputs[currentIndex + 1]?.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDirty]);

  const fetchColumns = async () => {
    try {
      const response = await cloudApi.get('/columns');
      setColumns(response.data.columns || []);
    } catch (error) {}
  };

  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    setIsDirty(true);
    setFormData(prev => ({ ...prev, [name]: value }));
  }, []);

  const handleCustomFieldChange = (fieldName, value) => {
    setIsDirty(true);
    setCustomFields(prev => ({ ...prev, [fieldName]: value }));
  };

  const handleClose = useCallback(() => {
    if (isDirty) { setShowCloseConfirm(true); } else { onClose(); }
  }, [isDirty, onClose]);

  const handleOpenDuplicate = (dupPatient) => {
    setShowDuplicateModal(false);
    setPossibleDuplicates([]);
    setDuplicatesFound(false);
    onClose();
    // Pass the duplicate patient up so parent can navigate
    if (onSave) onSave(null, dupPatient);
  };

  const handleCreateAnyway = () => {
    setShowDuplicateModal(false);
    setPossibleDuplicates([]);
    setDuplicatesFound(false);
    doSubmit();
  };

  const doSubmit = async () => {
    setLoading(true);
    // Continue with existing submit logic...
    // (re-integrated below to avoid duplicate code)
    try {
      const submitData = {
        ...formData,
        custom_fields: customFields
      };

      setSyncStatus('saving');

      if (patient) {
        const payload = {
          full_name:   submitData.full_name,
          phone:       submitData.phone       || '',
          email:       submitData.email       || '',
          notes:       submitData.notes       || '',
          appointment: submitData.appointment || '',
          status:      submitData.status      || 'Active',
          custom_fields: submitData.custom_fields || {},
        };
        const result = await updateCloudPatient({ ...patient, ...payload });
        if (result.ok) {
          setSyncStatus('synced');
        } else if (result.conflict) {
          setSyncStatus('');
          setConflictModal(true);
          return;
        } else {
          setSyncStatus('offline');
          showToast('Patient update queued — will sync when reconnected.', 'warning', 5000);
        }
      } else {
        await cloudApi.post('/patients', {
          full_name:   submitData.full_name,
          phone:       submitData.phone       || '',
          email:       submitData.email       || '',
          notes:       submitData.notes       || '',
          appointment: submitData.appointment || '',
          status:      submitData.status      || 'Active',
          custom_fields: submitData.custom_fields || {},
        });
        setSyncStatus('synced');
      }

      setTimeout(() => { setSyncStatus(''); onSave(); }, 600);
    } catch (error) {
      console.error('Error saving patient:', error);
      setSyncStatus('');
      alert(error.response?.data?.error || 'Failed to save patient. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!quickMode && !formData.notes.trim()) {
      alert('Notes field is mandatory. Use Quick Mode for fast intake without notes.');
      return;
    }

    // If duplicates were found, show the warning modal before proceeding
    if (!patient && duplicatesFound && possibleDuplicates.length > 0) {
      setShowDuplicateModal(true);
      return;
    }

    await doSubmit();
  }, [quickMode, formData, patient, duplicatesFound, possibleDuplicates]);

  const renderCustomField = (column) => {
    const value = customFields[column.column_name] || '';
    switch (column.column_type) {
      case 'number':
        return (
          <input
            type="number"
            style={s.input}
            value={value}
            onChange={(e) => handleCustomFieldChange(column.column_name, e.target.value)}
          />
        );
      case 'date':
        return (
          <input
            type="date"
            style={s.input}
            value={value}
            onChange={(e) => handleCustomFieldChange(column.column_name, e.target.value)}
          />
        );
      case 'boolean':
        return (
          <select
            style={s.input}
            value={value}
            onChange={(e) => handleCustomFieldChange(column.column_name, e.target.value)}
          >
            <option value="">Select...</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        );
      default:
        return (
          <input
            type="text"
            style={s.input}
            value={value}
            onChange={(e) => handleCustomFieldChange(column.column_name, e.target.value)}
          />
        );
    }
  };

  const customColumns = columns.filter(col => !col.is_default);

  return (
    <div style={s.backdrop} className="modal-backdrop" onClick={handleClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <div style={s.headerIcon}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <div>
            <h2 style={s.title}>{patient ? 'Edit Patient' : 'Add New Patient'}</h2>
            <p style={s.subtitle}>{patient ? 'Update patient information' : 'Enter patient details below'}</p>
          </div>
          <button style={s.closeBtn} onClick={handleClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={s.body}>
          {!patient && !secretary && (
            <button
              type="button"
              onClick={() => setQuickMode(!quickMode)}
              style={{
                ...s.quickToggle,
                background: quickMode ? 'rgba(29,158,117,0.1)' : 'transparent',
                borderColor: quickMode ? '#1D9E75' : '#e2e8f0',
                color: quickMode ? '#1D9E75' : '#64748b',
              }}
            >
              {quickMode ? '⚡ Quick Mode ON' : '⚡ Quick Mode'}
            </button>
          )}

          <div style={s.fieldGroup}>
            <label style={s.label}>Full Name *</label>
            <input
              type="text"
              name="full_name"
              style={s.input}
              value={formData.full_name}
              onChange={handleChange}
              required
              autoFocus
            />
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>Phone</label>
            <input
              type="tel"
              name="phone"
              style={s.input}
              value={formData.phone}
              onChange={handleChange}
            />
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>Email</label>
            <input
              type="email"
              name="email"
              style={s.input}
              value={formData.email}
              onChange={handleChange}
            />
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>Appointment Date</label>
            <input
              type="date"
              name="appointment"
              style={s.input}
              value={formData.appointment}
              onChange={handleChange}
            />
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>Status</label>
            <select
              name="status"
              style={s.input}
              value={formData.status}
              onChange={handleChange}
            >
              <option value="Active">Active</option>
              <option value="Follow-up">Follow-up</option>
              <option value="Urgent">Urgent</option>
              <option value="Closed">Closed</option>
            </select>
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>
              Notes * <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>(required)</span>
            </label>
            <textarea
              name="notes"
              style={s.textarea}
              value={formData.notes}
              onChange={handleChange}
              placeholder="Reason for visit, symptoms, or any notes..."
              required
            />
          </div>

          {/* ── Smart Duplicate Warning ──────────────────────────────────── */}
          {!patient && duplicatesFound && possibleDuplicates.length > 0 && (
            <div style={{
              background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10,
              padding: '10px 14px', marginBottom: 16,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>
                  {possibleDuplicates.length === 1
                    ? '1 possible duplicate patient found'
                    : `${possibleDuplicates.length} possible duplicate patients found`}
                </span>
                {duplicateChecking && (
                  <span style={{ fontSize: 11, color: '#a16207', marginLeft: 'auto' }}>Checking...</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#a16207', lineHeight: 1.4 }}>
                {possibleDuplicates.slice(0, 2).map(d => d.patient.full_name).join(', ')}
                {possibleDuplicates.length > 2 && ` +${possibleDuplicates.length - 2} more`}
              </div>
            </div>
          )}

          {customColumns.map(column => (
            <div key={column.id} style={s.fieldGroup}>
              <label style={s.label}>{column.column_name}</label>
              {renderCustomField(column)}
            </div>
          ))}

          <div style={s.footer}>
            <button type="button" style={s.btnSecondary} onClick={handleClose}>
              Cancel
            </button>
            {syncStatus && (
              <span style={{
                fontSize: 12, padding: '4px 10px', borderRadius: 20, fontWeight: 600,
                background: syncStatus === 'synced' ? '#d1fae5' : syncStatus === 'offline' ? '#fef3c7' : '#dbeafe',
                color:      syncStatus === 'synced' ? '#065f46' : syncStatus === 'offline' ? '#92400e' : '#1e40af',
              }}>
                {syncStatus === 'saving' ? '⟳ Saving...' : syncStatus === 'synced' ? '✓ Synced' : '⚠ Offline — queued'}
              </span>
            )}
            <button
              type="submit"
              style={{
                ...s.btnPrimary,
                opacity: loading || (!quickMode && !formData.notes.trim()) ? 0.6 : 1,
                cursor: loading || (!quickMode && !formData.notes.trim()) ? 'not-allowed' : 'pointer',
              }}
              disabled={loading || (!quickMode && !formData.notes.trim())}
            >
              {loading ? 'Saving...' : quickMode ? '⚡ Quick Save' : 'Save Patient'}
            </button>
          </div>
        </form>
      </div>

      <ConfirmModal
        open={showCloseConfirm}
        title="Discard unsaved changes?"
        message="You have unsaved changes. If you close now, they will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        confirmDanger
        onConfirm={() => { setShowCloseConfirm(false); onClose(); }}
        onCancel={() => setShowCloseConfirm(false)}
      />

      {conflictModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999,
        }}>
          <div style={{
            background: '#fff', borderRadius: 12, padding: '24px 28px',
            width: 380, boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
          }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#1e293b' }}>
              Patient updated by another user
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: 14, color: '#475569', lineHeight: 1.5 }}>
              Your changes were not saved because someone else updated this patient more recently.
              Reload to see the latest version, then re-apply your changes.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConflictModal(false)}
                style={{ padding: '8px 16px', background: '#f1f5f9', border: 'none', borderRadius: 7, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#475569' }}
              >
                Cancel
              </button>
              <button
                onClick={() => { setConflictModal(false); onClose(); onSave(); }}
                style={{ padding: '8px 16px', background: '#1D9E75', border: 'none', borderRadius: 7, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#fff' }}
              >
                Reload latest version
              </button>
            </div>
          </div>
        </div>
      )}

      {showDuplicateModal && possibleDuplicates.length > 0 && (
        <DuplicateCheckModal
          duplicates={possibleDuplicates}
          onOpenExisting={handleOpenDuplicate}
          onCreateAnyway={handleCreateAnyway}
          onClose={() => setShowDuplicateModal(false)}
        />
      )}
    </div>
  );
};

const s = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
  },
  modal: {
    background: '#fff', borderRadius: 14, width: 520,
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
  body: { padding: '20px' },
  quickToggle: {
    fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8,
    border: '1px solid', cursor: 'pointer', marginBottom: 16, width: '100%',
    textAlign: 'center', transition: 'all 0.2s',
  },
  fieldGroup: { marginBottom: 14 },
  label: {
    display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b',
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6,
  },
  input: {
    width: '100%', height: 40, border: '1px solid #e2e8f0', borderRadius: 8,
    padding: '0 12px', fontSize: 14, outline: 'none', background: '#fff',
    transition: 'all 0.2s ease', fontFamily: 'inherit',
  },
  textarea: {
    width: '100%', minHeight: 100, border: '1px solid #e2e8f0', borderRadius: 8,
    padding: '10px 12px', fontSize: 14, outline: 'none', background: '#fff',
    fontFamily: 'inherit', resize: 'vertical', transition: 'all 0.2s ease',
  },
  footer: {
    display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end',
    paddingTop: 14, borderTop: '1px solid #e2e8f0', marginTop: 20,
  },
  btnSecondary: {
    padding: '8px 18px', border: '1px solid #e2e8f0', borderRadius: 8,
    background: '#fff', color: '#64748b', fontSize: 14, fontWeight: 500,
    cursor: 'pointer', transition: 'all 0.2s',
  },
  btnPrimary: {
    padding: '8px 20px', border: 'none', borderRadius: 8,
    background: '#1D9E75', color: '#fff', fontSize: 14, fontWeight: 600,
    boxShadow: '0 2px 8px rgba(29,158,117,0.3)',
    transition: 'all 0.2s',
  },
};

export default PatientForm;
