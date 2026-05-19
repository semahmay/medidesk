import React, { useState, useEffect, useMemo, useCallback } from 'react';
import cloudApi from '../cloudApi';
import NotesEditor from './NotesEditor';

const SortIcon = React.memo(({ col, sortKey, sortDir }) => {
  if (sortKey !== col) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>;
  return <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
});

const STATUS_OPTIONS = ['scheduled', 'arrived', 'in_consultation', 'completed', 'Active', 'Follow-up', 'Urgent', 'Closed'];

const DEFAULT_COLUMNS = [
  { key: 'full_name',   label: 'Name',        sortable: true,  width: '20%' },
  { key: 'phone',       label: 'Phone',        sortable: false, width: '15%' },
  { key: 'appointment', label: 'Appointment',  sortable: true,  width: '18%' },
  { key: 'status',      label: 'Status',       sortable: true,  width: '12%' },
  { key: 'notes',       label: 'Notes',        sortable: false, width: '25%' },
];

const PatientTable = React.memo(({ patients, onUpdatePatient, selectedPatient, onPatientSelect, onEditPatient, onDeletePatient, onColumnsChange, fetchPatients }) => {
  const [columns, setColumns] = useState([]);
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);
  const [notesEditorPatient, setNotesEditorPatient] = useState(null);
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc'); // 'asc' | 'desc'

  useEffect(() => {
    fetchColumns();
  }, []);

  const fetchColumns = async () => {
    try {
      const response = await cloudApi.get('/columns');
      setColumns(response.data.columns || []);
    } catch (error) {
      // Columns are optional — silently skip
    }
  };

  const handleDeleteColumn = async (columnId) => {
    const confirmed = window.confirm('Are you sure you want to delete this column? All data will be lost.');
    if (confirmed) {
      try {
        await cloudApi.delete(`/columns/${columnId}`);
        fetchColumns();
        if (onColumnsChange) onColumnsChange();
      } catch (error) {
        console.error('Error deleting column:', error);
        alert('Failed to delete column. Please try again.');
      }
    }
  };

  const handleNotesClick = (patient, e) => {
    e.stopPropagation();
    setNotesEditorPatient(patient);
  };

  const handleSort = useCallback((key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

  const sortedPatients = useMemo(() => {
    if (!sortKey) return patients;
    return [...patients].sort((a, b) => {
      const valA = (a[sortKey] || '').toString().toLowerCase();
      const valB = (b[sortKey] || '').toString().toLowerCase();
      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [patients, sortKey, sortDir]);

  const handleNotesEditorClose = () => {
    setNotesEditorPatient(null);
  };

  const handleNotesSaved = (patientId, newNotes) => {
    setNotesEditorPatient(null);
    
    // Update the specific patient's notes in the patients array
    if (fetchPatients) {
      fetchPatients();
    }
  };

  const truncateText = (text, maxLength = 50) => {
    if (!text) return '-';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  const customColumns = columns.filter(col => !col.is_default);

  return (
    <div className="patient-table-container">
      <table className="patient-table">
        <thead>
          <tr>
            {DEFAULT_COLUMNS.map(col => (
              <th
                key={col.key}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
                style={col.sortable ? { cursor: 'pointer', userSelect: 'none' } : {}}
                title={col.sortable ? `Sort by ${col.label}` : undefined}
              >
                {col.label}{col.sortable && <SortIcon col={col.key} sortKey={sortKey} sortDir={sortDir} />}
              </th>
            ))}
            {customColumns.map(col => (
              <th key={col.id} style={{ position: 'relative', paddingRight: 30 }}>
                {col.column_name}
                <button
                  style={s.delColBtn}
                  onClick={() => handleDeleteColumn(col.id)}
                  title="Delete column"
                >
                  ×
                </button>
              </th>
            ))}
            <th>
              Actions
              <button
                style={s.addColBtn}
                onClick={() => setShowAddColumnModal(true)}
                title="Add custom column"
              >
                +
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedPatients.map(patient => (
            <tr
              key={patient.global_id || `cloud_${patient.cloud_id}` || patient.id}
              className={selectedPatient && selectedPatient.id === patient.id ? 'selected' : ''}
              onClick={() => onPatientSelect(patient)}
            >
              <td style={{ width: '20%' }}>
                {patient.full_name}
                {patient._fromCloud && (
                  <span style={{
                    marginLeft: 6, fontSize: 9, fontWeight: 700,
                    padding: '1px 5px', borderRadius: 10,
                    background: '#dbeafe', color: '#1d4ed8',
                    verticalAlign: 'middle', letterSpacing: '0.3px',
                  }}>
                    SHARED
                  </span>
                )}
              </td>
              <td style={{ width: '15%' }}>{patient.phone || '-'}</td>
              <td style={{ width: '18%' }}>{patient.appointment || '-'}</td>
              <td style={{ width: '12%' }}>
                <select 
                  className={`status-badge status-${patient.status?.toLowerCase()}`}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', outline: 'none', fontWeight: 'bold' }}
                  value={patient.status}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const newStatus = e.target.value;
                    if (onUpdatePatient) {
                      onUpdatePatient(patient.id, { status: newStatus });
                    }
                  }}
                >
                  {STATUS_OPTIONS.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </td>
              <td 
                className="notes-cell"
                style={{ width: '25%' }}
                onClick={(e) => handleNotesClick(patient, e)}
                title="Click to edit notes"
              >
                {truncateText(patient.notes, 45)}
              </td>
              {customColumns.map(col => (
                <td key={col.id} style={{ width: '10%' }}>
                  {truncateText(patient[col.column_name], 45)}
                </td>
              ))}
              <td onClick={(e) => e.stopPropagation()} style={{ width: '10%' }}>
                <div className="action-buttons">
                  <button
                    className="btn-action"
                    onClick={() => onEditPatient(patient)}
                  >
                    Edit
                  </button>
                  <button
                    className="btn-action btn-danger"
                    onClick={() => onDeletePatient(patient.id)}
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      
      {patients.length === 0 && (
        <div className="empty-table">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.5">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <p>No patients yet</p>
          <p style={{ fontSize: 12, marginTop: 8 }}>Add your first patient to get started</p>
        </div>
      )}

      {showAddColumnModal && (
        <AddColumnModal
          onClose={() => setShowAddColumnModal(false)}
          onColumnAdded={() => {
            setShowAddColumnModal(false);
            fetchColumns();
            if (onColumnsChange) onColumnsChange();
          }}
        />
      )}

      {notesEditorPatient && (
        <NotesEditor
          patient={notesEditorPatient}
          onClose={handleNotesEditorClose}
          onSave={handleNotesSaved}
        />
      )}
    </div>
  );
});

const AddColumnModal = ({ onClose, onColumnAdded }) => {
  const [columnName, setColumnName] = useState('');
  const [columnType, setColumnType] = useState('text');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!columnName.trim()) return;

    setLoading(true);
    setError('');
    try {
      await cloudApi.post('/columns', {
        name: columnName.trim(),
        type: columnType
      });
      onColumnAdded();
    } catch (err) {
      console.error('Error adding column:', err);
      setError(err.response?.data?.error || 'Failed to add column. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={addS.backdrop} onClick={onClose}>
      <div style={addS.modal} onClick={e => e.stopPropagation()}>
        <div style={addS.header}>
          <div style={addS.headerIcon}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </div>
          <div>
            <h2 style={addS.title}>Add Custom Column</h2>
            <p style={addS.subtitle}>Add a new custom field to patient records</p>
          </div>
          <button style={addS.closeBtn} onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={addS.body}>
          <div style={addS.fieldGroup}>
            <label style={addS.label}>Column Name *</label>
            <input
              type="text"
              style={addS.input}
              value={columnName}
              onChange={(e) => {
                setColumnName(e.target.value);
                setError('');
              }}
              placeholder="e.g., Blood Type, Allergies"
              required
              autoFocus
            />
          </div>

          <div style={addS.fieldGroup}>
            <label style={addS.label}>Field Type</label>
            <select
              style={addS.input}
              value={columnType}
              onChange={(e) => setColumnType(e.target.value)}
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="boolean">Yes/No</option>
            </select>
          </div>

          {error && (
            <div style={addS.errorBox}>
              {error}
            </div>
          )}

          <div style={addS.footer}>
            <button type="button" style={addS.btnSecondary} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              style={{
                ...addS.btnPrimary,
                opacity: loading || !columnName.trim() ? 0.6 : 1,
                cursor: loading || !columnName.trim() ? 'not-allowed' : 'pointer',
              }}
              disabled={loading || !columnName.trim()}
            >
              {loading ? 'Adding...' : 'Add Column'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const s = {
  addColBtn: {
    background: '#1D9E75',
    color: 'white',
    border: 'none',
    borderRadius: 6,
    width: 22,
    height: 22,
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1,
    cursor: 'pointer',
    marginLeft: 8,
    verticalAlign: 'middle',
    transition: 'all 0.2s',
  },
  delColBtn: {
    position: 'absolute',
    right: 8,
    top: '50%',
    transform: 'translateY(-50%)',
    background: '#dc2626',
    color: 'white',
    border: 'none',
    borderRadius: '50%',
    width: 18,
    height: 18,
    fontSize: 12,
    lineHeight: 1,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
    padding: 0,
  },
};

const addS = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
  },
  modal: {
    background: '#fff', borderRadius: 14, width: 420,
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
  subtitle: { margin: 0, fontSize: 12, color: '#64748b' },
  closeBtn: {
    marginLeft: 'auto', background: 'none', border: 'none',
    fontSize: 16, color: '#94a3b8', cursor: 'pointer', padding: '4px 6px',
  },
  body:      { padding: '20px' },
  fieldGroup: { marginBottom: 16 },
  label: {
    display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b',
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6,
  },
  input: {
    width: '100%', height: 40, border: '1px solid #e2e8f0', borderRadius: 8,
    padding: '0 12px', fontSize: 14, outline: 'none', background: '#fff',
    fontFamily: 'inherit', transition: 'all 0.2s ease',
  },
  errorBox: {
    background: '#fef2f2', border: '1px solid #fecaca',
    borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#dc2626', marginBottom: 12,
  },
  footer: {
    display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end',
    paddingTop: 14, borderTop: '1px solid #e2e8f0', marginTop: 20,
  },
  btnSecondary: {
    padding: '8px 18px', border: '1px solid #e2e8f0', borderRadius: 8,
    background: '#fff', color: '#64748b', fontSize: 14, fontWeight: 500,
    cursor: 'pointer', transition: 'all 0.2s',
  },
  btnPrimary: {
    padding: '8px 20px', border: 'none', borderRadius: 8,
    background: '#1D9E75', color: '#fff', fontSize: 14, fontWeight: 600,
    boxShadow: '0 2px 8px rgba(29,158,117,0.3)',
    transition: 'all 0.2s',
  },
};

export default PatientTable;
