/**
 * ConflictModal.jsx — Data Divergence Resolver
 *
 * Shown when a 409 conflict is detected between local and cloud patient data.
 * Displays a side-by-side diff and lets the user choose a resolution:
 *   1. Keep local  (force overwrite cloud)
 *   2. Accept cloud (pull cloud version into local)
 *   3. Manual merge (edit a combined text before saving)
 */

import React, { useState } from 'react';

const FIELD_LABELS = {
  full_name:   'Full Name',
  phone:       'Phone',
  email:       'Email',
  appointment: 'Appointment',
  status:      'Status',
  notes:       'Notes',
  updated_at:  'Last Updated',
};

const FIELDS = Object.keys(FIELD_LABELS);

function fmtTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function FieldRow({ label, local, cloud }) {
  const differs = (local || '') !== (cloud || '');
  return (
    <tr style={{ background: differs ? '#fff7ed' : 'transparent' }}>
      <td style={styles.labelCell}>{label}</td>
      <td style={{ ...styles.valueCell, color: differs ? '#7c2d12' : '#1e293b', fontWeight: differs ? 600 : 400 }}>
        {local || <em style={{ color: '#94a3b8' }}>empty</em>}
      </td>
      <td style={{ ...styles.valueCell, color: differs ? '#166534' : '#1e293b', fontWeight: differs ? 600 : 400 }}>
        {cloud || <em style={{ color: '#94a3b8' }}>empty</em>}
      </td>
    </tr>
  );
}

export default function ConflictModal({ data, onClose }) {
  const { local, cloud, onKeepLocal, onAcceptCloud, onManualMerge, patientName } = data || {};
  const [mode, setMode] = useState('compare'); // 'compare' | 'manual'
  const [manualNotes, setManualNotes] = useState(local?.notes || '');
  const [resolving, setResolving] = useState(false);

  if (!data) return null;

  const name = patientName || local?.full_name || cloud?.full_name || 'this patient';

  const handleKeepLocal = async () => {
    setResolving(true);
    await onKeepLocal?.();
    onClose?.();
  };

  const handleAcceptCloud = async () => {
    setResolving(true);
    await onAcceptCloud?.();
    onClose?.();
  };

  const handleManualSave = async () => {
    setResolving(true);
    await onManualMerge?.({ ...local, notes: manualNotes });
    onClose?.();
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <div style={styles.headerTitle}>⚡ Data Conflict Detected</div>
            <div style={styles.headerSub}>
              Two versions of <strong>{name}</strong> exist. Choose which version to keep.
            </div>
          </div>
          <button onClick={onClose} style={styles.closeBtn} title="Dismiss (conflict unresolved)">✕</button>
        </div>

        {mode === 'compare' ? (
          <>
            {/* Column headers */}
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.thField}>Field</th>
                    <th style={{ ...styles.thVersion, background: '#fef2f2', color: '#991b1b' }}>
                      🖥 Your Local Version
                      <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2 }}>
                        Edited: {fmtTime(local?.updated_at)}
                      </div>
                    </th>
                    <th style={{ ...styles.thVersion, background: '#f0fdf4', color: '#166534' }}>
                      ☁ Cloud Version
                      <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2 }}>
                        Edited: {fmtTime(cloud?.updated_at)}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {FIELDS.map(f => (
                    <FieldRow
                      key={f}
                      label={FIELD_LABELS[f]}
                      local={f === 'updated_at' ? fmtTime(local?.[f]) : local?.[f]}
                      cloud={f === 'updated_at' ? fmtTime(cloud?.[f]) : cloud?.[f]}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Actions */}
            <div style={styles.actions}>
              <button
                onClick={handleKeepLocal}
                disabled={resolving}
                style={{ ...styles.btn, background: '#7f1d1d', color: '#fff' }}
                title="Overwrite cloud with your local version"
              >
                {resolving ? '⏳ Saving…' : '🖥 Keep Local (Force Overwrite)'}
              </button>
              <button
                onClick={handleAcceptCloud}
                disabled={resolving}
                style={{ ...styles.btn, background: '#14532d', color: '#fff' }}
                title="Pull cloud version and discard local changes"
              >
                {resolving ? '⏳ Saving…' : '☁ Accept Cloud Version'}
              </button>
              <button
                onClick={() => setMode('manual')}
                disabled={resolving}
                style={{ ...styles.btn, background: '#1e293b', color: '#fff' }}
                title="Manually edit a merged result"
              >
                ✏ Manual Merge
              </button>
            </div>
          </>
        ) : (
          /* Manual merge editor */
          <div style={{ padding: '0 24px 20px' }}>
            <div style={{ fontSize: 13, color: '#475569', marginBottom: 10 }}>
              Edit the notes field below to create a merged version. All other fields will use your <strong>local</strong> values.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div>
                <div style={styles.mergeLabel}>🖥 Local Notes</div>
                <div style={styles.mergeBox}>{local?.notes || <em style={{ color: '#94a3b8' }}>empty</em>}</div>
              </div>
              <div>
                <div style={styles.mergeLabel}>☁ Cloud Notes</div>
                <div style={styles.mergeBox}>{cloud?.notes || <em style={{ color: '#94a3b8' }}>empty</em>}</div>
              </div>
            </div>

            <div style={styles.mergeLabel}>✏ Merged Notes (editable)</div>
            <textarea
              value={manualNotes}
              onChange={e => setManualNotes(e.target.value)}
              rows={6}
              style={styles.textarea}
              placeholder="Type merged content here…"
            />

            <div style={{ ...styles.actions, marginTop: 16 }}>
              <button onClick={() => setMode('compare')} style={{ ...styles.btn, background: '#e2e8f0', color: '#1e293b' }}>
                ← Back
              </button>
              <button onClick={handleManualSave} disabled={resolving} style={{ ...styles.btn, background: '#1d4ed8', color: '#fff' }}>
                {resolving ? '⏳ Saving…' : '💾 Save Merged Version'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(15,23,42,0.65)',
    zIndex: 100000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 20,
    backdropFilter: 'blur(3px)',
  },
  modal: {
    background: '#fff',
    borderRadius: 16,
    width: '100%',
    maxWidth: 820,
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '20px 24px 16px',
    borderBottom: '1px solid #f1f5f9',
    background: '#fff7ed',
  },
  headerTitle: {
    fontSize: 17, fontWeight: 800, color: '#7c2d12', marginBottom: 4,
  },
  headerSub: {
    fontSize: 13, color: '#92400e',
  },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 18, color: '#64748b', lineHeight: 1, padding: 4,
  },
  tableWrapper: {
    overflowY: 'auto',
    flex: 1,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  thField: {
    padding: '10px 14px',
    background: '#f8fafc',
    color: '#64748b',
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    textAlign: 'left',
    width: '18%',
    borderBottom: '1px solid #e2e8f0',
  },
  thVersion: {
    padding: '10px 14px',
    fontSize: 12,
    fontWeight: 700,
    textAlign: 'left',
    borderBottom: '1px solid #e2e8f0',
    width: '41%',
  },
  labelCell: {
    padding: '8px 14px',
    color: '#64748b',
    fontSize: 12,
    fontWeight: 600,
    verticalAlign: 'top',
    borderBottom: '1px solid #f1f5f9',
    whiteSpace: 'nowrap',
  },
  valueCell: {
    padding: '8px 14px',
    fontSize: 13,
    verticalAlign: 'top',
    borderBottom: '1px solid #f1f5f9',
    wordBreak: 'break-word',
    lineHeight: 1.5,
  },
  actions: {
    display: 'flex',
    gap: 10,
    padding: '16px 24px',
    borderTop: '1px solid #f1f5f9',
    flexWrap: 'wrap',
  },
  btn: {
    padding: '9px 18px',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: 13,
    transition: 'opacity 0.15s',
  },
  mergeLabel: {
    fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6,
  },
  mergeBox: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 13,
    color: '#1e293b',
    minHeight: 80,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },
  textarea: {
    width: '100%',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    padding: '10px 12px',
    fontSize: 13,
    fontFamily: 'inherit',
    resize: 'vertical',
    outline: 'none',
    lineHeight: 1.5,
    boxSizing: 'border-box',
  },
};
