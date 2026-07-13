import React, { useEffect } from 'react';

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
    <div className="overlay open" onClick={onCancel}>
      <div className="modal" style={{ width: 380 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost" style={{ marginLeft: 'auto', padding: '0 6px', fontSize: 18 }} onClick={onCancel}>×</button>
        </div>
        <div className="modal-body">
          {message && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{message}</p>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button className={`btn ${confirmDanger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default React.memo(ConfirmModal);
