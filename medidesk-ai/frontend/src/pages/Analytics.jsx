import React, { useState, useEffect } from 'react';
import cloudApi from '../cloudApi';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area
} from 'recharts';
import '../new-design.css';

// ── helpers ──────────────────────────────────────────────────────────────────

const TEAL   = '#1D9E75';
const BLUE   = '#3b82f6';
const GREEN  = '#10b981';
const RED    = '#ef4444';
const AMBER  = '#f59e0b';
const SLATE  = '#64748b';

const PIE_COLORS = [GREEN, AMBER, RED, SLATE];

/** Fill in missing months so the line chart always shows 6 points */
function fillLast6Months(data) {
  const now = new Date();
  const months = [];
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${monthNames[d.getMonth()]} ${d.getFullYear()}`);
  }
  return months.map(m => {
    const found = data.find(d => d.month === m);
    return { month: m, count: found ? found.count : 0 };
  });
}

// ── empty state ───────────────────────────────────────────────────────────────

const EmptyChart = ({ height = 250 }) => (
  <div style={{
    height, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 8,
    color: '#94a3b8'
  }}>
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
    <span style={{ fontSize: 13, fontWeight: 500 }}>No appointments yet</span>
    <span style={{ fontSize: 11 }}>Add appointments to see statistics</span>
  </div>
);

// ── metric card ───────────────────────────────────────────────────────────────

const MetricCard = ({ value, label, color }) => (
  <div style={{
    background: '#fff',
    border: '0.5px solid var(--color-border-tertiary, #e2e8f0)',
    borderRadius: 12,
    borderLeft: `4px solid ${color}`,
    padding: '14px 18px',
    maxHeight: 100,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 4,
    flex: 1,
    minWidth: 0,
  }}>
    <div style={{ fontSize: 28, fontWeight: 600, color, lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b' }}>{label}</div>
  </div>
);

// ── main component ────────────────────────────────────────────────────────────

const Analytics = ({ settings, currentUser }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [overview, setOverview] = useState({ total_patients: 0, appointments_this_month: 0, new_patients_this_month: 0, cancelled_appointments: 0 });
  const [patientGrowth, setPatientGrowth]           = useState([]);
  const [appointmentsByMonth, setAppointmentsByMonth] = useState([]);
  const [statusDistribution, setStatusDistribution]   = useState({ active: 0, followup: 0, urgent: 0, closed: 0 });
  const [appointmentStatus, setAppointmentStatus]     = useState({ confirmed: 0, pending: 0, cancelled: 0, urgent: 0 });
  const [busiestDays, setBusiestDays]                 = useState([]);
  const [recentActivity, setRecentActivity]           = useState([]);

  useEffect(() => {
    setOverview({ total_patients: 0, appointments_this_month: 0, new_patients_this_month: 0, cancelled_appointments: 0 });
    setPatientGrowth([]);
    setAppointmentsByMonth([]);
    setStatusDistribution({ active: 0, followup: 0, urgent: 0, closed: 0 });
    setAppointmentStatus({ confirmed: 0, pending: 0, cancelled: 0, urgent: 0 });
    setBusiestDays([]);
    setRecentActivity([]);
    fetchAnalyticsData();
  }, [currentUser?.googleId]);

  const fetchAnalyticsData = async () => {
    try {
      setError(null);
      // Use allSettled so one failing endpoint doesn't kill the whole page
      const [overviewRes, growthRes, appointmentsRes, statusRes, apptStatusRes, busiestRes, activityRes] =
        await Promise.allSettled([
          cloudApi.get('/analytics/overview'),
          cloudApi.get('/analytics/patient-growth'),
          cloudApi.get('/analytics/appointments-by-month'),
          cloudApi.get('/analytics/status-distribution'),
          cloudApi.get('/analytics/appointment-status'),
          cloudApi.get('/analytics/busiest-days'),
          cloudApi.get('/analytics/recent-activity'),
        ]);

      const val = (r) => r.status === 'fulfilled' ? r.value.data : null;

      const o = val(overviewRes);
      if (o) setOverview({
        total_patients:          Number(o.total_patients)          || 0,
        appointments_this_month: Number(o.appointments_this_month) || 0,
        new_patients_this_month: Number(o.new_patients_this_month) || 0,
        cancelled_appointments:  Number(o.cancelled_appointments)  || 0,
      });

      const growth = val(growthRes);
      setPatientGrowth(fillLast6Months(Array.isArray(growth) ? growth : []));

      const appts = val(appointmentsRes);
      setAppointmentsByMonth(Array.isArray(appts) ? appts.filter(i => i && 'month' in i) : []);

      const sd = val(statusRes);
      if (sd) setStatusDistribution({ active: Number(sd.active)||0, followup: Number(sd.followup)||0, urgent: Number(sd.urgent)||0, closed: Number(sd.closed)||0 });

      const as = val(apptStatusRes);
      if (as) setAppointmentStatus({ confirmed: Number(as.confirmed)||0, pending: Number(as.pending)||0, cancelled: Number(as.cancelled)||0, urgent: Number(as.urgent)||0 });

      const bd = val(busiestRes);
      if (bd && typeof bd === 'object') setBusiestDays(Object.entries(bd).map(([day, count]) => ({ day: day.substring(0, 3), appointments: count })));

      const act = val(activityRes);
      setRecentActivity(Array.isArray(act) ? act.filter(i => i && 'type' in i) : []);

    } catch (err) {
      console.error('Analytics fetch error:', err);
      setError('Failed to load analytics data');
      setPatientGrowth(fillLast6Months([]));
    } finally {
      setLoading(false);
    }
  };

  const hasAppointmentData = appointmentsByMonth.length > 0;
  const hasBusiestData     = busiestDays.some(d => d.appointments > 0);
  const hasPieData         = Object.values(appointmentStatus).some(v => v > 0);

  const getActivityIcon = (type) => {
    const colors = { new_patient: GREEN, appointment: TEAL, notes_updated: BLUE };
    return <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: colors[type] || SLATE, flexShrink: 0 }} />;
  };

  if (loading) return (
    <div className="app-container">
      <Sidebar activePage="analytics" />
      <div className="main-content">
        <TopBar settings={settings} currentUser={currentUser} />
        <div className="loading"><div className="spinner" /></div>
      </div>
    </div>
  );

  if (error) return (
    <div className="app-container">
      <Sidebar activePage="analytics" />
      <div className="main-content">
        <TopBar settings={settings} currentUser={currentUser} />
        <div style={{ padding: 20, textAlign: 'center' }}>
          <h3>Error loading analytics</h3>
          <p>{error}</p>
          <button onClick={fetchAnalyticsData} style={{ padding: '10px 20px', background: TEAL, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Retry</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="app-container">
      <Sidebar activePage="analytics" />
      <div className="main-content" style={{ overflowY: 'auto' }}>
        <TopBar settings={settings} currentUser={currentUser} />

        <div className="analytics-page" style={{ paddingBottom: 40 }}>

          {/* ── Metric cards ── */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <MetricCard value={overview.total_patients}          label="Total Patients"            color={TEAL}  />
            <MetricCard value={overview.appointments_this_month} label="Appointments This Month"   color={BLUE}  />
            <MetricCard value={overview.new_patients_this_month} label="New Patients This Month"   color={GREEN} />
            <MetricCard value={overview.cancelled_appointments}  label="Cancelled Appointments"    color={RED}   />
          </div>

          {/* ── Charts grid ── */}
          <div className="analytics-grid">

            {/* Patient Growth — area line chart */}
            <div className="chart-card">
              <h3 className="chart-title">Patient Growth</h3>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={patientGrowth}>
                  <defs>
                    <linearGradient id="tealGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={TEAL} stopOpacity={0.15} />
                      <stop offset="95%" stopColor={TEAL} stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke={TEAL}
                    strokeWidth={2}
                    fill="url(#tealGrad)"
                    dot={{ fill: TEAL, r: 5 }}
                    activeDot={{ r: 7 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Appointments per month + Pie side by side */}
            <div className="chart-row">
              <div className="chart-card">
                <h3 className="chart-title">Appointments per Month</h3>
                {hasAppointmentData ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={appointmentsByMonth}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" fill={TEAL} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyChart height={240} />}
              </div>

              <div className="chart-card">
                <h3 className="chart-title">Appointment Status</h3>
                {hasPieData ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Confirmed', value: appointmentStatus.confirmed },
                          { name: 'Pending',   value: appointmentStatus.pending   },
                          { name: 'Cancelled', value: appointmentStatus.cancelled },
                          { name: 'Urgent',    value: appointmentStatus.urgent    },
                        ]}
                        cx="50%" cy="50%"
                        innerRadius={45} outerRadius={85}
                        paddingAngle={2} dataKey="value"
                      >
                        {PIE_COLORS.map((color, i) => <Cell key={i} fill={color} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <EmptyChart height={240} />}
              </div>
            </div>

            {/* Patient Status distribution */}
            <div className="chart-card">
              <h3 className="chart-title">Patient Status</h3>
              <div className="status-cards">
                {[
                  { label: 'Active',     value: statusDistribution.active,   color: GREEN },
                  { label: 'Follow-up',  value: statusDistribution.followup, color: AMBER },
                  { label: 'Urgent',     value: statusDistribution.urgent,   color: RED   },
                  { label: 'Closed',     value: statusDistribution.closed,   color: SLATE },
                ].map(({ label, value, color }) => (
                  <div key={label} className="status-stat">
                    <div className="status-stat-value" style={{ color }}>{value}</div>
                    <div className="status-stat-label">{label}</div>
                    <div className="status-indicator" style={{ backgroundColor: color }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Busiest days */}
            <div className="chart-card">
              <h3 className="chart-title">Busiest Days of Week</h3>
              {hasBusiestData ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={busiestDays}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="appointments" fill={TEAL} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <EmptyChart height={240} />}
            </div>

            {/* Recent activity */}
            <div className="chart-card">
              <h3 className="chart-title">Recent Activity</h3>
              <div className="activity-feed">
                {recentActivity.length > 0 ? recentActivity.map((a, i) => (
                  <div key={i} className="activity-item">
                    <div className="activity-icon">{getActivityIcon(a.type)}</div>
                    <div className="activity-content">
                      <div className="activity-text">{a.description || '—'}</div>
                      <div className="activity-time">{a.time_ago || ''}</div>
                    </div>
                  </div>
                )) : (
                  <div className="no-activity">No recent activity</div>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

export default Analytics;
