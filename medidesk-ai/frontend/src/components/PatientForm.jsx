import React, { useState, useEffect, useRef } from 'react';
import cloudApi from '../cloudApi';
import VoiceRecorder from './VoiceRecorder';
import ConfirmModal from './ConfirmModal';
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
  const [customFields, setCustomFields] = useState({});
  const [columns, setColumns]           = useState([]);
  const [loading, setLoading]           = useState(false);
  const [existingPatients, setExistingPatients] = useState([]);
  const [isDirty, setIsDirty]           = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [conflictModal, setConflictModal] = useState(false); // inline conflict UI
  const initialDataRef = useRef(null);
  const { showToast, reportSyncIssue } = useUX();

  const handleTranscriptionComplete = (transcription) => {
    setFormData(prev => ({ ...prev, notes: prev.notes ? `${prev.notes}\n\n${transcription}` : transcription }));
  };

  useEffect(() => {
    fetchColumns();
    // Load existing patients for duplicate detection (only when adding new)
    if (!patient) {
      cloudApi.get('/patients').then(r => setExistingPatients(r.data.patients || [])).catch(() => {});
    }
  }, []);

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
      
      // Set custom field values
      const customData = {};
      columns.forEach(col => {
        if (!col.is_default && patient[col.column_name]) {
          customData[col.column_name] = patient[col.column_name];
        }
      });
      setCustomFields(customData);
    }
  }, [patient, columns]);

  const fetchColumns = async () => {
    try {
      const response = await cloudApi.get('/columns');
      setColumns(response.data.columns || []);
    } catch (error) {
      // Columns are optional — silently skip if not available
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setIsDirty(true);
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleCustomFieldChange = (fieldName, value) => {
    setIsDirty(true);
    setCustomFields(prev => ({ ...prev, [fieldName]: value }));
  };

  // Guard close — show confirm if form has unsaved changes
  const handleClose = () => {
    if (isDirty) { setShowCloseConfirm(true); } else { onClose(); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.notes.trim()) {
      alert('Notes field is mandatory');
      return;
    }

    // Duplicate detection (only for new patients)
    if (!patient && existingPatients.length > 0) {
      const term = formData.full_name.trim().toLowerCase();
      const duplicate = existingPatients.find(p =>
        (term && p.full_name?.toLowerCase() === term) ||
        (formData.phone && p.phone === formData.phone) ||
        (formData.email && p.email?.toLowerCase() === formData.email.toLowerCase())
      );
      if (duplicate) {
        const proceed = window.confirm(
          `⚠️ This patient may already exist:\n"${duplicate.full_name}" (${duplicate.phone || duplicate.email || 'no contact'})\n\nContinue adding anyway?`
        );
        if (!proceed) return;
      }
    }

    // Disable button immediately — prevents double submission
    setLoading(true);

    try {
      const submitData = {
        ...formData,
        custom_fields: customFields
      };

      setSyncStatus('saving');

      // ── Both roles: write directly to cloud ──────────────────────────────
      if (patient) {
        // Update existing patient
        const payload = {
          full_name:   submitData.full_name,
          phone:       submitData.phone       || '',
          email:       submitData.email       || '',
          notes:       submitData.notes       || '',
          appointment: submitData.appointment || '',
          status:      submitData.status      || 'Active',
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
        // Create new patient
        await cloudApi.post('/patients', {
          full_name:   submitData.full_name,
          phone:       submitData.phone       || '',
          email:       submitData.email       || '',
          notes:       submitData.notes       || '',
          appointment: submitData.appointment || '',
          status:      submitData.status      || 'Active',
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

  const renderCustomField = (column) => {
    const value = customFields[column.column_name] || '';
    
    switch (column.column_type) {
      case 'number':
        return (
          <input
            type="number"
            className="pf-input"
            value={value}
            onChange={(e) => handleCustomFieldChange(column.column_name, e.target.value)}
          />
        );
      case 'date':
        return (
          <input
            type="date"
            className="pf-input"
            value={value}
            onChange={(e) => handleCustomFieldChange(column.column_name, e.target.value)}
          />
        );
      case 'boolean':
        return (
          <select
            className="pf-select"
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
            className="pf-input"
            value={value}
            onChange={(e) => handleCustomFieldChange(column.column_name, e.target.value)}
          />
        );
    }
  };

  const customColumns = columns.filter(col => !col.is_default);

  return (
    <div className="pf-overlay">
      <div className="pf-modal">
        <div className="pf-header">
          <h2>{patient ? 'Edit Patient' : 'Add New Patient'}</h2>
          <button className="pf-close-btn" onClick={handleClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="pf-body">
          <div className="pf-group">
            <label className="pf-label">Full Name *</label>
            <input
              type="text"
              name="full_name"
              className="pf-input"
              value={formData.full_name}
              onChange={handleChange}
              required
            />
          </div>

          <div className="pf-group">
            <label className="pf-label">Phone</label>
            <input
              type="tel"
              name="phone"
              className="pf-input"
              value={formData.phone}
              onChange={handleChange}
            />
          </div>

          <div className="pf-group">
            <label className="pf-label">Email</label>
            <input
              type="email"
              name="email"
              className="pf-input"
              value={formData.email}
              onChange={handleChange}
            />
          </div>

          <div className="pf-group">
            <label className="pf-label">Appointment Date</label>
            <input
              type="date"
              name="appointment"
              className="pf-input"
              value={formData.appointment}
              onChange={handleChange}
            />
          </div>

          <div className="pf-group">
            <label className="pf-label">Status</label>
            <select
              name="status"
              className="pf-select"
              value={formData.status}
              onChange={handleChange}
            >
              <option value="Active">Active</option>
              <option value="Follow-up">Follow-up</option>
              <option value="Urgent">Urgent</option>
              <option value="Closed">Closed</option>
            </select>
          </div>

          <div className="pf-group">
            <label className="pf-label">Notes * <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>(required — reason for visit, symptoms, or any notes)</span></label>
            <textarea
              name="notes"
              className="pf-textarea"
              value={formData.notes}
              onChange={handleChange}
              placeholder="Patient notes (mandatory field)..."
              required
            />
          </div>

          {customColumns.map(column => (
            <div key={column.id} className="pf-group">
              <label className="pf-label">{column.column_name}</label>
              {renderCustomField(column)}
            </div>
          ))}
        </form>

        <div className="pf-footer">
          <button className="pf-btn-secondary" onClick={handleClose}>
            Close
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
            className="pf-btn-primary"
            disabled={loading || !formData.notes.trim()}
          >
            {loading ? 'Saving...' : 'Save Patient'}
          </button>
        </div>
      </div>

      {/* Unsaved changes confirmation */}
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

      {/* Conflict resolution modal */}
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
    </div>
  );
};

export default PatientForm;
