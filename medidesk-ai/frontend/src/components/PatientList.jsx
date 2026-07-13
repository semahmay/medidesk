import React, { useMemo, useEffect, useRef } from 'react';
import PatientTable from './PatientTable';
import { useLanguage } from '../context/LanguageContext';

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
  onUpdatePatient,
}) => {
  const searchInputRef = useRef(null);
  const { t } = useLanguage();

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

  const stats = useMemo(() => {
    const total    = patients.length;
    const active   = patients.filter(p => p.status === 'Active').length;
    const followUp = patients.filter(p => p.status === 'Follow-up').length;
    const urgent   = patients.filter(p => p.status === 'Urgent').length;
    return { total, active, followUp, urgent };
  }, [patients]);

  return (
    <div className="patient-list-pane">

      {/* ── Header ── */}
      <div className="patient-list-header">
        <div className="patient-list-title-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 className="page-title" style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{t('patients.title')}</h2>
            <span className="badge badge-primary">{stats.total}</span>
          </div>
          {onAddPatient && (
            <button className="pd-add-patient-btn" onClick={onAddPatient}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M19 8v6M22 11h-6"/>
              </svg>
              {t('patients.add')}
            </button>
          )}
        </div>

        {/* Search */}
        <div className="search-wrap" style={{ maxWidth: '100%', marginTop: 12 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: 16, height: 16, flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            placeholder={t('patients.search')}
            value={searchTerm}
            onChange={e => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      {/* ── Stat row ── */}
      <div className="patient-stat-row">
        <div className="patient-stat-item">
          <div className="patient-stat-num">{stats.total}</div>
          <div className="patient-stat-label">{t('patients.total')}</div>
        </div>
        <div className="patient-stat-item patient-stat-active">
          <div className="patient-stat-num">{stats.active}</div>
          <div className="patient-stat-label">{t('patients.active')}</div>
        </div>
        <div className="patient-stat-item patient-stat-followup">
          <div className="patient-stat-num">{stats.followUp}</div>
          <div className="patient-stat-label">{t('patients.followup')}</div>
        </div>
        <div className="patient-stat-item patient-stat-urgent">
          <div className="patient-stat-num">{stats.urgent}</div>
          <div className="patient-stat-label">{t('patients.urgent')}</div>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="patient-table-wrap">
        {loading ? (
          <div className="loading" style={{ padding: '60px 0' }}>
            <div className="spinner" />
          </div>
        ) : fetchError ? (
          <div className="banner" style={{ margin: '16px', background: 'var(--danger-100)', color: 'var(--danger-700)', borderRadius: 'var(--radius-sm)' }}>
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
        <div style={{ padding: '10px 16px' }}>
          <button className="btn btn-secondary" style={{ width: '100%' }} onClick={onLoadMore}>
            Load more
          </button>
        </div>
      )}
    </div>
  );
});

export default PatientList;
