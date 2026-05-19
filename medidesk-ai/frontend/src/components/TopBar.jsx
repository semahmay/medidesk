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
import '../new-design.css';

const TopBar = ({ settings, currentUser, onLanguageChange }) => {
  const [language, setLanguage] = useState(settings?.language || 'en');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showClinicModal, setShowClinicModal] = useState(false);
  const [clinicInfo, setClinicInfo] = useState({ doctor_name: null, clinic_name: null });
  const [pendingSync, setPendingSync] = useState(0);
  const [failedSyncCount, setFailedSyncCount] = useState(0);
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [buildInfo, setBuildInfo] = useState(null);
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
  const { enabled: soundEnabled, toggleSound, playSound } = useNotificationSound();

  const fetchNotifs = useCallback(async () => {
    try {
      const res = await cloudApi.get('/notifications');
      setNotifications(res.data.notifications || []);
      setUnreadCount(res.data.unread_count || 0);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    // Load app version from Electron
    if (window.electronAPI?.getVersion) {
      window.electronAPI.getVersion().then(v => {
        if (v) setAppVersion(v);
      }).catch(() => {});
    }
    if (window.electronAPI?.getBuildInfo) {
      window.electronAPI.getBuildInfo().then(info => {
        if (info) setBuildInfo(info);
      }).catch(() => {});
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

    // Poll for notifications every 30 seconds (since SocketIO doesn't work in Electron)
    const notificationPoll = setInterval(fetchNotifs, 30000);

    const unsubQueue = subscribeSyncQueueUpdates(refreshCounts);
    const unsubErrors = subscribeSyncErrorChanges(refreshCounts);

    const unsubNotification = onRealtimeEvent('notification_new', (payload) => {
      const notif = {
        id: payload.id,
        type: payload.type,
        title: payload.title,
        message: payload.message,
        created_at: payload.created_at,
        actor_role: payload.actor_role,
        actor_name: payload.actor_name,
        is_read: false,
      };
      setNotifications(prev => [notif, ...prev]);
      setUnreadCount(prev => prev + 1);

      // Show toast
      showNotificationToast(notif);

      // Play sound for notifications from other users
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
      unsubQueue?.();
      unsubErrors?.();
      unsubNotification?.();
      unsubMessage?.();
    };
  }, [currentUser?.googleId, userRole, playSound, fetchNotifs]);

  // Close notification panel on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifPanel(false);
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowUserMenu(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Refresh notifications when window gains focus
  useEffect(() => {
    const handleFocus = async () => {
      try {
        const res = await cloudApi.get('/notifications');
        setNotifications(res.data.notifications || []);
        setUnreadCount(res.data.unread_count || 0);
      } catch {
        // non-critical
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  const handleLanguageToggle = useCallback((lang) => {
    setLanguage(lang);
    if (onLanguageChange) onLanguageChange(lang);
  }, [onLanguageChange]);

  const handleAvatarClick = (e) => {
    e.stopPropagation();
    setShowUserMenu(v => !v);
  };

  const handleNotifBellClick = useCallback((e) => {
    e.stopPropagation();
    setShowNotifPanel(v => !v);
  }, []);

  const handleMarkRead = useCallback(async (id) => {
    try {
      await cloudApi.patch(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch { /* non-critical */ }
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    try {
      await cloudApi.patch('/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch { /* non-critical */ }
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

  return (
    <>
    <NotificationToast />
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
        {/* ── Sync Center button ── */}
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
              transition: 'all 0.15s',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {unreadCount > 0 && (
              <span style={{
                position: 'absolute', top: 0, right: 0,
                minWidth: 16, height: 16, borderRadius: '50%',
                background: '#ef4444', color: '#fff',
                fontSize: 9, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                lineHeight: 1, padding: '0 3px',
              }}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifPanel && (
            <NotificationCenter
              notifications={notifications}
              unreadCount={unreadCount}
              onMarkRead={handleMarkRead}
              onMarkAllRead={handleMarkAllRead}
              onClose={() => setShowNotifPanel(false)}
              soundEnabled={soundEnabled}
              onToggleSound={toggleSound}
            />
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
              <div className="user-dropdown-divider" />
              <div style={{ padding: '8px 12px', fontSize: 11, color: '#64748b', textAlign: 'center' }}>
                v{appVersion}
                {buildInfo && <span> · {buildInfo.platform}</span>}
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
