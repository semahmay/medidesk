import { useState, useEffect } from 'react';
import api from '../api';
import cloudApi from '../cloudApi';
import { createAppointment, updateAppointment } from '../services/appointmentSyncService';

/**
 * AppointmentModal
 * Works for both doctor (local API) and secretary (cloud API).
 * Props:
 *   onClose, onSave, selectedDate, appointment (null = new), isSecretary
 */
const AppointmentModal = ({ onClose, onSave, selectedDate, appointment, isSecretary }) => {
  const isEdit = Boolean(appointment?.id);

  const [patients, setPatients]         = useState([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');   // inline error — no alert()

  const [formData, setFormData] = useState({
    patient_id:       '',
    patient_name:     '',
    appointment_date: selectedDate.toISOString().split('T')[0],
    start_time:       '09:00',
    end_time:         '09:30',
    status:           'scheduled',
    notes:            '',
  });

  // Pre-fill when rescheduling
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

  // Load patient list for the dropdown
  useEffect(() => {
    const load = async () => {
      try {
        if (isSecretary) {
          const res = await cloudApi.get('/patients');
          setPatients(res.data.patients || []);
        } else {
          const res = await api.get('/api/patients');
          setPatients(res.data.patients || []);
        }
      } catch {
        // Non-critical — user can still type patient name manually
      }
    };
    load();
  }, [isSecretary]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setError(''); // clear error on any change
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

  const timeOptions = [];
  for (let h = 7; h <= 20; h++) {
    for (let m = 0; m < 60; m += 15) {
      timeOptions.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }

  const statusOptions = [
    { value: 'scheduled',  label: 'Scheduled'  },
    { value: 'confirmed',  label: 'Confirmed'  },
    { value: 'urgent',     label: 'Urgent'     },
    { value: 'completed',  label: 'Completed'  },
    { value: 'cancelled',  label: 'Cancelled'  },
  ];

  return (
    <div className="modal-overlay">
      <div className="appointment-modal">
        <div className="modal-header">
          <h2>{isEdit ? 'Reschedule Appointment' : 'New Appointment'}</h2>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="appointment-form">

          {/* Inline error */}
          {error && (
            <div style={{
              padding: '8px 12px', background: '#fee2e2', border: '1px solid #fecaca',
              borderRadius: 6, color: '#991b1b', fontSize: 13, marginBottom: 12,
            }}>
              {error}
            </div>
          )}

          <div className="form-group">
            <label>Patient</label>
            {patients.length > 0 ? (
              <select name="patient_id" value={formData.patient_id} onChange={handleChange}>
                <option value="">Select a patient</option>
                {patients.map(p => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
            ) : (
              /* Fallback: free-text if patient list unavailable */
              <input
                type="text"
                name="patient_name"
                value={formData.patient_name}
                onChange={handleChange}
                placeholder="Patient name"
              />
            )}
            {/* Show selected name when using dropdown */}
            {patients.length > 0 && formData.patient_id && (
              <input
                type="text"
                name="patient_name"
                value={formData.patient_name}
                onChange={handleChange}
                placeholder="Patient name (editable)"
                style={{ marginTop: 6 }}
              />
            )}
          </div>

          <div className="form-group">
            <label>Date</label>
            <input
              type="date"
              name="appointment_date"
              value={formData.appointment_date}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Start Time</label>
              <select name="start_time" value={formData.start_time} onChange={handleChange} required>
                {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>End Time</label>
              <select name="end_time" value={formData.end_time} onChange={handleChange} required>
                {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Inline time validation hint */}
          {formData.start_time && formData.end_time && formData.start_time >= formData.end_time && (
            <div style={{ fontSize: 12, color: '#dc2626', marginTop: -8, marginBottom: 8 }}>
              End time must be after start time.
            </div>
          )}

          <div className="form-group">
            <label>Status</label>
            <select name="status" value={formData.status} onChange={handleChange}>
              {statusOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Notes <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span></label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows={2}
              style={{ width: '100%', resize: 'vertical', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }}
              placeholder="Any notes for this appointment..."
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
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

export default AppointmentModal;
