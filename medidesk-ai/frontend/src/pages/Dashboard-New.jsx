import React, { useState, useEffect, useRef, useCallback } from 'react';
import cloudApi, { onRealtimeEvent } from '../cloudApi';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
import PatientList from '../components/PatientList';
import PatientDetail from '../components/PatientDetail';
import PatientForm from '../components/PatientForm';
import { getSession } from '../hooks/useClinicSession';
import { isSecretary } from '../utils/roleUtils';
import { fetchCloudPatients, replayQueue, loadSyncQueueItems, updateCloudPatient, deleteCloudPatient } from '../services/patientSyncService';
import { loadApptQueueItems } from '../services/appointmentSyncService';
import { useUX } from '../context/UXContext';
import '../new-design.css';
import '../modal.css';

const Dashboard = ({ settings, currentUser }) => {
  const { userRole, clinicId } = getSession();
  const secretary = isSecretary(userRole);
  const { incrementUnread, showToast, reportSyncIssue, syncIssues, clearSyncIssues, openConflict, setShowSyncCenter } = useUX();
  const lastMsgIdRef = useRef(null);
  const [patients, setPatients] = useState([]);
  const [page, setPage] = useState(1);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [showPatientForm, setShowPatientForm] = useState(false);
  const [editingPatient, setEditingPatient] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [columns, setColumns] = useState([]);
  const [language, setLanguage] = useState(settings?.language || 'en');
  const [fetchError, setFetchError] = useState('');
  const [cloudOffline, setCloudOffline] = useState(false);
  const [syncWarning, setSyncWarning] = useState(''); // non-empty = pending items after replay
  // Secretary: cache last known cloud patients in memory so offline shows stale data
  const cachedCloudPatients = useRef([]);

  // Horizontal split — leftWidth is % of content area
  const [leftWidth, setLeftWidth] = useState(40);
  const isDragging = useRef(false);
  const contentRef = useRef(null);

  const onDividerMouseDown = useCallback((e) => {
    e.preventDefault();
    isDragging.current = true;
    const onMove = (ev) => {
      if (!isDragging.current || !contentRef.current) return;
      const rect = contentRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setLeftWidth(Math.min(70, Math.max(20, pct)));
    };
    const onUp = () => {
      isDragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const loadFailedSyncIssues = async () => {
    try {
      const patientQueue = await loadSyncQueueItems().catch(err => { console.warn('[sync] loadSyncQueueItems failed', err); return []; });
      const apptQueue = await loadApptQueueItems().catch(err => { console.warn('[sync] loadApptQueueItems failed', err); return []; });
      const failedItems = [...patientQueue, ...apptQueue]
        .filter(item => item.status === 'failed' || item.retryCount >= 10)
        .map(item => ({
          id: item.id || `${item.action}-${item.patient?.global_id || item.patient?.cloud_id || item.data?.cloud_id || 'unknown'}`,
          type: item.action,
          message: item.status === 'failed'
            ? `Failed to sync ${item.action} action for ${item.patient?.full_name || item.data?.patient_name || 'record'}`
            : `Pending sync issue on ${item.action}`,
          patientId: item.patient?.id || item.data?.id || null,
          raw: item,
          timestamp: item.lastAttemptAt ? new Date(item.lastAttemptAt).toISOString() : new Date().toISOString(),
        }));
      failedItems.forEach(reportSyncIssue);
    } catch (e) {
      console.warn('[sync] could not load failed queue items', e);
    }
  };

  useEffect(() => {
    // Reset all state when user changes — prevents stale data from previous login
    setPatients([]);
    setSelectedPatient(null);
    setSearchTerm('');
    setDebouncedSearch('');
    setColumns([]);
    setLoading(true);

    fetchPatients();
    fetchColumns();
    loadFailedSyncIssues();
    // Replay any edits that were queued while cloud was offline
    const replayAndRefresh = async () => {
      const { replayed, failed } = await replayQueue().catch(err => { console.warn('[sync] replayQueue failed', err); return { replayed: 0, failed: 0 }; });
      if (replayed > 0) fetchPatients();
      if (failed > 0) setSyncWarning(`${failed} patient edit(s) couldn't sync to cloud yet. They'll retry automatically.`);
      else setSyncWarning('');
      loadFailedSyncIssues();
    };
    replayAndRefresh();

    const handleOnline = () => {
      console.log('[sync] Network restored — replaying offline queue');
      replayAndRefresh();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [currentUser?.googleId]); // re-run when user switches

  // ── Real-time chat updates — replace polling with WebSocket events.
  useEffect(() => {
    const unsub = onRealtimeEvent('message_new', (payload) => {
      if (!window.location.pathname.includes('clinic-chat')) {
        incrementUnread(1);
      }
      lastMsgIdRef.current = payload.id;
    });
    return () => unsub?.();
  }, [incrementUnread]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      if (searchTerm !== debouncedSearch) {
        setPage(1);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, debouncedSearch]);

  useEffect(() => {
    if (currentUser?.googleId) {
      fetchPatients();
    }
  }, [debouncedSearch, page]);

  const fetchPatients = async () => {
    try {
      // Both roles: cloud is the single source of truth
      const cloud = await fetchCloudPatients(page, 50, debouncedSearch);
      if (cloud === null) {
        setCloudOffline(true);
        if (secretary && cachedCloudPatients.current.length === 0 && clinicId) {
          const diskCache = await window.electronAPI?.loadPatientCache?.(clinicId) || [];
          cachedCloudPatients.current = diskCache;
        }
        setPatients(cachedCloudPatients.current);
      } else {
        setCloudOffline(false);
        if (page > 1) {
          cachedCloudPatients.current = [...cachedCloudPatients.current, ...cloud];
          setPatients(prev => [...prev, ...cloud]);
        } else {
          cachedCloudPatients.current = cloud;
          setPatients(cloud);
        }
        if (clinicId) {
          window.electronAPI?.savePatientCache?.({ clinicId, patients: cloud });
        }
      }
      setFetchError('');
    } catch (error) {
      console.error('Error fetching patients:', error);
      setFetchError('Failed to load patients. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const fetchColumns = async () => {
    // Custom columns are stored in cloud — skip for secretary (no column management)
    if (secretary) return;
    try {
      const response = await cloudApi.get('/columns');
      setColumns(response.data.columns || []);
    } catch (error) {
      // Silently skip if not available
    }
  };

  const handlePatientSelect = async (patient) => {
    // Cloud is the only source — use the patient data directly
    setSelectedPatient(patient);
  };

  const handleAddPatient = () => {
    setEditingPatient(null);
    setShowPatientForm(true);
  };

  const handleUpdatePatient = async (patientId, updates) => {
    try {
      const patient = patients.find(p => p.id === patientId || p.global_id === patientId);
      if (!patient) return;

      const cloudResult = await updateCloudPatient({ ...patient, ...updates });

      if (!cloudResult.ok) {
        if (cloudResult.conflict) {
          const localVersion = { ...patient, ...updates };
          const cloudVersion = cloudResult.cloudVersion || null;
          showToast(
            `⚠️ Conflict on ${patient.full_name || 'patient'} — another user changed this record. Click to resolve.`,
            'error', 10000,
            () => openConflict({
              local: localVersion,
              cloud: cloudVersion,
              patientName: patient.full_name,
              onKeepLocal: async () => {
                try {
                  const forcePayload = { ...localVersion, updated_at: new Date().toISOString() };
                  if (patient.global_id) {
                    await cloudApi.put(`/patients/by-global/${patient.global_id}`, { ...forcePayload, force: true });
                  } else {
                    await cloudApi.put(`/patients/${patient.id}`, { ...forcePayload, force: true });
                  }
                  showToast('✅ Local version saved to cloud.', 'success', 4000);
                } catch (e) {
                  showToast('Force overwrite failed: ' + (e?.message || ''), 'error', 6000);
                }
              },
              onAcceptCloud: async () => {
                await fetchPatients();
                showToast('✅ Cloud version loaded.', 'success', 4000);
              },
              onManualMerge: async (mergedData) => {
                try {
                  const mergePayload = { ...mergedData, updated_at: new Date().toISOString() };
                  if (patient.global_id) {
                    await cloudApi.put(`/patients/by-global/${patient.global_id}`, { ...mergePayload, force: true });
                  } else {
                    await cloudApi.put(`/patients/${patient.id}`, { ...mergePayload, force: true });
                  }
                  await fetchPatients();
                  showToast('✅ Merged version saved.', 'success', 4000);
                } catch (e) {
                  showToast('Merge save failed: ' + (e?.message || ''), 'error', 6000);
                }
              },
            })
          );
          reportSyncIssue({ type: 'conflict', action: 'update', message: `Conflict saving ${patient.full_name || 'patient'}.`, patientId });
          await fetchPatients();
        } else {
          showToast(`⚠️ Update queued — cloud sync failed. Will retry automatically.`, 'warning', 8000, () => setShowSyncCenter(true));
          reportSyncIssue({ type: 'sync', action: 'update', message: `Cloud sync failed for ${patient.full_name || patientId}.`, patientId });
        }
      }
      setPatients(prev => prev.map(p => (p.id === patientId || p.global_id === patientId) ? { ...p, ...updates } : p));
    } catch (e) {
      console.error(e);
      showToast('Failed to update patient. Please try again.', 'error', 6000);
    }
  };

  const handleEditPatient = (patient) => {
    setEditingPatient(patient);
    setShowPatientForm(true);
  };

  const handleDeletePatient = async (patientId) => {
    if (window.confirm('Are you sure you want to delete this patient?')) {
      const patient = patients.find(p => p.id === patientId || p.global_id === patientId);
      try {
        await deleteCloudPatient(patient || { id: patientId });
        fetchPatients();
        if (selectedPatient && (selectedPatient.id === patientId || selectedPatient.global_id === patientId)) {
          setSelectedPatient(null);
        }
      } catch (error) {
        console.error('Error deleting patient:', error);
        showToast('Failed to delete patient.', 'error', 4000);
      }
    }
  };

  const handlePatientFormClose = () => {
    setShowPatientForm(false);
    setEditingPatient(null);
  };

  const handlePatientSaved = () => {
    fetchPatients();
    handlePatientFormClose();
  };

  const handleColumnsChange = () => {
    fetchColumns();
    fetchPatients();
    if (selectedPatient) {
      handlePatientSelect(selectedPatient);
    }
  };

  const handleLanguageChange = (lang) => {
    setLanguage(lang);
    // Future: Add language change logic
  };

  const handleNotesClick = (patient) => {
    // This will be handled by PatientDetail component
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <Sidebar activePage="patients" />

      {/* Main Content */}
      <div className="main-content">
        {/* Top Bar */}
        <TopBar settings={settings} currentUser={currentUser} onLanguageChange={handleLanguageChange} />

        {/* Secretary banner */}
        {secretary && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            margin: '12px 16px 0',
            padding: '10px 16px',
            background: '#f5f3ff',
            border: '1px solid #ddd6fe',
            borderRadius: 8,
            fontSize: 13,
            color: '#5b21b6',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            Secretary Dashboard — Manage patients, appointments, and assist your doctor.
          </div>
        )}

        {/* Cloud offline warning — full width, high contrast */}
        {cloudOffline && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            margin: '0', padding: '10px 20px',
            background: '#92400e', color: '#fff',
            fontSize: 13, fontWeight: 600,
            borderBottom: '2px solid #78350f',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {secretary
              ? '⚠ Offline — showing cached data. Adding patients is disabled until you reconnect.'
              : '⚠ Cloud sync unavailable — showing local patients only. Edits will sync when reconnected.'}
          </div>
        )}

        {/* Sync queue warning — shown when offline edits failed to replay */}
        {syncWarning && !cloudOffline && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            margin: '8px 16px 0',
            padding: '8px 14px',
            background: '#fff7ed',
            border: '1px solid #fed7aa',
            borderRadius: 8,
            fontSize: 12,
            color: '#9a3412',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            {syncWarning}
          </div>
        )}

        {syncIssues && syncIssues.length > 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 10,
            margin: '8px 16px 0', padding: '12px 14px',
            background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 8,
            color: '#991b1b', fontSize: 13,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div>
                <strong>⚠️ Sync Issues Detected</strong>
                <div style={{ marginTop: 4, color: '#7f1d1d' }}>
                  Some cloud updates could not be persisted. Please review or reload affected records.
                </div>
              </div>
              <button
                onClick={() => clearSyncIssues()}
                style={{ background: '#fff', border: '1px solid #fca5a5', borderRadius: 6, padding: '6px 12px', color: '#991b1b', cursor: 'pointer' }}
              >
                Clear
              </button>
            </div>
            {syncIssues.slice(0, 3).map(issue => (
              <div key={issue.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{issue.message}</div>
                  <div style={{ fontSize: 12, color: '#7f1d1d' }}>{issue.timestamp ? new Date(issue.timestamp).toLocaleString() : ''}</div>
                </div>
                {issue.patientId && (
                  <button
                    onClick={() => handlePatientSelect({ id: issue.patientId })}
                    style={{ background: '#fee2e2', border: '1px solid #fecdd3', borderRadius: 6, padding: '6px 10px', color: '#991b1b', cursor: 'pointer', fontSize: 12 }}
                  >
                    Reload
                  </button>
                )}
              </div>
            ))}
            {syncIssues.length > 3 && (
              <div style={{ fontSize: 12, color: '#7f1d1d' }}>
                +{syncIssues.length - 3} more issue(s)
              </div>
            )}
          </div>
        )}

        {/* Resizable Content Area */}
        <div ref={contentRef} className="resizable-layout">

          {/* Left — Patient List */}
          <div style={{ width: `${leftWidth}%`, minWidth: '20%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <PatientList
              patients={patients}
              selectedPatient={selectedPatient}
              onPatientSelect={handlePatientSelect}
              onEditPatient={handleEditPatient}
              onUpdatePatient={handleUpdatePatient}
              onDeletePatient={handleDeletePatient}
              onAddPatient={secretary && cloudOffline ? undefined : handleAddPatient}
              onColumnsChange={handleColumnsChange}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              loading={loading}
              fetchError={fetchError}
              fetchPatients={fetchPatients}
              onLoadMore={() => { setPage(p => p + 1); setTimeout(() => fetchPatients(), 100); }}
            />
          </div>

          {/* Drag divider */}
          <div
            onMouseDown={onDividerMouseDown}
            style={{
              width: 6, cursor: 'col-resize', flexShrink: 0, background: '#e2e8f0',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.2s', userSelect: 'none',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#3b82f6'}
            onMouseLeave={e => e.currentTarget.style.background = '#e2e8f0'}
          >
            <div style={{ width: 2, height: 32, background: '#94a3b8', borderRadius: 2 }} />
          </div>

          {/* Right — Patient Detail */}
          <div style={{ flex: 1, minWidth: '30%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <PatientDetail
              selectedPatient={selectedPatient}
              settings={settings}
              onPatientRefresh={handlePatientSelect}
            />
          </div>

        </div>
      </div>

      {/* Patient Form Modal */}
      {showPatientForm && (
        <PatientForm
          patient={editingPatient}
          onClose={handlePatientFormClose}
          onSave={handlePatientSaved}
        />
      )}
    </div>
  );
};

export default Dashboard;
