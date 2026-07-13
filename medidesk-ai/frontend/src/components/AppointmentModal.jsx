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

const errorBox = {
  background: 'var(--danger-50)', border: '1px solid var(--danger-200)',
  borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 13,
  color: 'var(--danger-700)', marginBottom: 14,
};

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

  const timeInvalid = formData.start_time && formData.end_time && formData.start_time >= formData.end_time;

  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span style={{
            width: 34, height: 34, borderRadius: 8, background: 'var(--primary-500)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </span>
          <h3>{isEdit ? 'Reschedule Appointment' : 'New Appointment'}</h3>
          <button
            onClick={onClose}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 16, color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px 6px' }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          {error && <div style={errorBox}>{error}</div>}

          <div className="field">
            <label>Patient</label>
            {patients.length > 0 ? (
              <select name="patient_id" value={formData.patient_id} onChange={handleChange}>
                <option value="">Select a patient</option>
                {patients.map(p => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                name="patient_name"
                value={formData.patient_name}
                onChange={handleChange}
                placeholder="Patient name"
              />
            )}
            {patients.length > 0 && formData.patient_id && (
              <input
                type="text"
                name="patient_name"
                value={formData.patient_name}
                onChange={handleChange}
                placeholder="Patient name (editable)"
                style={{ marginTop: 8 }}
              />
            )}
          </div>

          <div className="field">
            <label>Date</label>
            <input type="date" name="appointment_date" value={formData.appointment_date} onChange={handleChange} required />
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Start Time</label>
              <select name="start_time" value={formData.start_time} onChange={handleChange} required>
                {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>End Time</label>
              <select name="end_time" value={formData.end_time} onChange={handleChange} required>
                {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {timeInvalid && (
            <div style={{
              fontSize: 12, color: 'var(--danger-700)', background: 'var(--danger-50)',
              border: '1px solid var(--danger-200)', borderRadius: 'var(--radius-sm)',
              padding: '6px 10px', marginTop: -8, marginBottom: 14,
            }}>
              End time must be after start time.
            </div>
          )}

          <div className="field">
            <label>Status</label>
            <select name="status" value={formData.status} onChange={handleChange}>
              {STATUS_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Notes <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>(optional)</span></label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows={2}
              placeholder="Any notes for this appointment..."
              style={{
                width: '100%', padding: '9px 11px',
                border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-surface)', fontFamily: 'inherit', resize: 'vertical',
              }}
            />
          </div>

          <div className="modal-foot" style={{ padding: '14px 0 0', borderTop: '1px solid var(--border)', marginTop: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || timeInvalid}
            >
              {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Save Appointment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default memo(AppointmentModal);
