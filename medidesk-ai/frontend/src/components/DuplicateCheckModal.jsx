import React from 'react';

const CONFIDENCE_CONFIG = {
  high:   { color: '#dc2626', bg: '#fef2f2', label: 'High' },
  medium: { color: '#d97706', bg: '#fffbeb', label: 'Medium' },
  low:    { color: '#64748b', bg: '#f1f5f9', label: 'Low' },
};

function calculateAge(birthDate) {
  if (!birthDate) return null;
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return null;
  }
}

const DuplicateCheckModal = ({ duplicates, onOpenExisting, onCreateAnyway, onClose }) => {
  if (!duplicates || duplicates.length === 0) return null;

  return (
    <div style={s.backdrop} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <div style={s.headerIcon}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div>
            <h2 style={s.title}>Possible duplicate patient found</h2>
            <p style={s.subtitle}>
              {duplicates.length === 1
                ? 'There is 1 patient that may already exist.'
                : `There are ${duplicates.length} patients that may already exist.`}
            </p>
          </div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={s.body}>
          {duplicates.map((item, i) => {
            const p = item.patient;
            const conf = CONFIDENCE_CONFIG[item.confidence] || CONFIDENCE_CONFIG.low;
            const age = calculateAge(p.birth_date);
            const lastVisit = formatDate(p.updated_at || p.created_at);

            return (
              <div
                key={p.global_id || p.id || i}
                style={s.card}
                onClick={() => onOpenExisting(p)}
              >
                <div style={s.cardTop}>
                  <div style={s.cardNameRow}>
                    <span style={s.patientIcon}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                        <circle cx="12" cy="7" r="4"/>
                      </svg>
                    </span>
                    <span style={s.patientName}>{p.full_name}</span>
                    <span style={{
                      ...s.confidenceBadge,
                      color: conf.color,
                      background: conf.bg,
                    }}>
                      {conf.label}
                    </span>
                  </div>
                  <div style={s.reason}>{item.reason}</div>
                </div>

                <div style={s.cardDetails}>
                  {p.phone && (
                    <div style={s.detailItem}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                      </svg>
                      <span style={s.detailText}>{p.phone}</span>
                    </div>
                  )}
                  {age !== null && (
                    <div style={s.detailItem}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                      </svg>
                      <span style={s.detailText}>{age} years</span>
                    </div>
                  )}
                  {lastVisit && (
                    <div style={s.detailItem}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/>
                        <line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                      <span style={s.detailText}>Last visit: {lastVisit}</span>
                    </div>
                  )}
                  {p.status && (
                    <div style={s.detailItem}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                      </svg>
                      <span style={s.detailText}>{p.status}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={s.footer}>
          <button style={s.btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button style={s.btnOutline} onClick={() => onOpenExisting(duplicates[0].patient)}>
            Open Existing
          </button>
          <button style={s.btnPrimary} onClick={onCreateAnyway}>
            Create Anyway
          </button>
        </div>
      </div>
    </div>
  );
};

const s = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999,
  },
  modal: {
    background: '#fff', borderRadius: 14, width: 500,
    maxHeight: '85vh', overflowY: 'auto',
    boxShadow: '0 12px 40px rgba(0,0,0,0.15)',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px',
    background: '#f8fafb', borderBottom: '1px solid #e2e8f0',
    position: 'sticky', top: 0, zIndex: 1,
  },
  headerIcon: {
    width: 34, height: 34, borderRadius: 8, background: '#1D9E75',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  title:    { margin: 0, fontSize: 15, fontWeight: 700, color: '#1a202c' },
  subtitle: { margin: '2px 0 0', fontSize: 12, color: '#64748b' },
  closeBtn: {
    marginLeft: 'auto', background: 'none', border: 'none',
    fontSize: 16, color: '#94a3b8', cursor: 'pointer', padding: '4px 6px',
  },
  body: { padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 10 },
  card: {
    border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px',
    cursor: 'pointer', transition: 'all 0.15s',
    background: '#fff',
  },
  cardTop: { marginBottom: 8 },
  cardNameRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 },
  patientIcon: {
    width: 28, height: 28, borderRadius: 7, background: '#f0fdf4',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  patientName: { fontSize: 14, fontWeight: 600, color: '#1e293b', flex: 1 },
  confidenceBadge: {
    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
    textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0,
  },
  reason: { fontSize: 12, color: '#64748b', marginLeft: 36 },
  cardDetails: {
    display: 'flex', flexWrap: 'wrap', gap: '6px 16px',
    marginLeft: 36,
  },
  detailItem: {
    display: 'flex', alignItems: 'center', gap: 4,
    fontSize: 12, color: '#64748b',
  },
  detailText: { color: '#475569' },
  footer: {
    display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end',
    padding: '14px 20px', borderTop: '1px solid #e2e8f0',
  },
  btnSecondary: {
    padding: '8px 18px', border: '1px solid #e2e8f0', borderRadius: 8,
    background: '#fff', color: '#64748b', fontSize: 13, fontWeight: 500,
    cursor: 'pointer', transition: 'all 0.2s',
  },
  btnOutline: {
    padding: '8px 18px', border: '1px solid #1D9E75', borderRadius: 8,
    background: '#fff', color: '#1D9E75', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', transition: 'all 0.2s',
  },
  btnPrimary: {
    padding: '8px 20px', border: 'none', borderRadius: 8,
    background: '#1D9E75', color: '#fff', fontSize: 13, fontWeight: 600,
    boxShadow: '0 2px 8px rgba(29,158,117,0.3)',
    cursor: 'pointer', transition: 'all 0.2s',
  },
};

export default DuplicateCheckModal;
