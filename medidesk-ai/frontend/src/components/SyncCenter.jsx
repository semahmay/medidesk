/**
 * SyncCenter.jsx — Global Sync Status Panel
 *
 * Shows:
 *   - Overall sync health indicator
 *   - Pending operations (from offline queue)
 *   - Failed operations (from error queue) with retry/resolve actions
 *   - Last successful sync time
 *   - Out-of-sync patient list with badges
 */

import React, { useState, useEffect, useCallback } from 'react';
import { loadSyncQueueItems, subscribeSyncQueueUpdates } from '../services/patientSyncService';
import { loadApptQueueItems } from '../services/appointmentSyncService';
import { getSyncErrors, resolveSyncError, clearAllSyncErrors, subscribeSyncErrorChanges } from '../services/syncErrorQueue';

function timeAgo(ms) {
  if (!ms) return 'never';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function StatusDot({ color }) {
  return (
    <span style={{
      display: 'inline-block',
      width: 8, height: 8, borderRadius: '50%',
      background: color,
      marginRight: 6, flexShrink: 0,
    }} />
  );
}

function ErrorCodeBadge({ code }) {
  const map = {
    CONFLICT: { bg: '#fef2f2', color: '#991b1b', label: 'CONFLICT' },
    NETWORK:  { bg: '#fff7ed', color: '#9a3412', label: 'OFFLINE'  },
    SERVER:   { bg: '#faf5ff', color: '#6b21a8', label: 'SERVER'   },
    UNKNOWN:  { bg: '#f1f5f9', color: '#475569', label: 'UNKNOWN'  },
  };
  const s = map[code] || map.UNKNOWN;
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, padding: '2px 6px',
      borderRadius: 4, letterSpacing: '0.05em',
      background: s.bg, color: s.color,
    }}>
      {s.label}
    </span>
  );
}

export default function SyncCenter({ onClose, onRetryError, onOpenConflict, lastSyncMs }) {
  const [pendingItems, setPendingItems]   = useState([]);
  const [failedErrors, setFailedErrors]   = useState([]);
  const [loading, setLoading]             = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [patientQ, apptQ, errors] = await Promise.all([
        loadSyncQueueItems().catch(() => []),
        loadApptQueueItems().catch(() => []),
        getSyncErrors(),
      ]);
      const allPending = [...patientQ, ...apptQ]
        .filter(i => i.status !== 'failed' && (i.retryCount || 0) < 10);
      const allFailed  = errors.filter(e => !e.resolved);
      setPendingItems(allPending);
      setFailedErrors(allFailed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsubQueue = subscribeSyncQueueUpdates(refresh);
    const unsubErrors = subscribeSyncErrorChanges(refresh);
    return () => {
      unsubQueue?.();
      unsubErrors?.();
    };
  }, [refresh]);

  const handleDismissError = async (id) => {
    await resolveSyncError(id);
    setFailedErrors(prev => prev.filter(e => e.id !== id));
  };

  const handleClearAll = async () => {
    await clearAllSyncErrors();
    setFailedErrors([]);
  };

  const totalIssues = pendingItems.length + failedErrors.length;
  const healthColor = failedErrors.length > 0 ? '#dc2626' :
                      pendingItems.length > 0  ? '#f59e0b' : '#16a34a';
  const healthLabel = failedErrors.length > 0 ? 'Errors require attention' :
                      pendingItems.length > 0  ? `${pendingItems.length} operation(s) pending` :
                      'All data synced';

  return (
    <div style={styles.overlay} onClick={e => e.target === e.currentTarget && onClose?.()}>
      <div style={styles.panel}>

        {/* Header */}
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>🔄</span>
            <div>
              <div style={styles.title}>Sync Center</div>
              <div style={styles.subtitle}>Last sync: {timeAgo(lastSyncMs)}</div>
            </div>
          </div>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        {/* Health banner */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 20px',
          background: failedErrors.length > 0 ? '#fef2f2' :
                      pendingItems.length > 0  ? '#fffbeb' : '#f0fdf4',
          borderBottom: '1px solid #f1f5f9',
        }}>
          <StatusDot color={healthColor} />
          <span style={{ fontSize: 13, fontWeight: 600, color: healthColor }}>
            {healthLabel}
          </span>
          <button
            onClick={refresh}
            style={{ marginLeft: 'auto', fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontWeight: 600 }}
          >
            ↺ Refresh
          </button>
        </div>

        {loading ? (
          <div style={styles.emptyState}>Loading sync status…</div>
        ) : (
          <div style={styles.body}>

            {/* Pending operations */}
            <div style={styles.sectionTitle}>
              Pending Operations
              <span style={styles.badge(pendingItems.length > 0 ? '#f59e0b' : '#94a3b8')}>
                {pendingItems.length}
              </span>
            </div>

            {pendingItems.length === 0 ? (
              <div style={styles.emptySection}>No pending operations ✓</div>
            ) : (
              pendingItems.slice(0, 10).map((item, i) => (
                <div key={i} style={styles.item}>
                  <StatusDot color="#f59e0b" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                      {item.action?.toUpperCase()} — {item.patient?.full_name || item.data?.patient_name || 'Patient'}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                      Queued {timeAgo(item.timestamp)} · Retry #{item.retryCount || 0}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: '#fef9c3', color: '#854d0e' }}>
                    PENDING
                  </span>
                </div>
              ))
            )}

            {/* Failed operations */}
            <div style={{ ...styles.sectionTitle, marginTop: 20 }}>
              Failed Operations
              {failedErrors.length > 0 && (
                <button onClick={handleClearAll} style={styles.clearBtn}>
                  Clear all
                </button>
              )}
              <span style={styles.badge(failedErrors.length > 0 ? '#dc2626' : '#94a3b8')}>
                {failedErrors.length}
              </span>
            </div>

            {failedErrors.length === 0 ? (
              <div style={styles.emptySection}>No failed operations ✓</div>
            ) : (
              failedErrors.map(err => (
                <div key={err.id} style={{ ...styles.item, background: '#fef2f2', border: '1px solid #fecdd3' }}>
                  <StatusDot color="#dc2626" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#7f1d1d' }}>
                        {err.action?.toUpperCase()} — {err.patient?.full_name || 'Patient'}
                      </span>
                      <ErrorCodeBadge code={err.errorCode} />
                    </div>
                    <div style={{ fontSize: 11, color: '#991b1b', marginBottom: 4, wordBreak: 'break-word' }}>
                      {err.error}
                    </div>
                    <div style={{ fontSize: 10, color: '#b91c1c' }}>
                      Failed {timeAgo(err.timestamp)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
                    {err.errorCode === 'CONFLICT' && (
                      <button
                        onClick={() => onOpenConflict?.(err)}
                        style={styles.actionBtn('#1d4ed8', '#fff')}
                      >
                        Resolve
                      </button>
                    )}
                    {err.errorCode !== 'CONFLICT' && (
                      <button
                        onClick={() => onRetryError?.(err)}
                        style={styles.actionBtn('#15803d', '#fff')}
                      >
                        Retry
                      </button>
                    )}
                    <button
                      onClick={() => handleDismissError(err.id)}
                      style={styles.actionBtn('#e2e8f0', '#374151')}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))
            )}

          </div>
        )}

        {/* Footer */}
        <div style={styles.footer}>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>
            {totalIssues === 0 ? '✅ All systems nominal' : `⚠️ ${totalIssues} item(s) need attention`}
          </span>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(15,23,42,0.4)',
    zIndex: 50000,
    display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
    padding: '60px 16px 0 0',
  },
  panel: {
    background: '#fff',
    borderRadius: 14,
    width: 420,
    maxHeight: 'calc(90vh - 60px)',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid #f1f5f9',
  },
  title: { fontSize: 16, fontWeight: 800, color: '#1e293b' },
  subtitle: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 16, color: '#94a3b8', padding: 4,
  },
  body: { overflowY: 'auto', flex: 1, padding: '16px 20px' },
  sectionTitle: {
    fontSize: 11, fontWeight: 800, color: '#64748b',
    textTransform: 'uppercase', letterSpacing: '0.06em',
    marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6,
  },
  badge: (color) => ({
    marginLeft: 'auto',
    fontSize: 11, fontWeight: 700,
    padding: '1px 7px', borderRadius: 10,
    background: color, color: '#fff',
  }),
  clearBtn: {
    fontSize: 10, fontWeight: 600, color: '#94a3b8',
    background: 'none', border: 'none', cursor: 'pointer',
    padding: '2px 6px', marginLeft: 4,
  },
  item: {
    display: 'flex', alignItems: 'flex-start', gap: 10,
    padding: '10px 12px', borderRadius: 8,
    border: '1px solid #f1f5f9',
    marginBottom: 8,
    background: '#fafafa',
  },
  emptySection: {
    fontSize: 12, color: '#94a3b8',
    padding: '8px 12px', textAlign: 'center',
  },
  emptyState: {
    padding: 40, textAlign: 'center',
    color: '#94a3b8', fontSize: 13,
  },
  footer: {
    padding: '10px 20px',
    borderTop: '1px solid #f1f5f9',
    background: '#f8fafc',
  },
  actionBtn: (bg, color) => ({
    fontSize: 11, fontWeight: 700,
    padding: '4px 10px', borderRadius: 6,
    background: bg, color,
    border: 'none', cursor: 'pointer',
    whiteSpace: 'nowrap',
  }),
};
