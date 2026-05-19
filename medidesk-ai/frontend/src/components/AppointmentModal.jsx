import { useState, useEffect, memo } from 'react';
import cloudApi from '../cloudApi';
import { createAppointment, updateAppointment } from '../services/appointmentSyncService';

const TIME_OPTIONS = [];
for (let h = 7; h <= 20; h++) {
  for (let m = 0; m < 60; m += 15) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
}

const STATUS_OPTIONS = [
  { value: 'scheduled',  label: 'Scheduled'  },
  { value: 'confirmed',  label: 'Confirmed'  },
  { value: 'urgent',     label: 'Urgent'     },
  { value: 'completed',  label: 'Completed'  },
  { value: 'cancelled',  label: 'Cancelled'  },
];

const AppointmentModal = ({ onClose, onSave, selectedDate, appointment, isSecretary }) => {
  const isEdit = Boolean(appointment?.id);

  const [patients, setPatients]         = useState([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');

  const [formData, setFormData] = useState({
    patient_id:       '',
    patient_name:     '',
    appointment_date: selectedDate.toISOString().split('T')[0],
    start_time:       '09:00',
    end_time:         '09:30',
    status:           'scheduled',
    notes:            '',
  });

  useEffect(() => {
    if (appointment) {
      setFormData({
        patient_id:       appointment.patient_id       || '',
        patient_name:     appointment.patient_name     || '',
        appointment_date: appointment.appointment_date || appointment.date || selectedDate.toISOString().split('T')[0],
        start_time:       appointment.start_time       || '09:00',
        end_time:         appointment.end_time         || '09:30',
        status:           appointment.status           || 'scheduled',
        notes:            appointment.notes            || '',
      });
    }
  }, [appointment]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await cloudApi.get('/patients');
        setPatients(res.data.patients || []);
      } catch {}
    };
    load();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setError('');
    if (name === 'patient_id') {
      const selected = patients.find(p => String(p.id) === value);
      setFormData(prev => ({
        ...prev,
        patient_id:   value,
        patient_name: selected ? selected.full_name : prev.patient_name,
      }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const validate = () => {
    if (!formData.patient_name.trim()) return 'Patient name is required.';
    if (!formData.appointment_date)    return 'Date is required.';
    if (!formData.start_time)          return 'Start time is required.';
    if (!formData.end_time)            return 'End time is required.';
    if (formData.start_time >= formData.end_time)
      return 'End time must be after start time.';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    setError('');

    try {
      if (isEdit) {
        const { conflict } = await updateAppointment(isSecretary, appointment.id, formData);
        if (conflict) {
          setError(`Time slot already booked: ${conflict.message || 'conflict detected'}`);
          setLoading(false);
          return;
        }
      } else {
        const { conflict } = await createAppointment(isSecretary, formData);
        if (conflict) {
          setError(`Time slot already booked: ${conflict.message || 'conflict detected'}`);
          setLoading(false);
          return;
        }
      }
      onSave();
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || err.message || 'Failed to save appointment.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.backdrop} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <div style={s.headerIcon}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </div>
          <div>
            <h2 style={s.title}>{isEdit ? 'Reschedule Appointment' : 'New Appointment'}</h2>
            <p style={s.subtitle}>{isEdit ? 'Update appointment details' : 'Schedule a patient appointment'}</p>
          </div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={s.body}>
          {error && (
            <div style={s.errorBox}>
              {error}
            </div>
          )}

          <div style={s.fieldGroup}>
            <label style={s.label}>Patient</label>
            {patients.length > 0 ? (
              <select name="patient_id" style={s.input} value={formData.patient_id} onChange={handleChange}>
                <option value="">Select a patient</option>
                {patients.map(p => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                name="patient_name"
                style={s.input}
                value={formData.patient_name}
                onChange={handleChange}
                placeholder="Patient name"
              />
            )}
            {patients.length > 0 && formData.patient_id && (
              <input
                type="text"
                name="patient_name"
                style={{ ...s.input, marginTop: 8 }}
                value={formData.patient_name}
                onChange={handleChange}
                placeholder="Patient name (editable)"
              />
            )}
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>Date</label>
            <input
              type="date"
              name="appointment_date"
              style={s.input}
              value={formData.appointment_date}
              onChange={handleChange}
              required
            />
          </div>

          <div style={s.row}>
            <div style={s.halfField}>
              <label style={s.label}>Start Time</label>
              <select name="start_time" style={s.input} value={formData.start_time} onChange={handleChange} required>
                {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={s.halfField}>
              <label style={s.label}>End Time</label>
              <select name="end_time" style={s.input} value={formData.end_time} onChange={handleChange} required>
                {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {formData.start_time && formData.end_time && formData.start_time >= formData.end_time && (
            <div style={s.timeError}>
              End time must be after start time.
            </div>
          )}

          <div style={s.fieldGroup}>
            <label style={s.label}>Status</label>
            <select name="status" style={s.input} value={formData.status} onChange={handleChange}>
              {STATUS_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>Notes <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span></label>
            <textarea
              name="notes"
              style={s.textarea}
              value={formData.notes}
              onChange={handleChange}
              rows={2}
              placeholder="Any notes for this appointment..."
            />
          </div>

          <div style={s.footer}>
            <button type="button" style={s.btnSecondary} onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button
              type="submit"
              style={{
                ...s.btnPrimary,
                opacity: loading || (formData.start_time >= formData.end_time) ? 0.6 : 1,
                cursor: loading || (formData.start_time >= formData.end_time) ? 'not-allowed' : 'pointer',
              }}
              disabled={loading || (formData.start_time >= formData.end_time)}
            >
              {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Save Appointment'}
            </button>
          </div>
        </form>
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
    background: '#fff', borderRadius: 14, width: 480,
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
  body:    { padding: '20px' },
  errorBox: {
    background: '#fef2f2', border: '1px solid #fecaca',
    borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#dc2626', marginBottom: 16,
  },
  fieldGroup: { marginBottom: 16 },
  label: {
    display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b',
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6,
  },
  input: {
    width: '100%', height: 40, border: '1px solid #e2e8f0', borderRadius: 8,
    padding: '0 12px', fontSize: 14, outline: 'none', background: '#fff',
    fontFamily: 'inherit', transition: 'all 0.2s ease',
  },
  textarea: {
    width: '100%', border: '1px solid #e2e8f0', borderRadius: 8,
    padding: '10px 12px', fontSize: 14, outline: 'none', background: '#fff',
    fontFamily: 'inherit', resize: 'vertical', transition: 'all 0.2s ease',
  },
  row: {
    display: 'flex', gap: 16,
  },
  halfField: {
    flex: 1, marginBottom: 16,
  },
  timeError: {
    fontSize: 12, color: '#dc2626', background: '#fef2f2',
    border: '1px solid #fecaca', borderRadius: 6, padding: '6px 10px',
    marginTop: -8, marginBottom: 16,
  },
  footer: {
    display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end',
    paddingTop: 14, borderTop: '1px solid #e2e8f0', marginTop: 8,
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

export default memo(AppointmentModal);
