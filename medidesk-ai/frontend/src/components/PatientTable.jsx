import React, { useState, useEffect, useMemo, useCallback } from 'react';
import cloudApi from '../cloudApi';
import NotesEditor from './NotesEditor';
import ConfirmModal from './ConfirmModal';

const SortIcon = React.memo(({ col, sortKey, sortDir }) => {
  if (sortKey !== col) return <span style={{ opacity: 0.3, marginLeft: 4, fontSize: 10 }}>↕</span>;
  return <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--primary-600)' }}>{sortDir === 'asc' ? '▲' : '▼'}</span>;
});

const STATUS_OPTIONS = ['Active', 'Follow-up', 'Urgent', 'Closed', 'scheduled', 'arrived', 'in_consultation', 'completed'];

const DEFAULT_COLUMNS = [
  { key: 'full_name',   label: 'Name',        sortable: true,  width: '22%' },
  { key: 'phone',       label: 'Phone',       sortable: false, width: '14%' },
  { key: 'appointment', label: 'Appointment', sortable: true,  width: '16%' },
  { key: 'status',      label: 'Status',      sortable: true,  width: '13%' },
  { key: 'notes',       label: 'Notes',       sortable: false, width: '22%' },
];

const statusBadgeClass = (s) => {
  if (s === 'Active' || s === 'completed') return 'badge-success';
  if (s === 'Urgent') return 'badge-danger';
  if (s === 'Follow-up') return 'badge-warning';
  if (s === 'scheduled' || s === 'arrived' || s === 'in_consultation') return 'badge-info';
  return 'badge-neutral';
};

const PatientTable = React.memo(({
  patients,
  onUpdatePatient,
  selectedPatient,
  onPatientSelect,
  onEditPatient,
  onDeletePatient,
  onColumnsChange,
  fetchPatients,
}) => {
  const [columns, setColumns]                     = useState([]);
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);
  const [notesEditorPatient, setNotesEditorPatient] = useState(null);
  const [sortKey, setSortKey]                     = useState(null);
  const [sortDir, setSortDir]                     = useState('asc');
  const [deleteColumnConfirm, setDeleteColumnConfirm] = useState(null);

  useEffect(() => { fetchCustomColumns(); }, []);

  const fetchCustomColumns = async () => {
    try {
      const res = await cloudApi.get('/columns');
      setColumns(res.data.columns || []);
    } catch { /* optional */ }
  };

  const handleDeleteColumn = (id) => setDeleteColumnConfirm(id);

  const confirmDeleteColumn = async (id) => {
    try {
      await cloudApi.delete(`/columns/${id}`);
      fetchCustomColumns();
      if (onColumnsChange) onColumnsChange();
    } catch { alert('Failed to delete column.'); }
    finally { setDeleteColumnConfirm(null); }
  };

  const handleNotesClick = (patient, e) => {
    e.stopPropagation();
    setNotesEditorPatient(patient);
  };

  const handleSort = useCallback((key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }, [sortKey]);

  const sortedPatients = useMemo(() => {
    if (!sortKey) return patients;
    return [...patients].sort((a, b) => {
      const va = (a[sortKey] || '').toString().toLowerCase();
      const vb = (b[sortKey] || '').toString().toLowerCase();
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }, [patients, sortKey, sortDir]);

  const truncate = (txt, max = 45) => {
    if (!txt) return '—';
    return txt.length > max ? txt.slice(0, max) + '…' : txt;
  };

  const customColumns = columns.filter(c => !c.is_default);

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {DEFAULT_COLUMNS.map(col => (
              <th
                key={col.key}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
                style={{
                  width: col.width,
                  cursor: col.sortable ? 'pointer' : 'default',
                  userSelect: 'none',
                  textAlign: 'left',
                  padding: '10px 14px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--text-secondary)',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--bg-surface-alt)',
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                  whiteSpace: 'nowrap',
                }}
              >
                {col.label}
                {col.sortable && <SortIcon col={col.key} sortKey={sortKey} sortDir={sortDir} />}
              </th>
            ))}
            {customColumns.map(col => (
              <th key={col.id} style={{
                padding: '10px 14px', fontSize: '11.5px', fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.04em',
                color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)',
                background: 'var(--bg-surface-alt)', position: 'sticky', top: 0, zIndex: 2,
                whiteSpace: 'nowrap', paddingRight: 32,
              }}>
                {col.column_name}
                <button
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-600)', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
                  onClick={() => handleDeleteColumn(col.id)}
                  title="Delete column"
                >×</button>
              </th>
            ))}
            <th style={{
              padding: '10px 14px', fontSize: '11.5px', fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.04em',
              color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)',
              background: 'var(--bg-surface-alt)', position: 'sticky', top: 0, zIndex: 2,
              whiteSpace: 'nowrap',
            }}>
              Actions
              <button
                style={{ marginLeft: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-600)', fontSize: 15, fontWeight: 700, padding: '0 4px', lineHeight: 1, verticalAlign: 'middle' }}
                onClick={() => setShowAddColumnModal(true)}
                title="Add custom column"
              >+</button>
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedPatients.map(patient => {
            const isSelected = selectedPatient && selectedPatient.id === patient.id;
            return (
              <tr
                key={patient.global_id || patient.cloud_id || patient.id}
                onClick={() => onPatientSelect(patient)}
                style={{
                  cursor: 'pointer',
                  background: isSelected ? 'var(--primary-50)' : 'var(--bg-surface)',
                  transition: 'background 0.1s',
                  borderLeft: isSelected ? '3px solid var(--primary-600)' : '3px solid transparent',
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-surface)'; }}
              >
                {/* Name */}
                <td style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                      background: 'var(--primary-100)', color: 'var(--primary-700)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700,
                    }}>
                      {(patient.full_name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>{patient.full_name}</div>
                      {patient._fromCloud && (
                        <span className="badge badge-info" style={{ fontSize: 10, padding: '1px 6px', marginTop: 2, display: 'inline-flex' }}>SHARED</span>
                      )}
                    </div>
                  </div>
                </td>

                {/* Phone */}
                <td style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {patient.phone || '—'}
                </td>

                {/* Appointment */}
                <td style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {patient.appointment || '—'}
                </td>

                {/* Status */}
                <td style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle' }} onClick={e => e.stopPropagation()}>
                  <select
                    className={`badge ${statusBadgeClass(patient.status)}`}
                    style={{ border: 'none', cursor: 'pointer', outline: 'none', fontWeight: 600, WebkitAppearance: 'none', MozAppearance: 'none', appearance: 'none', paddingRight: 4, background: 'inherit' }}
                    value={patient.status || 'Active'}
                    onChange={e => onUpdatePatient && onUpdatePatient(patient.id, { status: e.target.value })}
                  >
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>

                {/* Notes */}
                <td
                  style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle', color: 'var(--text-secondary)', cursor: 'pointer', maxWidth: 200 }}
                  onClick={e => handleNotesClick(patient, e)}
                  title="Click to edit notes"
                >
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {truncate(patient.notes)}
                  </span>
                </td>

                {/* Custom columns */}
                {customColumns.map(col => (
                  <td key={col.id} style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle', color: 'var(--text-secondary)', fontSize: 12 }}>
                    {truncate(patient.custom_fields?.[col.column_name])}
                  </td>
                ))}

                {/* Actions */}
                <td style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle' }} onClick={e => e.stopPropagation()}>
                  <div className="pt-row-actions">
                    {/* Edit */}
                    <button
                      className="pt-icon-btn pt-icon-btn--edit"
                      onClick={() => onEditPatient(patient)}
                      title="Edit patient"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                    {/* Delete */}
                    <button
                      className="pt-icon-btn pt-icon-btn--delete"
                      onClick={() => onDeletePatient(patient.id)}
                      title="Delete patient"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                        <path d="M10 11v6M14 11v6"/>
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {patients.length === 0 && (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: 10, opacity: 0.4 }}>
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No patients yet</div>
          <div style={{ fontSize: 12 }}>Add your first patient to get started</div>
        </div>
      )}

      {/* Add Column Modal */}
      {showAddColumnModal && (
        <AddColumnModal
          onClose={() => setShowAddColumnModal(false)}
          onColumnAdded={() => { setShowAddColumnModal(false); fetchCustomColumns(); if (onColumnsChange) onColumnsChange(); }}
        />
      )}

      {/* Notes Editor */}
      {notesEditorPatient && (
        <NotesEditor
          patient={notesEditorPatient}
          onClose={() => setNotesEditorPatient(null)}
          onSave={() => { setNotesEditorPatient(null); if (fetchPatients) fetchPatients(); }}
        />
      )}

      {/* Delete Column Confirm */}
      <ConfirmModal
        open={deleteColumnConfirm !== null}
        title="Delete column?"
        message="Are you sure? All data in this column will be lost."
        confirmLabel="Delete"
        confirmDanger
        onConfirm={() => confirmDeleteColumn(deleteColumnConfirm)}
        onCancel={() => setDeleteColumnConfirm(null)}
      />
    </div>
  );
});

/* ── Add Column Modal ── */
const AddColumnModal = ({ onClose, onColumnAdded }) => {
  const [columnName, setColumnName] = useState('');
  const [columnType, setColumnType] = useState('text');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!columnName.trim()) return;
    setLoading(true); setError('');
    try {
      await cloudApi.post('/columns', { name: columnName.trim(), type: columnType });
      onColumnAdded();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add column.');
    } finally { setLoading(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,16,14,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }} onClick={onClose}>
      <div className="modal wide" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--primary-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          </div>
          <h3>Add Custom Column</h3>
          <button className="btn btn-ghost" style={{ marginLeft: 'auto', padding: '4px 8px' }} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="field">
              <label>Column Name</label>
              <input type="text" value={columnName} onChange={e => { setColumnName(e.target.value); setError(''); }} placeholder="e.g., Blood Type, Allergies" required autoFocus />
            </div>
            <div className="field">
              <label>Field Type</label>
              <select value={columnType} onChange={e => setColumnType(e.target.value)}>
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="boolean">Yes/No</option>
              </select>
            </div>
            {error && <div style={{ background: 'var(--danger-100)', color: 'var(--danger-700)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>{error}</div>}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading || !columnName.trim()} style={{ opacity: loading || !columnName.trim() ? 0.6 : 1 }}>
              {loading ? 'Adding…' : 'Add Column'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PatientTable;
