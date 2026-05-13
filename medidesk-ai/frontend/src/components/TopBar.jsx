import React, { useState, useEffect, useRef } from 'react';
import cloudApi, { onRealtimeEvent } from '../cloudApi';
import ClinicModal from './ClinicModal';
import { getSession } from '../hooks/useClinicSession';
import { isSecretary } from '../utils/roleUtils';
import { getQueueCount, subscribeSyncQueueUpdates } from '../services/patientSyncService';
import { getSyncErrors, subscribeSyncErrorChanges } from '../services/syncErrorQueue';
import { useUX } from '../context/UXContext';
import '../new-design.css';

const TopBar = ({ settings, currentUser, onLanguageChange }) => {
  const [language, setLanguage] = useState(settings?.language || 'en');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showClinicModal, setShowClinicModal] = useState(false);
  const [clinicInfo, setClinicInfo] = useState({ doctor_name: null, clinic_name: null });
  const [pendingSync, setPendingSync] = useState(0);
  const [failedSyncCount, setFailedSyncCount] = useState(0);
  // Notifications
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const notifRef = useRef(null);
  const menuRef = useRef(null);
  const lastMsgIdRef = useRef(null);
  const { userRole } = getSession();
  const secretary = isSecretary(userRole);
  const { setShowSyncCenter } = useUX();

  useEffect(() => {
    cloudApi.get('/clinics/me')
      .then(res => {
        if (res.data) setClinicInfo({ doctor_name: res.data.doctor_name, clinic_name: res.data.clinic_name });
      })
      .catch(() => {}); // silently skip — local backend not running in cloud-only mode

    const refreshCounts = async () => {
      const [count, errors] = await Promise.all([
        getQueueCount().catch(() => 0),
        getSyncErrors().catch(() => []),
      ]);
      setPendingSync(count);
      setFailedSyncCount(errors.filter(e => !e.resolved).length);
    };

    const fetchNotifs = async () => {
      try {
        const res = await cloudApi.get('/notifications');
        setNotifications(res.data.notifications || []);
        setUnreadCount(res.data.unread_count || 0);
      } catch {
        // non-critical
      }
    };

    refreshCounts();
    fetchNotifs();

    const unsubQueue = subscribeSyncQueueUpdates(refreshCounts);
    const unsubErrors = subscribeSyncErrorChanges(refreshCounts);

    const unsubNotification = onRealtimeEvent('notification_new', (payload) => {
      setNotifications(prev => [{
        id: payload.id,
        type: payload.type,
        title: payload.title,
        message: payload.message,
        created_at: payload.created_at,
        is_read: false,
      }, ...prev]);
      setUnreadCount(prev => prev + 1);
    });

    const unsubMessage = onRealtimeEvent('message_new', (payload) => {
      if (!window.location.pathname.includes('clinic-chat')) {
        // Only increment when user is not already on the chat page.
        if (lastMsgIdRef.current && payload.id !== lastMsgIdRef.current) {
          setUnreadCount(prev => prev + 1);
        }
      }
      lastMsgIdRef.current = payload.id;
    });

    return () => {
      unsubQueue?.();
      unsubErrors?.();
      unsubNotification?.();
      unsubMessage?.();
    };
  }, [currentUser?.googleId]);

  // Close notification panel on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifPanel(false);
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowUserMenu(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const handleLanguageToggle = (lang) => {
    setLanguage(lang);
    if (onLanguageChange) onLanguageChange(lang);
  };

  const handleAvatarClick = (e) => {
    e.stopPropagation();
    setShowUserMenu(v => !v);
  };

  const handleNotifBellClick = (e) => {
    e.stopPropagation();
    setShowNotifPanel(v => !v);
  };

  const handleMarkRead = async (id) => {
    try {
      await cloudApi.patch(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch { /* non-critical */ }
  };

  const handleMarkAllRead = async () => {
    try {
      await cloudApi.patch('/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch { /* non-critical */ }
  };

  const handleLogout = async () => {
    setShowUserMenu(false);
    if (window.electronAPI?.logout) {
      await window.electronAPI.logout();
    }
  };

  const getDoctorInitials = () => {
    const name = currentUser?.name || settings?.doctor_name;
    if (name) return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    return 'DR';
  };

  const fmtNotifTime = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  };

  const notifTypeIcon = (type) => {
    const icons = {
      appointment: '📅',
      patient:     '👤',
      message:     '💬',
      system:      '⚙️',
    };
    return icons[type] || '🔔';
  };

  return (
    <>
    <div className="topbar">
      <div className="topbar-left">
        <h1 className="topbar-title">MediDesk AI</h1>
      </div>

      <div className="topbar-center">
        <span>{clinicInfo.doctor_name || settings?.doctor_name || currentUser?.name || 'Doctor'}</span>
        <span>•</span>
        <span>{clinicInfo.clinic_name || settings?.clinic_name || 'Clinic'}</span>
        <span>•</span>
        <span style={{ fontSize: 13, fontWeight: 'bold', color: pendingSync > 0 ? '#b45309' : (!navigator.onLine ? '#dc2626' : '#16a34a') }}>
           {!navigator.onLine ? '🔴 Offline' : (pendingSync > 0 ? '🟡 Syncing...' : '🟢 All synced')}
        </span>
      </div>

      <div className="topbar-right">
        {/* ── Sync Center button — shows failed/pending badge ── */}
        <button
          id="sync-center-btn"
          onClick={() => setShowSyncCenter(true)}
          title="Open Sync Center"
          style={{
            position: 'relative',
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 11, fontWeight: 600,
            padding: '4px 10px', borderRadius: 20,
            border: '1px solid',
            cursor: 'pointer',
            background: failedSyncCount > 0 ? '#fef2f2' : pendingSync > 0 ? '#fff7ed' : '#f0fdf4',
            color:      failedSyncCount > 0 ? '#991b1b' : pendingSync > 0 ? '#9a3412' : '#16a34a',
            borderColor:failedSyncCount > 0 ? '#fecaca' : pendingSync > 0 ? '#fed7aa' : '#bbf7d0',
            transition: 'all 0.2s',
          }}
        >
          {failedSyncCount > 0 ? (
            <>
              <span>⚠</span>
              <span>Not synced ({failedSyncCount})</span>
            </>
          ) : pendingSync > 0 ? (
            <>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/>
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
              </svg>
              <span>Syncing ({pendingSync})</span>
            </>
          ) : (
            <>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span>Synced</span>
            </>
          )}
        </button>

        <div className="language-toggle">
          <button className={`language-pill ${language === 'fr' ? 'active' : ''}`} onClick={() => handleLanguageToggle('fr')}>FR</button>
          <button className={`language-pill ${language === 'en' ? 'active' : ''}`} onClick={() => handleLanguageToggle('en')}>EN</button>
        </div>

        {/* ── Notification bell ── */}
        <div ref={notifRef} style={{ position: 'relative' }}>
          <button
            onClick={handleNotifBellClick}
            title="Notifications"
            style={{
              position: 'relative', background: 'none', border: 'none',
              cursor: 'pointer', padding: '4px 6px', borderRadius: 8,
              color: '#64748b', display: 'flex', alignItems: 'center',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {unreadCount > 0 && (
              <span style={{
                position: 'absolute', top: 0, right: 0,
                width: 16, height: 16, borderRadius: '50%',
                background: '#ef4444', color: '#fff',
                fontSize: 9, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                lineHeight: 1,
              }}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifPanel && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 8px)', right: 0,
              width: 320, maxHeight: 400, overflowY: 'auto',
              background: '#fff', border: '1px solid #e2e8f0',
              borderRadius: 12, boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
              zIndex: 1000,
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 16px', borderBottom: '1px solid #f1f5f9',
              }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>
                  Notifications {unreadCount > 0 && <span style={{ color: '#ef4444' }}>({unreadCount})</span>}
                </span>
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    style={{ background: 'none', border: 'none', fontSize: 11, color: '#1D9E75', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Mark all read
                  </button>
                )}
              </div>

              {notifications.length === 0 ? (
                <div style={{ padding: '24px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                  No notifications yet
                </div>
              ) : (
                notifications.map(n => (
                  <div
                    key={n.id}
                    onClick={() => !n.is_read && handleMarkRead(n.id)}
                    style={{
                      padding: '10px 16px',
                      borderBottom: '1px solid #f8fafc',
                      background: n.is_read ? '#fff' : '#f0fdf4',
                      cursor: n.is_read ? 'default' : 'pointer',
                      display: 'flex', gap: 10, alignItems: 'flex-start',
                    }}
                  >
                    <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{notifTypeIcon(n.type)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: n.is_read ? 500 : 700, color: '#1e293b', marginBottom: 2 }}>
                        {n.title}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4, wordBreak: 'break-word' }}>
                        {n.message}
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0, marginTop: 2 }}>
                      {fmtNotifTime(n.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="user-menu-wrapper" ref={menuRef}>
          {/* Role badge */}
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '3px 8px',
            borderRadius: 20, marginRight: 8,
            background: secretary ? '#ede9fe' : '#dbeafe',
            color: secretary ? '#7c3aed' : '#1d4ed8',
          }}>
            {secretary ? 'Secretary' : 'Doctor'}
          </span>

          {currentUser?.picture ? (
            <img
              src={currentUser.picture}
              alt={currentUser.name}
              className="doctor-avatar-img"
              onClick={handleAvatarClick}
              title={currentUser.name}
            />
          ) : (
            <div className="doctor-avatar" onClick={handleAvatarClick} title={currentUser?.name || settings?.doctor_name || 'Doctor'}>
              {getDoctorInitials()}
            </div>
          )}

          {showUserMenu && (
            <div className="user-dropdown">
              <div className="user-dropdown-info">
                <span className="user-dropdown-name">{currentUser?.name || settings?.doctor_name}</span>
                {currentUser?.email && <span className="user-dropdown-email">{currentUser.email}</span>}
              </div>
              <div className="user-dropdown-divider" />
              <button
                className="user-dropdown-logout"
                onClick={() => { setShowUserMenu(false); setShowClinicModal(true); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                  <polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
                Clinic Connection
              </button>
              <div className="user-dropdown-divider" />
              <button className="user-dropdown-logout" onClick={handleLogout}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                Log out
              </button>
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

export default TopBar;
