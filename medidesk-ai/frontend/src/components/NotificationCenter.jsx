import React, { useRef, useEffect, memo } from 'react';

const TYPE_CONFIG = {
  appointment: { icon: '📅', label: 'Appointment', color: '#1D9E75', bg: '#f0fdf4' },
  patient:     { icon: '👤', label: 'Patient',     color: '#2563eb', bg: '#eff6ff' },
  message:     { icon: '💬', label: 'Message',     color: '#7c3aed', bg: '#f5f3ff' },
  system:      { icon: '⚙️', label: 'System',      color: '#64748b', bg: '#f8fafc' },
};

function formatTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function isToday(iso) {
  if (!iso) return false;
  try {
    const d = new Date(iso);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  } catch {
    return false;
  }
}

const NotificationCenter = ({
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  onClose,
  soundEnabled,
  onToggleSound,
}) => {
  const panelRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const todayNotifs = notifications.filter(n => isToday(n.created_at));
  const earlierNotifs = notifications.filter(n => !isToday(n.created_at));

  const renderNotification = (n) => {
    const config = TYPE_CONFIG[n.type] || TYPE_CONFIG.system;
    const actorName = n.actor_name || '';
    const actorRole = n.actor_role || '';

    return (
      <div
        key={n.id}
        onClick={() => !n.is_read && onMarkRead(n.id)}
        style={{
          ...s.notifCard,
          background: n.is_read ? '#fff' : '#f0fdf4',
          cursor: n.is_read ? 'default' : 'pointer',
        }}
      >
        <div style={s.notifIconRow}>
          <div style={{
            ...s.notifIcon,
            background: config.bg,
          }}>
            <span style={{ fontSize: 14 }}>{config.icon}</span>
          </div>
          {!n.is_read && <div style={s.unreadDot} />}
        </div>
        <div style={s.notifContent}>
          <div style={s.notifHeader}>
            <span style={s.notifTitle}>{n.title}</span>
            <span style={s.notifTime}>{formatTime(n.created_at)}</span>
          </div>
          <div style={s.notifMessage}>{n.message}</div>
          <div style={s.notifMeta}>
            {actorName && (
              <span style={s.actorBadge}>
                {actorRole === 'doctor' ? (
                  <span style={{ ...s.rolePill, background: '#dbeafe', color: '#1d4ed8' }}>
                    Doctor
                  </span>
                ) : actorRole === 'secretary' ? (
                  <span style={{ ...s.rolePill, background: '#ede9fe', color: '#7c3aed' }}>
                    Secretary
                  </span>
                ) : null}
                <span style={s.actorName}>{actorName}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div ref={panelRef} style={s.panel}>
      {/* ── Header ── */}
      <div style={s.header}>
        <div>
          <span style={s.headerTitle}>Notifications</span>
          {unreadCount > 0 && (
            <span style={s.headerCount}>{unreadCount}</span>
          )}
        </div>
        <div style={s.headerActions}>
          {unreadCount > 0 && (
            <button style={s.headerActionBtn} onClick={onMarkAllRead}>
              Mark all read
            </button>
          )}
          <button
            style={s.headerActionBtn}
            onClick={() => onToggleSound()}
            title={soundEnabled ? 'Mute sounds' : 'Enable sounds'}
          >
            {soundEnabled ? '🔔' : '🔕'}
          </button>
        </div>
      </div>

      {/* ── List ── */}
      <div style={s.list}>
        {notifications.length === 0 ? (
          <div style={s.emptyState}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <div style={s.emptyText}>No notifications yet</div>
            <div style={s.emptySubtext}>Notifications from your team will appear here</div>
          </div>
        ) : (
          <>
            {todayNotifs.length > 0 && (
              <>
                <div style={s.groupLabel}>Today</div>
                {todayNotifs.map(renderNotification)}
              </>
            )}
            {earlierNotifs.length > 0 && (
              <>
                <div style={s.groupLabel}>Earlier</div>
                {earlierNotifs.map(renderNotification)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const s = {
  panel: {
    position: 'absolute', top: 'calc(100% + 8px)', right: 0,
    width: 380, maxHeight: 480,
    background: '#fff', border: '1px solid #e2e8f0',
    borderRadius: 14, boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
    zIndex: 1000, display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    backdropFilter: 'blur(8px)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 16px', borderBottom: '1px solid #f1f5f9',
    flexShrink: 0,
  },
  headerTitle: { fontWeight: 700, fontSize: 14, color: '#1e293b' },
  headerCount: {
    marginLeft: 6, fontSize: 11, fontWeight: 700,
    background: '#ef4444', color: '#fff',
    padding: '1px 7px', borderRadius: 20,
    verticalAlign: 'middle',
  },
  headerActions: { display: 'flex', gap: 8, alignItems: 'center' },
  headerActionBtn: {
    background: 'none', border: 'none', fontSize: 11,
    color: '#1D9E75', cursor: 'pointer', fontWeight: 600,
    padding: '4px 6px', borderRadius: 6,
    transition: 'background 0.15s',
  },
  list: {
    flex: 1, overflowY: 'auto', padding: '4px 0',
  },
  groupLabel: {
    fontSize: 11, fontWeight: 700, color: '#94a3b8',
    textTransform: 'uppercase', letterSpacing: '0.06em',
    padding: '10px 16px 4px',
  },
  notifCard: {
    display: 'flex', gap: 10, padding: '10px 16px',
    borderBottom: '1px solid #f8fafc',
    transition: 'background 0.15s',
  },
  notifIconRow: { position: 'relative', flexShrink: 0, marginTop: 2 },
  notifIcon: {
    width: 28, height: 28, borderRadius: 8,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  unreadDot: {
    position: 'absolute', top: -2, right: -2,
    width: 8, height: 8, borderRadius: '50%',
    background: '#1D9E75', border: '2px solid #fff',
  },
  notifContent: { flex: 1, minWidth: 0 },
  notifHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    gap: 8, marginBottom: 2,
  },
  notifTitle: {
    fontSize: 12, fontWeight: 600, color: '#1e293b',
    lineHeight: 1.3,
  },
  notifTime: {
    fontSize: 10, color: '#94a3b8', flexShrink: 0,
    marginTop: 1,
  },
  notifMessage: {
    fontSize: 11, color: '#64748b', lineHeight: 1.4,
    wordBreak: 'break-word', marginBottom: 4,
  },
  notifMeta: {
    display: 'flex', alignItems: 'center', gap: 6,
  },
  actorBadge: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
  },
  rolePill: {
    fontSize: 9, fontWeight: 700, padding: '1px 6px',
    borderRadius: 10, textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  actorName: {
    fontSize: 10, color: '#94a3b8',
  },
  emptyState: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 8, padding: '40px 24px', textAlign: 'center',
  },
  emptyText: {
    fontSize: 13, fontWeight: 600, color: '#94a3b8',
  },
  emptySubtext: {
    fontSize: 11, color: '#cbd5e1', lineHeight: 1.4,
  },
};

export default memo(NotificationCenter);
