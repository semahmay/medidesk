import { useEffect } from 'react';

/**
 * ConfirmModal — replaces window.confirm() everywhere.
 *
 * Usage:
 *   <ConfirmModal
 *     open={showConfirm}
 *     title="Delete patient?"
 *     message="This cannot be undone."
 *     confirmLabel="Delete"
 *     confirmDanger={true}
 *     onConfirm={() => { doDelete(); setShowConfirm(false); }}
 *     onCancel={() => setShowConfirm(false)}
 *   />
 */

const ConfirmModal = ({
  open,
  title = 'Are you sure?',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmDanger = false,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div style={s.backdrop} onClick={onCancel}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <h3 style={s.title}>{title}</h3>
        {message && <p style={s.message}>{message}</p>}
        <div style={s.actions}>
          <button style={s.cancelBtn} onClick={onCancel}>{cancelLabel}</button>
          <button
            style={{ ...s.confirmBtn, background: confirmDanger ? '#dc2626' : '#1D9E75' }}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

const s = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
    backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 99998,
  },
  modal: {
    background: '#fff', borderRadius: 12, padding: '24px 28px',
    width: 360, boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
  },
  title:   { margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#1e293b' },
  message: { margin: '0 0 20px', fontSize: 14, color: '#475569', lineHeight: 1.5 },
  actions: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  cancelBtn: {
    padding: '8px 18px', background: '#f1f5f9', border: 'none',
    borderRadius: 7, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#475569',
  },
  confirmBtn: {
    padding: '8px 18px', border: 'none',
    borderRadius: 7, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#fff',
  },
};

export default ConfirmModal;
