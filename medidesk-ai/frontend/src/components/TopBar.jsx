import React, { useState, useEffect, useRef, useCallback } from 'react';
import cloudApi, { onRealtimeEvent } from '../cloudApi';
import ClinicModal from './ClinicModal';
import NotificationCenter from './NotificationCenter';
import NotificationToast, { showNotificationToast } from './NotificationToast';
import { useNotificationSound } from '../hooks/useNotificationSound';
import { getSession } from '../hooks/useClinicSession';
import { isSecretary } from '../utils/roleUtils';
import { getQueueCount, subscribeSyncQueueUpdates } from '../services/patientSyncService';
import { getSyncErrors, subscribeSyncErrorChanges } from '../services/syncErrorQueue';
import { useUX } from '../context/UXContext';
import { useLanguage } from '../context/LanguageContext';

const TopBar = ({ settings, currentUser, onLanguageChange }) => {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showClinicModal, setShowClinicModal] = useState(false);
  const [clinicInfo, setClinicInfo] = useState({ doctor_name: null, clinic_name: null });
  const [pendingSync, setPendingSync] = useState(0);
  const [failedSyncCount, setFailedSyncCount] = useState(0);
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [buildInfo, setBuildInfo] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const notifRef = useRef(null);
  const menuRef = useRef(null);
  const lastMsgIdRef = useRef(null);
  const { userRole } = getSession();
  const secretary = isSecretary(userRole);
  const { setShowSyncCenter } = useUX();
  const { enabled: soundEnabled, toggleSound, playSound } = useNotificationSound();

  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('theme') === 'dark');
  const { lang, setLanguage } = useLanguage();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const fetchNotifs = useCallback(async () => {
    try {
      const res = await cloudApi.get('/notifications');
      setNotifications(res.data.notifications || []);
      setUnreadCount(res.data.unread_count || 0);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    if (window.electronAPI?.getVersion) {
      window.electronAPI.getVersion().then(v => { if (v) setAppVersion(v); }).catch(() => {});
    }
    if (window.electronAPI?.getBuildInfo) {
      window.electronAPI.getBuildInfo().then(info => { if (info) setBuildInfo(info); }).catch(() => {});
    }

    cloudApi.get('/clinics/me')
      .then(res => {
        if (res.data) setClinicInfo({ doctor_name: res.data.doctor_name, clinic_name: res.data.clinic_name });
      })
      .catch(() => {});

    const refreshCounts = async () => {
      const [count, errors] = await Promise.all([
        getQueueCount().catch(() => 0),
        getSyncErrors().catch(() => []),
      ]);
      setPendingSync(count);
      setFailedSyncCount(errors.filter(e => !e.resolved).length);
    };

    refreshCounts();
    fetchNotifs();

    const notificationPoll = setInterval(fetchNotifs, 30000);
    const unsubQueue = subscribeSyncQueueUpdates(refreshCounts);
    const unsubErrors = subscribeSyncErrorChanges(refreshCounts);

    const unsubNotification = onRealtimeEvent('notification_new', (payload) => {
      const notif = {
        id: payload.id, type: payload.type, title: payload.title,
        message: payload.message, created_at: payload.created_at,
        actor_role: payload.actor_role, actor_name: payload.actor_name,
        is_read: false,
      };
      setNotifications(prev => [notif, ...prev]);
      setUnreadCount(prev => prev + 1);
      showNotificationToast(notif);
      if (payload.actor_role && payload.actor_role !== userRole) {
        const soundType = payload.type === 'appointment'
          ? `appointment_${payload.title?.toLowerCase().includes('updated') ? 'updated' : payload.title?.toLowerCase().includes('cancelled') ? 'cancelled' : 'created'}`
          : payload.type;
        playSound(soundType);
      }
    });

    const unsubMessage = onRealtimeEvent('message_new', (payload) => {
      if (!window.location.hash.includes('clinic-chat')) {
        if (lastMsgIdRef.current && payload.id !== lastMsgIdRef.current) {
          setUnreadCount(prev => prev + 1);
        }
      }
      lastMsgIdRef.current = payload.id;
      playSound('message');
    });

    return () => {
      clearInterval(notificationPoll);
      unsubQueue?.(); unsubErrors?.();
      unsubNotification?.(); unsubMessage?.();
    };
  }, [currentUser?.googleId, userRole, playSound, fetchNotifs]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifPanel(false);
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowUserMenu(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleFocus = async () => {
      try {
        const res = await cloudApi.get('/notifications');
        setNotifications(res.data.notifications || []);
        setUnreadCount(res.data.unread_count || 0);
      } catch { /* non-critical */ }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  const handleLogout = useCallback(async () => {
    setShowUserMenu(false);
    if (window.electronAPI?.logout) {
      await window.electronAPI.logout();
    }
  }, []);

  const getDoctorInitials = () => {
    const name = currentUser?.name || settings?.doctor_name;
    if (name) return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    return 'DR';
  };

  const syncStatusClass = failedSyncCount > 0 ? 'danger' : pendingSync > 0 ? 'warning' : '';

  return (
    <>
      <NotificationToast />
      <div className="topbar">
        {/* Collapse button */}
        <button className="collapse-btn" onClick={() => document.querySelector('.app-shell')?.classList.toggle('collapsed')} aria-label="Toggle sidebar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <rect x="3" y="4" width="18" height="16" rx="2"/>
            <line x1="9" y1="4" x2="9" y2="20"/>
          </svg>
        </button>

        {/* Clinic switch */}
        <div className="clinic-switch">
          <span className="clinic-dot"></span>
          <span>{clinicInfo.clinic_name || settings?.clinic_name || 'Riverside Family Clinic'}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="6 9 12 15 18 9"/></svg>
        </div>

        {/* Global search */}
        <div className="search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input placeholder="Search patients, appointments\u2026" aria-label="Search" />
          <span className="kbd">/</span>
        </div>

        <div className="topbar-right">
          {/* Sync pill */}
          <button
            onClick={() => setShowSyncCenter(true)}
            className={`sync-pill ${syncStatusClass}`}
            title="Open Sync Center"
          >
            {failedSyncCount > 0 ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span>{failedSyncCount} issues</span>
              </>
            ) : pendingSync > 0 ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
                <span>Syncing ({pendingSync})</span>
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
                <span>Synced</span>
              </>
            )}
          </button>

          {/* Language toggle */}
          <div className="language-toggle" style={{ display: 'flex', background: 'var(--bg-surface-alt)', borderRadius: 100, padding: 2 }}>
            {['FR', 'EN'].map(l => (
              <button
                key={l}
                className={`language-pill ${lang === l.toLowerCase() ? 'active' : ''}`}
                onClick={() => { setLanguage(l.toLowerCase()); if (onLanguageChange) onLanguageChange(l.toLowerCase()); }}
                style={{
                  padding: '4px 10px', borderRadius: 100, fontSize: 12, fontWeight: 600,
                  border: 'none', cursor: 'pointer',
                  background: lang === l.toLowerCase() ? 'var(--bg-surface)' : 'transparent',
                  color: lang === l.toLowerCase() ? 'var(--text-primary)' : 'var(--text-secondary)',
                  boxShadow: lang === l.toLowerCase() ? 'var(--shadow-card)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Dark mode toggle */}
          <button className="icon-btn" onClick={() => setDarkMode(v => !v)} title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
            {darkMode ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>

          {/* Notification bell */}
          <div ref={notifRef} style={{ position: 'relative' }}>
            <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setShowNotifPanel(v => !v); }} title="Notifications">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              {unreadCount > 0 && <span className="badge-dot"></span>}
            </button>
            {showNotifPanel && (
              <NotificationCenter
                notifications={notifications}
                unreadCount={unreadCount}
                onMarkRead={async (id) => {
                  try {
                    await cloudApi.patch(`/notifications/${id}/read`);
                    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
                    setUnreadCount(prev => Math.max(0, prev - 1));
                  } catch { /* */ }
                }}
                onMarkAllRead={async () => {
                  try {
                    await cloudApi.patch('/notifications/read-all');
                    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
                    setUnreadCount(0);
                  } catch { /* */ }
                }}
                onClose={() => setShowNotifPanel(false)}
                soundEnabled={soundEnabled}
                onToggleSound={toggleSound}
              />
            )}
          </div>

          {/* Profile */}
          <div className="user-menu-wrapper" ref={menuRef}>
            <div className="profile" onClick={() => setShowUserMenu(v => !v)}>
              <div className="avatar">{getDoctorInitials()}</div>
              <div className="profile-meta">
                <div className="name">{currentUser?.name || settings?.doctor_name || 'Doctor'}</div>
                <div className="role">{secretary ? 'Secretary' : 'Physician'}</div>
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="6 9 12 15 18 9"/></svg>
            </div>

            {showUserMenu && (
              <div className="user-dropdown">
                <div className="user-dropdown-info">
                  <span className="user-dropdown-name">{currentUser?.name || settings?.doctor_name}</span>
                  {currentUser?.email && <span className="user-dropdown-email">{currentUser.email}</span>}
                </div>
                <div className="user-dropdown-divider" />
                <button className="user-dropdown-item" onClick={() => { setShowUserMenu(false); setShowClinicModal(true); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                    <polyline points="9 22 9 12 15 12 15 22"/>
                  </svg>
                  Clinic Connection
                </button>
                <div className="user-dropdown-divider" />
                <button className="user-dropdown-item danger" onClick={handleLogout}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16 17 21 12 16 7"/>
                    <line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                  Log out
                </button>
                <div className="user-dropdown-divider" />
                <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-disabled)', textAlign: 'center' }}>
                  v{appVersion}
                  {buildInfo && <span> &middot; {buildInfo.platform}</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showClinicModal && (
        <ClinicModal currentUser={currentUser} onClose={() => setShowClinicModal(false)} />
      )}
    </>
  );
};

export default React.memo(TopBar);
