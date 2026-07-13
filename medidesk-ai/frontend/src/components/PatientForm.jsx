import React, { useState, useEffect, useRef, useCallback } from 'react';
import cloudApi from '../cloudApi';
import VoiceRecorder from './VoiceRecorder';
import ConfirmModal from './ConfirmModal';
import DuplicateCheckModal from './DuplicateCheckModal';
import { getSession } from '../hooks/useClinicSession';
import { isSecretary } from '../utils/roleUtils';
import { useUX } from '../context/UXContext';
import { updateCloudPatient } from '../services/patientSyncService';
import { useLanguage } from '../context/LanguageContext';

const PatientForm = ({ patient, onClose, onSave }) => {
  const { clinicId, userRole } = getSession();
  const secretary = isSecretary(userRole);
  const { t } = useLanguage();
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
    <div className="overlay open" onClick={handleClose}>
      <div className="modal wide" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          <h3>{patient ? t('form.edit_patient') : t('form.add_patient')}</h3>
          <button className="btn btn-ghost" style={{ marginLeft: 'auto', padding: '0 6px', fontSize: 18, color: 'var(--text-secondary)' }} onClick={handleClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          {!patient && !secretary && (
            <button
              type="button"
              onClick={() => setQuickMode(!quickMode)}
              className={`pf-quick-toggle ${quickMode ? 'pf-quick-toggle--on' : ''}`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
              {quickMode ? t('form.quick_mode_on') : t('form.quick_mode')}
            </button>
          )}

          <div className="field">
            <label>{t('form.full_name')} *</label>
            <input type="text" name="full_name" value={formData.full_name} onChange={handleChange} required autoFocus />
          </div>
          <div className="field">
            <label>{t('form.phone')}</label>
            <input type="tel" name="phone" value={formData.phone} onChange={handleChange} />
          </div>
          <div className="field">
            <label>{t('form.email')}</label>
            <input type="email" name="email" value={formData.email} onChange={handleChange} />
          </div>
          <div className="field">
            <label>{t('form.appointment_date')}</label>
            <input type="date" name="appointment" value={formData.appointment} onChange={handleChange} />
          </div>
          <div className="field">
            <label>{t('form.status')}</label>
            <select name="status" value={formData.status} onChange={handleChange}>
              <option value="Active">{t('patients.active')}</option>
              <option value="Follow-up">{t('patients.followup')}</option>
              <option value="Urgent">{t('patients.urgent')}</option>
              <option value="Closed">Closed</option>
            </select>
          </div>
          <div className="field">
            <label>{t('form.notes')} <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 400 }}>{t('form.notes_required')}</span></label>
            <textarea
              name="notes"
              style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', fontFamily: 'var(--font-ui)', resize: 'vertical', minHeight: 64, outline: 'none', color: 'var(--text-primary)' }}
              value={formData.notes}
              onChange={handleChange}
              placeholder="Reason for visit, symptoms, or any notes..."
              required
            />
          </div>

          {/* Voice dictation for notes */}
          {!secretary && (
            <VoiceRecorder
              onTranscriptionComplete={handleTranscriptionComplete}
              placeholder="Dictate notes"
            />
          )}

          {/* ── Smart Duplicate Warning ──────────────────────────────────── */}
          {!patient && duplicatesFound && possibleDuplicates.length > 0 && (
            <div style={{
              background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 'var(--radius-sm)',
              padding: '10px 14px', marginBottom: 16, fontSize: 13,
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
            <div key={column.id} className="field">
              <label>{column.column_name}</label>
              {renderCustomField(column)}
            </div>
          ))}

          <div className="modal-foot" style={{ borderTop: '1px solid var(--border)', padding: '14px 0 0', marginTop: 4 }}>
            <button type="button" className="btn btn-secondary" onClick={handleClose}>
              {t('form.cancel')}
            </button>
            {syncStatus && (
              <span className={`pf-sync-badge pf-sync-badge--${syncStatus}`}>
                {syncStatus === 'saving' ? `⟳ ${t('form.saving')}` : syncStatus === 'synced' ? `✓ ${t('common.synced')}` : '⚠ Offline — queued'}
              </span>
            )}
            <button type="submit" className="btn btn-primary" disabled={loading || (!quickMode && !formData.notes.trim())}>
              {loading ? (
                <><span className="pf-spinner" /> {t('form.saving')}</>
              ) : quickMode ? (
                <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> {t('form.quick_save')}</>
              ) : (
                <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg> {patient ? t('form.save_changes') : t('form.save')}</>
              )}
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
        <div className="overlay open">
          <div className="modal" style={{ width: 400 }}>
            <div className="modal-head">
              <h3>Patient updated by another user</h3>
              <button className="btn btn-ghost" style={{ marginLeft: 'auto', padding: '0 6px', fontSize: 18 }} onClick={() => setConflictModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                Your changes were not saved because someone else updated this patient more recently.
                Reload to see the latest version, then re-apply your changes.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn btn-secondary" onClick={() => setConflictModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => { setConflictModal(false); onClose(); onSave(); }}>Reload latest version</button>
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
  quickToggle: {
    fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8,
    border: '1px solid', cursor: 'pointer', marginBottom: 16, width: '100%',
    textAlign: 'center', transition: 'all 0.2s',
  },
  input: {
    width: '100%', height: 40, border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)',
    padding: '0 12px', fontSize: 14, outline: 'none', background: 'var(--bg-surface)',
    fontFamily: 'var(--font-ui)',
  },
};

export default PatientForm;
