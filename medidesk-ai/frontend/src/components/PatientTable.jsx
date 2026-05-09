import React, { useState, useEffect } from 'react';
import api from '../api';
import NotesEditor from './NotesEditor';

const PatientTable = ({ patients, onUpdatePatient, selectedPatient, onPatientSelect, onEditPatient, onDeletePatient, onColumnsChange, fetchPatients }) => {
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
      const response = await api.get('/api/columns');
      setColumns(response.data.columns || []);
    } catch (error) {
      console.error('Error fetching columns:', error);
    }
  };

  const handleDeleteColumn = async (columnId) => {
    const confirmed = window.confirm('Are you sure you want to delete this column? All data will be lost.');
    if (confirmed) {
      try {
        console.log('Deleting column:', columnId);
        await api.delete(`/api/columns/${columnId}`);
        console.log('Column deleted successfully');
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

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedPatients = [...patients].sort((a, b) => {
    if (!sortKey) return 0;
    const valA = (a[sortKey] || '').toString().toLowerCase();
    const valB = (b[sortKey] || '').toString().toLowerCase();
    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

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
          <p>No patients found</p>
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
};

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
      await api.post('/api/columns', {
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
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>Add Custom Column</h2>
          <button className="btn btn-outline" onClick={onClose}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <label className="form-label">Column Name</label>
            <input
              type="text"
              className="form-input"
              value={columnName}
              onChange={(e) => {
                setColumnName(e.target.value);
                setError('');
              }}
              placeholder="Enter column name"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">Field Type</label>
            <select
              className="form-select"
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
            <div style={{
              padding: '8px 12px', background: '#fee2e2', border: '1px solid #fecaca',
              borderRadius: 6, color: '#991b1b', fontSize: 13,
            }}>
              {error}
            </div>
          )}
        </form>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={loading || !columnName.trim()}
          >
            {loading ? 'Adding...' : 'Add Column'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PatientTable;
