import React, { useState, useEffect, useRef, useCallback } from 'react';

const TOAST_DURATION = 5000;
const TYPE_CONFIG = {
  appointment_created:  { icon: '📅', color: '#1D9E75', bg: '#f0fdf4' },
  appointment_updated:  { icon: '📅', color: '#2563eb', bg: '#eff6ff' },
  appointment_cancelled:{ icon: '📅', color: '#dc2626', bg: '#fef2f2' },
  patient:              { icon: '👤', color: '#1D9E75', bg: '#f0fdf4' },
  message:              { icon: '💬', color: '#7c3aed', bg: '#f5f3ff' },
  system:               { icon: '⚙️', color: '#64748b', bg: '#f8fafc' },
};

let _activeToasts = [];
let _toastListeners = [];

export function showNotificationToast(notification) {
  const id = notification.id || `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  _activeToasts = [..._activeToasts, { ...notification, id }];
  _toastListeners.forEach(fn => fn(_activeToasts));
  return id;
}

export function dismissNotificationToast(id) {
  _activeToasts = _activeToasts.filter(t => t.id !== id);
  _toastListeners.forEach(fn => fn(_activeToasts));
}

const NotificationToast = () => {
  const [toasts, setToasts] = useState([]);
  const [hoveredId, setHoveredId] = useState(null);
  const timersRef = useRef({});

  useEffect(() => {
    _toastListeners.push(setToasts);
    return () => {
      _toastListeners = _toastListeners.filter(fn => fn !== setToasts);
      Object.values(timersRef.current).forEach(clearTimeout);
    };
  }, []);

  const startTimer = useCallback((id) => {
    if (timersRef.current[id]) clearTimeout(timersRef.current[id]);
    timersRef.current[id] = setTimeout(() => {
      _activeToasts = _activeToasts.filter(t => t.id !== id);
      _toastListeners.forEach(fn => fn(_activeToasts));
    }, TOAST_DURATION);
  }, []);

  const clearTimer = useCallback((id) => {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
  }, []);

  useEffect(() => {
    toasts.forEach(t => {
      if (hoveredId === t.id) {
        clearTimer(t.id);
      } else {
        startTimer(t.id);
      }
    });
    return () => {
      Object.values(timersRef.current).forEach(clearTimeout);
    };
  }, [toasts, hoveredId, startTimer, clearTimer]);

  if (toasts.length === 0) return null;

  return (
    <>
      <div style={s.container}>
        {toasts.map((t, i) => {
          const config = TYPE_CONFIG[t.type] || TYPE_CONFIG.patient;
          return (
            <div
              key={t.id}
              onMouseEnter={() => setHoveredId(t.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => dismissNotificationToast(t.id)}
              style={{
                ...s.toast,
                background: config.bg,
                borderLeft: `3px solid ${config.color}`,
                animation: `slideInRight 0.35s cubic-bezier(0.16, 1, 0.3, 1)`,
                zIndex: 99999 - i,
                marginTop: i > 0 ? -20 : 0,
                transform: i > 0 ? `scale(${1 - i * 0.04})` : 'scale(1)',
                opacity: i > 0 ? 1 - i * 0.12 : 1,
                cursor: 'pointer',
              }}
            >
              <div style={s.toastRow}>
                <span style={s.toastIcon}>{config.icon}</span>
                <div style={s.toastContent}>
                  <div style={s.toastTitle}>{t.title}</div>
                  <div style={s.toastMessage}>{t.message}</div>
                </div>
                <button style={s.toastClose} onClick={(e) => { e.stopPropagation(); dismissNotificationToast(t.id); }}>
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes slideInRight {
          from {
            opacity: 0;
            transform: translateX(100%) scale(0.9);
          }
          to {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
        }
      `}</style>
    </>
  );
};

const s = {
  container: {
    position: 'fixed', top: 12, right: 12,
    display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
    zIndex: 99999, pointerEvents: 'none',
  },
  toast: {
    pointerEvents: 'auto',
    borderRadius: 10, padding: '10px 12px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
    maxWidth: 350, minWidth: 280,
    transition: 'all 0.2s',
  },
  toastRow: {
    display: 'flex', alignItems: 'flex-start', gap: 10,
  },
  toastIcon: { fontSize: 18, flexShrink: 0, marginTop: 1 },
  toastContent: { flex: 1, minWidth: 0 },
  toastTitle: {
    fontSize: 13, fontWeight: 700, color: '#1e293b',
    marginBottom: 2, lineHeight: 1.3,
  },
  toastMessage: {
    fontSize: 11, color: '#475569', lineHeight: 1.4,
    wordBreak: 'break-word',
  },
  toastClose: {
    background: 'none', border: 'none', color: '#94a3b8',
    cursor: 'pointer', fontSize: 12, padding: '2px 4px',
    flexShrink: 0, marginTop: 1,
  },
};

export default NotificationToast;
