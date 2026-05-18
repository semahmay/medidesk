import React, { useState, useMemo, useEffect, useRef } from 'react';
import PatientTable from './PatientTable';
import '../new-design.css';

const PatientList = React.memo(({ 
  patients, 
  selectedPatient, 
  onPatientSelect, 
  onEditPatient, 
  onDeletePatient, 
  onAddPatient, 
  onColumnsChange,
  searchTerm,
  onSearchChange,
  loading,
  fetchError,
  fetchPatients,
  onLoadMore,
  onUpdatePatient
}) => {
  const searchInputRef = useRef(null);

  // Auto-focus search on Ctrl+F / Cmd+F event
  useEffect(() => {
    const handleFocusSearch = () => {
      if (searchInputRef.current) {
        searchInputRef.current.focus();
        searchInputRef.current.select();
      }
    };
    window.addEventListener('focus-search', handleFocusSearch);
    return () => window.removeEventListener('focus-search', handleFocusSearch);
  }, []);
  // Memoize stats calculation to prevent unnecessary recalculations
  const stats = useMemo(() => {
    const total = patients.length;
    const active = patients.filter(p => p.status === 'Active').length;
    const followUp = patients.filter(p => p.status === 'Follow-up').length;
    const urgent = patients.filter(p => p.status === 'Urgent').length;
    return { total, active, followUp, urgent };
  }, [patients]);

  return (
    <div className="left-panel">
      {/* Header */}
      <div className="patient-list-header">
        <div className="patient-list-title-row">
          <div className="patient-list-title">
            <h2>Patients</h2>
            <span className="patient-count-badge">{stats.total}</span>
          </div>
          <button className="add-patient-btn" onClick={onAddPatient}>
            + Add patient
          </button>
        </div>

        {/* Search Bar */}
        <div className="search-bar">
          <svg className="search-icon" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            className="search-input"
            placeholder="Search patients..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      {/* Stats Bar */}
      <div className="stats-bar">
        <div className="stat-card">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Total</div>
        </div>
        <div className="stat-card active">
          <div className="stat-value">{stats.active}</div>
          <div className="stat-label">Active</div>
        </div>
        <div className="stat-card follow-up">
          <div className="stat-value">{stats.followUp}</div>
          <div className="stat-label">Follow-up</div>
        </div>
        <div className="stat-card urgent">
          <div className="stat-value">{stats.urgent}</div>
          <div className="stat-label">Urgent</div>
        </div>
      </div>

      {/* Patient Table */}
      <div className="patient-table-container">
        {loading ? (
          <div className="loading">
            <div className="spinner"></div>
          </div>
        ) : fetchError ? (
          <div style={{ padding: '20px 16px', color: '#991b1b', background: '#fee2e2', borderRadius: 6, margin: 12, fontSize: 13 }}>
            {fetchError}
          </div>
        ) : (
          <PatientTable
            patients={patients}
            selectedPatient={selectedPatient}
            onPatientSelect={onPatientSelect}
            onEditPatient={onEditPatient}
            onDeletePatient={onDeletePatient}
            onColumnsChange={onColumnsChange}
            fetchPatients={fetchPatients}
            onUpdatePatient={onUpdatePatient}
          />
        )}
      </div>
        {patients.length >= 50 && onLoadMore && (
          <button onClick={onLoadMore} className="btn btn-secondary" style={{ width: '100%', marginTop: '10px' }}>Load More</button>
        )}
    </div>
  );
});

export default PatientList;
