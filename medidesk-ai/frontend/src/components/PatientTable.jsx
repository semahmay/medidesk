import React, { useState, useEffect, useMemo, useCallback } from 'react';
import cloudApi from '../cloudApi';
import NotesEditor from './NotesEditor';

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

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>;
    return <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

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

  const statusOptions = ['scheduled', 'arrived', 'in_consultation', 'completed', 'Active', 'Follow-up', 'Urgent', 'Closed'];
  
  const getStatusClass = (status) => {
    switch (status.toLowerCase()) {
      case 'active': return 'status-active';
      case 'follow-up': return 'status-followup';
      case 'urgent': return 'status-urgent';
      case 'closed': return 'status-closed';
      default: return 'status-active';
    }
  };

  const truncateText = (text, maxLength = 50) => {
    if (!text) return '-';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  const defaultColumns = [
    { key: 'full_name',   label: 'Name',        sortable: true,  width: '20%' },
    { key: 'phone',       label: 'Phone',        sortable: false, width: '15%' },
    { key: 'appointment', label: 'Appointment',  sortable: true,  width: '18%' },
    { key: 'status',      label: 'Status',       sortable: true,  width: '12%' },
    { key: 'notes',       label: 'Notes',        sortable: false, width: '25%' },
  ];

  const customColumns = columns.filter(col => !col.is_default);

  return (
    <div className="patient-table-container">
      <table className="patient-table">
        <thead>
          <tr>
            {defaultColumns.map(col => (
              <th
                key={col.key}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
                style={col.sortable ? { cursor: 'pointer', userSelect: 'none' } : {}}
                title={col.sortable ? `Sort by ${col.label}` : undefined}
              >
                {col.label}{col.sortable && <SortIcon col={col.key} />}
              </th>
            ))}
            {customColumns.map(col => (
              <th key={col.id} className="custom-column-header">
                {col.column_name}
                <button 
                  className="column-delete-btn"
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
                className="add-column-btn"
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
                  {statusOptions.map(s => (
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
    <div className="pf-overlay">
      <div className="pf-modal">
        <div className="pf-header">
          <h2>Add Custom Column</h2>
          <button className="pf-close-btn" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="pf-body">
          <div className="pf-group">
            <label className="pf-label">Column Name *</label>
            <input
              type="text"
              className="pf-input"
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

          <div className="pf-group">
            <label className="pf-label">Field Type</label>
            <select
              className="pf-select"
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
            <div className="pf-error">
              {error}
            </div>
          )}

          <div className="pf-actions">
            <button
              type="button"
              className="pf-btn-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="pf-btn-primary"
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

export default PatientTable;
