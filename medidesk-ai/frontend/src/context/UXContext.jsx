/**
 * UXContext.jsx — Global UX state shared across all pages.
 *
 * Provides:
 *   - unreadChatCount / incrementUnread / clearUnread
 *   - toast: { message, type, onClick } | null
 *   - showToast(message, type, durationMs, onClick)
 *   - syncIssues / reportSyncIssue / clearSyncIssues
 *   - showSyncCenter / setShowSyncCenter — for Sync Center panel
 *   - conflictData / setConflictData — for merge modal
 */

import { createContext, useContext, useState, useCallback, useRef } from 'react';

const UXContext = createContext(null);

export function UXProvider({ children }) {
  const [unreadChatCount, setUnreadChatCount]   = useState(0);
  const [toast, setToast]                       = useState(null);
  const [syncIssues, setSyncIssues]             = useState([]);
  const [showSyncCenter, setShowSyncCenter]     = useState(false);
  const [conflictData, setConflictData]         = useState(null); // { local, cloud, onKeepLocal, onAcceptCloud, onManualMerge }
  const toastTimer  = useRef(null);

  const incrementUnread = useCallback((by = 1) => {
    setUnreadChatCount(prev => prev + by);
  }, []);

  const clearUnread = useCallback(() => {
    setUnreadChatCount(0);
  }, []);

  // ── Sync issues ───────────────────────────────────────────────────────────
  const reportSyncIssue = useCallback((issue) => {
    setSyncIssues(prev => {
      const id = issue.id ||
        `${issue.type}-${issue.patientId || issue.action || 'unknown'}-${issue.timestamp || Date.now()}`;
      const exists = prev.some(item => item.id === id);
      if (exists) return prev;
      return [{
        id,
        ...issue,
        timestamp: issue.timestamp || new Date().toISOString(),
      }, ...prev];
    });
  }, []);

  const clearSyncIssues = useCallback(() => {
    setSyncIssues([]);
  }, []);

  const removeSyncIssue = useCallback((id) => {
    setSyncIssues(prev => prev.filter(i => i.id !== id));
  }, []);

  // ── Toast (now supports onClick for clickable toasts) ─────────────────────
  /**
   * @param {string} message
   * @param {'success'|'error'|'info'|'warning'} type
   * @param {number} durationMs
   * @param {Function|null} onClick  — if set, toast is clickable
   */
  const showToast = useCallback((message, type = 'success', durationMs = 4000, onClick = null) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type, onClick });
    toastTimer.current = setTimeout(() => setToast(null), durationMs);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
  }, []);

  // ── Conflict modal ────────────────────────────────────────────────────────
  const openConflict = useCallback((data) => {
    setConflictData(data);
  }, []);

  const closeConflict = useCallback(() => {
    setConflictData(null);
  }, []);

  const value = {
    unreadChatCount, incrementUnread, clearUnread,
    syncIssues, reportSyncIssue, clearSyncIssues, removeSyncIssue,
    toast, showToast, dismissToast,
    showSyncCenter, setShowSyncCenter,
    conflictData, openConflict, closeConflict,
  };

  return (
    <UXContext.Provider value={value}>
      {children}

      {/* ── Global clickable toast ── */}
      {toast && (
        <div
          onClick={() => { if (toast.onClick) { toast.onClick(); dismissToast(); } }}
          style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            zIndex: 99999,
            background:
              toast.type === 'success' ? '#065f46' :
              toast.type === 'error'   ? '#991b1b' :
              toast.type === 'warning' ? '#92400e' : '#1e293b',
            color: '#fff',
            padding: '11px 20px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: '0 4px 24px rgba(0,0,0,0.28)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            animation: 'fadeInUp 0.22s ease',
            cursor: toast.onClick ? 'pointer' : 'default',
            maxWidth: 520,
            lineHeight: 1.4,
            userSelect: 'none',
          }}
          title={toast.onClick ? 'Click to resolve' : undefined}
        >
          <span style={{ flexShrink: 0 }}>
            {toast.type === 'success' && '✅'}
            {toast.type === 'error'   && '❌'}
            {toast.type === 'info'    && 'ℹ️'}
            {toast.type === 'warning' && '⚠️'}
          </span>
          <span style={{ flex: 1 }}>{toast.message}</span>
          {toast.onClick && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px',
              background: 'rgba(255,255,255,0.2)', borderRadius: 6,
              flexShrink: 0, marginLeft: 4,
            }}>
              Click to fix →
            </span>
          )}
        </div>
      )}

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateX(-50%) translateY(10px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </UXContext.Provider>
  );
}

export function useUX() {
  const ctx = useContext(UXContext);
  if (!ctx) throw new Error('useUX must be used inside UXProvider');
  return ctx;
}
