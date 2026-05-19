import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
import AppointmentCalendar from '../components/AppointmentCalendar';
import WeekView from '../components/WeekView';
import MonthView from '../components/MonthView';
import DayView from '../components/DayView';
import AppointmentModal from '../components/AppointmentModal';
import ConfirmModal from '../components/ConfirmModal';
import { getSession } from '../hooks/useClinicSession';
import { isSecretary } from '../utils/roleUtils';
import { onRealtimeEvent } from '../cloudApi';
import {
  fetchAppointments,
  fetchWeekAppointments,
  deleteAppointment,
  updateAppointment,
} from '../services/appointmentSyncService';
import '../new-design.css';

// Status colour map — shared with appointment cards
export const STATUS_COLORS = {
  scheduled:  { bg: '#dbeafe', color: '#1d4ed8', border: '#bfdbfe' },
  confirmed:  { bg: '#dbeafe', color: '#1d4ed8', border: '#bfdbfe' },
  completed:  { bg: '#d1fae5', color: '#065f46', border: '#a7f3d0' },
  cancelled:  { bg: '#fee2e2', color: '#991b1b', border: '#fecaca' },
  urgent:     { bg: '#fef3c7', color: '#92400e', border: '#fde68a' },
  pending:    { bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' },
};

const Appointments = ({ settings, currentUser }) => {
  const { userRole } = getSession();
  const secretary = isSecretary(userRole);

  const [selectedDate, setSelectedDate]         = useState(new Date());
  const [appointments, setAppointments]         = useState([]);   // day view
  const [weekAppointments, setWeekAppointments] = useState([]);   // week/month view
  const [showModal, setShowModal]               = useState(false);
  const [editingAppointment, setEditingAppointment] = useState(null);
  const [viewMode, setViewMode]                 = useState('week');
  const [loadingAppts, setLoadingAppts]         = useState(false);
  const [error, setError]                       = useState('');
  const [stats, setStats]                       = useState({ thisWeek: 0, today: 0, scheduled: 0, urgent: 0 });
  const [deleteConfirm, setDeleteConfirm]       = useState(null); // appointment id to delete

  useEffect(() => {
    setAppointments([]);
    setWeekAppointments([]);
    reloadAll();
  }, [selectedDate, viewMode, currentUser?.googleId]);

  // Keyboard shortcut for new appointment
  useEffect(() => {
    const handleQuickAddAppt = () => setShowModal(true);
    window.addEventListener('quick-add-appointment', handleQuickAddAppt);
    return () => window.removeEventListener('quick-add-appointment', handleQuickAddAppt);
  }, []);

  // Replay appointment queue when network comes back
  useEffect(() => {
    const handleOnline = async () => {
      const { replayApptQueue } = await import('../services/appointmentSyncService');
      replayApptQueue().catch(() => {});
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  // Real-time appointment updates via WebSocket (SaaS mode)
  useEffect(() => {
    const unsubNew = onRealtimeEvent('appointment_new', () => reloadAll());
    const unsubUpd = onRealtimeEvent('appointment_updated', () => reloadAll());
    return () => { unsubNew(); unsubUpd(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, viewMode]);

  const dateStr = () => selectedDate.toISOString().split('T')[0];

  const reloadAll = useCallback(() => {
    if (viewMode === 'week')       loadWeekAppts();
    else if (viewMode === 'month') loadMonthAppts();
    else                           loadDayAppts();
    loadStats();
  }, [viewMode, loadDayAppts, loadWeekAppts, loadMonthAppts, loadStats]);

  const loadDayAppts = useCallback(async () => {
    setLoadingAppts(true);
    try {
      const data = await fetchAppointments(secretary, { date: dateStr() });
      setAppointments(data);
      setError('');
    } catch {
      setError('Failed to load appointments.');
    } finally {
      setLoadingAppts(false);
    }
  }, [secretary, selectedDate]);

  const loadWeekAppts = useCallback(async () => {
    setLoadingAppts(true);
    try {
      const data = await fetchWeekAppointments(secretary, dateStr());
      setWeekAppointments(data);
      setError('');
    } catch {
      setError('Failed to load appointments.');
    } finally {
      setLoadingAppts(false);
    }
  }, [secretary, selectedDate]);

  const loadMonthAppts = useCallback(async () => {
    setLoadingAppts(true);
    try {
      // Month: fetch the full month range
      const d = selectedDate;
      const start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
      const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
      const data  = await fetchAppointments(secretary, { start_date: start, end_date: end });
      setWeekAppointments(data);
      setError('');
    } catch {
      setError('Failed to load appointments.');
    } finally {
      setLoadingAppts(false);
    }
  }, [secretary, selectedDate]);

  const loadStats = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const { start, end } = getWeekRange(new Date());
      const all = await fetchAppointments(secretary, { start_date: start, end_date: end });
      setStats({
        thisWeek:  all.length,
        today:     all.filter(a => (a.appointment_date || a.date) === today).length,
        scheduled: all.filter(a => a.status === 'scheduled' || a.status === 'pending').length,
        urgent:    all.filter(a => a.status === 'urgent').length,
      });
    } catch { /* stats are non-critical */ }
  };

  const getWeekRange = (date) => {
    const start = new Date(date);
    const day = start.getDay();
    start.setDate(start.getDate() - day + (day === 0 ? -6 : 1));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
  };

  const handleAppointmentSave = useCallback(() => {
    setShowModal(false);
    setEditingAppointment(null);
    reloadAll(); // auto-refresh immediately after save
  }, [reloadAll]);

  const handleStatusUpdate = useCallback(async (appointmentId, newStatus) => {
    try {
      const appt = [...appointments, ...weekAppointments].find(a => a.id === appointmentId);
      await updateAppointment(secretary, appointmentId, { ...appt, status: newStatus });
      reloadAll();
    } catch {
      setError('Failed to update appointment.');
    }
  }, [appointments, weekAppointments, secretary, reloadAll]);

  const handleDelete = useCallback(async (appointmentId) => {
    setDeleteConfirm(appointmentId);
  }, []);

  const confirmDelete = useCallback(async () => {
    const id = deleteConfirm;
    setDeleteConfirm(null);
    try {
      await deleteAppointment(secretary, id);
      reloadAll();
    } catch {
      setError('Failed to delete appointment.');
    }
  }, [deleteConfirm, secretary, reloadAll]);

  const handleReschedule = useCallback((appointment) => {
    setEditingAppointment(appointment);
    setShowModal(true);
  }, []);

  const formatWeekRange = () => {
    const { start, end } = getWeekRange(selectedDate);
    const s = new Date(start + 'T00:00:00');
    const e = new Date(end   + 'T00:00:00');
    return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  };

  const statusStyle = (status) => STATUS_COLORS[status] || STATUS_COLORS.pending;

  return (
    <div className="app-container">
      <Sidebar activePage="appointments" />
      <div className="main-content page-transition">
        <TopBar settings={settings} currentUser={currentUser} />
        <div className="appointments-page">

          {/* ── Left column ── */}
          <div className="appointments-sidebar">
            <AppointmentCalendar
              selectedDate={selectedDate}
              onDateSelect={setSelectedDate}
              appointments={appointments}
              onViewChange={setViewMode}
            />

            <div className="day-appointments">
              <h3>
                {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              </h3>

              {loadingAppts ? (
                <p className="no-appointments">Loading...</p>
              ) : appointments.length === 0 ? (
                <p className="no-appointments">No appointments scheduled</p>
              ) : (
                appointments.map((appt) => {
                  const s = statusStyle(appt.status);
                  return (
                    <div
                      key={appt.id}
                      className="appointment-card"
                      style={{ borderLeft: `3px solid ${s.border}`, background: s.bg }}
                    >
                      <div className="appointment-time">{appt.start_time} – {appt.end_time}</div>
                      <div className="appointment-patient">{appt.patient_name}</div>
                      <div className="mt-4">
                        <span className="status-badge text-uppercase" style={{
                          background: s.border, color: s.color,
                        }}>
                          {appt.status}
                        </span>
                      </div>
                      <div className="appointment-actions">
                        {appt.status !== 'completed' && appt.status !== 'cancelled' && (
                          <button
                            className="action-btn confirm-btn"
                            onClick={() => handleStatusUpdate(appt.id, 'completed')}
                          >
                            Complete
                          </button>
                        )}
                        <button
                          className="action-btn reschedule-btn"
                          onClick={() => handleReschedule(appt)}
                        >
                          Reschedule
                        </button>
                        <button
                          className="action-btn cancel-btn"
                          onClick={() => handleDelete(appt.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── Right column ── */}
          <div className="appointments-main">
            {error && (
              <div className="error-banner">
                {error}
                <button
                  onClick={() => setError('')}
                  className="error-dismiss-btn"
                  style={{ marginLeft: 12 }}
                >
                  ×
                </button>
              </div>
            )}

            <div className="appointments-stats">
              <div className="stat-item"><div className="stat-label">This week</div><div className="stat-value teal">{stats.thisWeek}</div></div>
              <div className="stat-item"><div className="stat-label">Today</div><div className="stat-value">{stats.today}</div></div>
              <div className="stat-item"><div className="stat-label">Scheduled</div><div className="stat-value amber">{stats.scheduled}</div></div>
              <div className="stat-item"><div className="stat-label">Urgent</div><div className="stat-value red">{stats.urgent}</div></div>
            </div>

            <div className="week-view-header">
              <h2>
                {viewMode === 'month' && selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                {viewMode === 'week'  && `Week of ${formatWeekRange()}`}
                {viewMode === 'day'   && selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
              </h2>
              <div className="view-controls">
                <div className="view-toggle">
                  {['month', 'week', 'day'].map(mode => (
                    <button
                      key={mode}
                      className={`toggle-btn ${viewMode === mode ? 'active' : ''}`}
                      onClick={() => setViewMode(mode)}
                    >
                      {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </button>
                  ))}
                </div>
                <button
                  className="new-appointment-btn"
                  onClick={() => { setEditingAppointment(null); setShowModal(true); }}
                >
                  + New appointment
                </button>
              </div>
            </div>

            {loadingAppts ? (
              <div className="loading-state">
                <div className="loading-spinner" />
                <span>Loading appointments...</span>
              </div>
            ) : (
              <>
                {viewMode === 'month' && <MonthView selectedDate={selectedDate} appointments={weekAppointments} onDateSelect={setSelectedDate} />}
                {viewMode === 'week'  && <WeekView  selectedDate={selectedDate} appointments={weekAppointments} onDateSelect={setSelectedDate} />}
                {viewMode === 'day'   && <DayView   selectedDate={selectedDate} appointments={appointments} />}
              </>
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <AppointmentModal
          onClose={() => { setShowModal(false); setEditingAppointment(null); }}
          onSave={handleAppointmentSave}
          selectedDate={selectedDate}
          appointment={editingAppointment}
          isSecretary={secretary}
        />
      )}

      <ConfirmModal
        open={!!deleteConfirm}
        title="Delete appointment?"
        message="This appointment will be permanently removed."
        confirmLabel="Delete"
        confirmDanger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
};

export default Appointments;
