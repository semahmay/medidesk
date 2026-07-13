import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
import cloudApi from '../cloudApi';
import { getSession } from '../hooks/useClinicSession';
import { useLanguage } from '../context/LanguageContext';
import DOMPurify from 'dompurify';

const DashboardPage = ({ settings, currentUser }) => {
  const { userRole } = getSession();
  const { t, lang } = useLanguage();
  const today       = new Date();
  const dateStr     = today.toISOString().split('T')[0];
  const displayName = currentUser?.name || settings?.doctor_name || t('common.doctor');

  // Locale-aware day / month names
  const dayName   = today.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'long' });
  const monthName = today.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', { month: 'long' });
  const greeting  = today.getHours() < 12
    ? t('dash.greeting.morning')
    : today.getHours() < 17
    ? t('dash.greeting.afternoon')
    : t('dash.greeting.evening');

  const [appointments,   setAppointments]   = useState([]);
  const [patients,       setPatients]       = useState([]);
  const [activities,     setActivities]     = useState([]);
  const [recentlyViewed, setRecentlyViewed] = useState([]);
  const [loading,        setLoading]        = useState(true);

  // AI Panel
  const [aiOpen,     setAiOpen]     = useState(false);
  const [aiMessages, setAiMessages] = useState([]);
  const [aiInput,    setAiInput]    = useState('');
  const [aiLoading,  setAiLoading]  = useState(false);
  const aiEndRef   = useRef(null);
  const aiInputRef = useRef(null);

  // Translated quick actions — recalculated when lang changes
  const QUICK_ACTIONS = useMemo(() => [
    {
      label:  lang === 'fr' ? 'Résumer la journée la plus chargée cette semaine' : 'Summarize the busiest day this week',
      prompt: 'Summarize the busiest day this week for the clinic.',
    },
    {
      label:  lang === 'fr' ? 'Quels patients ont besoin d\'un suivi ?' : 'Which patients are overdue for follow-up?',
      prompt: 'List patients who are overdue for a follow-up appointment.',
    },
    {
      label:  lang === 'fr' ? 'Combien de nouveaux patients ce mois-ci ?' : 'How many new patients this month?',
      prompt: 'How many new patients were added this month? Compare with last month.',
    },
  ], [lang]);

  useEffect(() => {
    if (aiEndRef.current) aiEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages]);

  useEffect(() => {
    if (aiOpen && aiInputRef.current) setTimeout(() => aiInputRef.current?.focus(), 100);
  }, [aiOpen]);

  const handleAiSend = async (msg) => {
    const text = (msg || aiInput).trim();
    if (!text) return;
    setAiMessages(prev => [...prev, { role: 'user', content: text }]);
    setAiInput('');
    setAiLoading(true);
    try {
      const res = await cloudApi.post('/chat', { message: text });
      setAiMessages(prev => [...prev, { role: 'assistant', content: res.data.response }]);
    } catch {
      setAiMessages(prev => [...prev, { role: 'assistant', content: lang === 'fr' ? 'Désolé, une erreur s\'est produite. Réessayez.' : 'Sorry, something went wrong. Please try again.' }]);
    } finally {
      setAiLoading(false);
    }
  };

  const formatAiMsg = (text) => {
    if (!text) return '';
    const html = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    return DOMPurify.sanitize(html, { ALLOWED_TAGS: ['strong', 'em', 'br', 'ul', 'li'], ALLOWED_ATTR: [] });
  };

  const todayAppointments = useMemo(() =>
    appointments.filter(a => a.appointment_date === dateStr),
    [appointments, dateStr]
  );

  const stats = useMemo(() => ({
    todayCount: todayAppointments.length,
    waiting:    todayAppointments.filter(a => a.status === 'arrived' || a.status === 'scheduled').length,
    total:      patients.length,
    urgent:     patients.filter(p => p.status === 'Urgent').length,
  }), [todayAppointments, patients]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [apptRes, patientRes, notifRes] = await Promise.all([
        cloudApi.get('/appointments').catch(() => ({ data: { appointments: [] } })),
        cloudApi.get('/patients').catch(() => ({ data: { patients: [] } })),
        cloudApi.get('/notifications').catch(() => ({ data: { notifications: [] } })),
      ]);
      setAppointments(apptRes.data.appointments || []);
      setPatients(patientRes.data.patients || []);
      const notifs = (notifRes.data.notifications || []).slice(0, 10);
      setActivities(notifs.map(n => ({
        id: n.id, type: n.type, title: n.title, message: n.message,
        time: n.created_at, actor_name: n.actor_name,
      })));
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('recently_viewed') || '[]');
      setRecentlyViewed(stored);
    } catch { setRecentlyViewed([]); }
  }, []);

  const formatActivityTime = (iso) => {
    if (!iso) return '';
    try {
      const diff = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return lang === 'fr' ? 'À l\'instant' : 'Just now';
      if (mins < 60) return lang === 'fr' ? `Il y a ${mins} min` : `${mins} min ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return lang === 'fr' ? `Il y a ${hrs}h` : `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
      return new Date(iso).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', { month: 'short', day: 'numeric' });
    } catch { return ''; }
  };

  const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  };

  if (loading) {
    return (
      <div className="app-shell">
        <TopBar settings={settings} currentUser={currentUser} />
        <Sidebar activePage="dashboard" />
        <div className="main-content page-transition">
          <div className="loading" style={{ padding: '80px 0', textAlign: 'center', color: 'var(--text-secondary)' }}>
            {t('common.loading')}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TopBar settings={settings} currentUser={currentUser} />
      <Sidebar activePage="dashboard" />
      <div className="main-content page-transition" style={{ overflowY: 'auto' }}>
        <div className="content-scroll">

          {/* Page head */}
          <div className="page-head">
            <div>
              <div className="eyebrow">{dayName}, {monthName} {today.getDate()}</div>
              <div className="page-title">{greeting}, Dr. {displayName.split(' ').pop()}</div>
            </div>
            <button className="btn btn-ai" onClick={() => setAiOpen(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5z"/></svg>
              {t('dash.ask_ai')}
            </button>
          </div>

          {/* Stat grid */}
          <div className="stat-grid">
            <div className="card stat-card">
              <div className="top"><span className="stat-icon" style={{ background: 'var(--primary-100)', color: 'var(--primary-700)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </span></div>
              <div className="stat-num">{stats.todayCount}</div>
              <div className="stat-label">{t('dash.today_appts')}</div>
            </div>
            <div className="card stat-card">
              <div className="top"><span className="stat-icon" style={{ background: 'var(--warning-100)', color: 'var(--warning-700)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </span></div>
              <div className="stat-num">{stats.waiting}</div>
              <div className="stat-label">{t('dash.waiting')}</div>
            </div>
            <div className="card stat-card">
              <div className="top"><span className="stat-icon" style={{ background: 'var(--info-100)', color: 'var(--info-700)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
              </span></div>
              <div className="stat-num">{stats.total}</div>
              <div className="stat-label">{t('dash.total_patients')}</div>
            </div>
            <div className="card stat-card">
              <div className="top"><span className="stat-icon" style={{ background: 'var(--danger-100)', color: 'var(--danger-700)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </span></div>
              <div className="stat-num">{stats.urgent}</div>
              <div className="stat-label">{t('dash.urgent')}</div>
            </div>
          </div>

          {/* Dash grid */}
          <div className="dash-grid">
            {/* Left column */}
            <div>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head"><h3>{t('dash.upcoming')}</h3></div>
                <div className="card-body">
                  {todayAppointments.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '20px 0', textAlign: 'center' }}>{t('dash.no_appts')}</p>
                  ) : (
                    todayAppointments.slice(0, 6).map(appt => (
                      <div key={appt.id} className="list-row">
                        <div className="avatar">{getInitials(appt.patient_name)}</div>
                        <div className="row-main">
                          <div className="row-name">{appt.patient_name}</div>
                          <div className="row-sub">{appt.reason || appt.status}</div>
                        </div>
                        <span className="row-time">{appt.start_time || appt.appointment_date}</span>
                        <span className={`badge ${appt.status === 'confirmed' || appt.status === 'completed' ? 'badge-success' : appt.status === 'urgent' ? 'badge-danger' : appt.status === 'pending' ? 'badge-warning' : 'badge-neutral'}`}>
                          <span className="dot"></span>{appt.status}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-head"><h3>{t('dash.recent_activity')}</h3></div>
                <div className="card-body">
                  {activities.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '20px 0', textAlign: 'center' }}>{t('dash.no_activity')}</p>
                  ) : (
                    activities.map(act => (
                      <div key={act.id} className="activity-item">
                        <span className="act-icon" style={{
                          background: act.type === 'appointment' ? 'var(--primary-100)' : act.type === 'patient' ? 'var(--success-100)' : 'var(--info-100)',
                          color:      act.type === 'appointment' ? 'var(--primary-700)' : act.type === 'patient' ? 'var(--success-700)' : 'var(--info-700)',
                        }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            {act.type === 'appointment'
                              ? <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>
                              : act.type === 'patient'
                              ? <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></>
                              : <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>
                            }
                          </svg>
                        </span>
                        <div>
                          <div className="act-text">{act.title || act.message}</div>
                          <div className="act-meta">{formatActivityTime(act.time)}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Right column */}
            <div>
              <div className="card ai-shortcut" style={{ marginBottom: 16 }}>
                <div className="card-body">
                  <div className="ai-shortcut-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="17" height="17"><path d="M12 2l2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5z"/></svg>
                    {t('dash.ai_title')}
                  </div>
                  <p>{t('dash.ai_sub')}</p>
                  <div className="ai-quick" style={{ padding: 0, marginTop: 8 }}>
                    {QUICK_ACTIONS.map((action, i) => (
                      <button key={i} onClick={() => { setAiOpen(true); setTimeout(() => handleAiSend(action.prompt), 50); }}>
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-head"><h3>{t('dash.recently_viewed')}</h3></div>
                <div className="card-body">
                  {recentlyViewed.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '20px 0', textAlign: 'center' }}>{t('dash.no_recent')}</p>
                  ) : (
                    recentlyViewed.slice(0, 5).map((item, i) => (
                      <div key={i} className="list-row">
                        <div className="avatar">{getInitials(item.name)}</div>
                        <div className="row-main">
                          <div className="row-name">{item.name}</div>
                          <div className="row-sub">
                            {lang === 'fr' ? 'Consulté' : 'Last viewed'} {formatActivityTime(item.time)}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── AI slide-in panel ── */}
      {aiOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200 }} onClick={() => setAiOpen(false)}>
          <div className="dash-ai-panel" onClick={e => e.stopPropagation()}>
            <div className="dash-ai-panel-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--ai-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" width="14" height="14"><path d="M12 2l2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5z"/></svg>
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{t('dash.ai_title')}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {lang === 'fr' ? 'Questions au niveau clinique' : 'Clinic-level questions'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {aiMessages.length > 0 && (
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setAiMessages([])}>
                    {lang === 'fr' ? 'Effacer' : 'Clear'}
                  </button>
                )}
                <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 16 }} onClick={() => setAiOpen(false)}>✕</button>
              </div>
            </div>

            <div className="dash-ai-msgs">
              {aiMessages.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 16px 0', color: 'var(--text-secondary)', fontSize: 13 }}>
                  <p style={{ margin: '0 0 16px' }}>
                    {lang === 'fr' ? 'Posez-moi une question sur la clinique' : 'Ask me anything about the clinic'}
                  </p>
                  <div className="ai-quick" style={{ justifyContent: 'center' }}>
                    {QUICK_ACTIONS.map((a, i) => (
                      <button key={i} onClick={() => handleAiSend(a.prompt)} disabled={aiLoading}>{a.label}</button>
                    ))}
                  </div>
                </div>
              ) : (
                aiMessages.map((m, i) => (
                  <div key={i} className={`dash-ai-msg ${m.role === 'user' ? 'dash-ai-msg--user' : 'dash-ai-msg--ai'}`}>
                    {m.role === 'assistant' && (
                      <div className="msg-ai-badge">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5z"/></svg>
                        AI
                      </div>
                    )}
                    <div dangerouslySetInnerHTML={{ __html: formatAiMsg(m.content) }} />
                  </div>
                ))
              )}
              {aiLoading && (
                <div className="dash-ai-msg dash-ai-msg--ai">
                  <div className="msg-ai-badge"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5z"/></svg>AI</div>
                  <div style={{ display: 'flex', gap: 4, padding: '2px 0' }}><span className="typing-dot"/><span className="typing-dot"/><span className="typing-dot"/></div>
                </div>
              )}
              <div ref={aiEndRef} />
            </div>

            <div className="ai-input" style={{ borderTop: '1px solid var(--border)', padding: '10px 14px' }}>
              <input
                ref={aiInputRef}
                type="text"
                placeholder={lang === 'fr' ? 'Posez une question à l\'IA…' : 'Ask the AI anything…'}
                value={aiInput}
                onChange={e => setAiInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiSend(); } }}
                disabled={aiLoading}
              />
              <button className="ai-send" onClick={() => handleAiSend()} disabled={aiLoading || !aiInput.trim()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
