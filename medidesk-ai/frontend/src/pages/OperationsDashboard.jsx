/**
 * Operations Dashboard - Internal admin/diagnostics panel
 * Accessible at /operations route
 */

import React, { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import cloudApi from '../cloudApi';
import { getSession } from '../hooks/useClinicSession';
import { isDoctor } from '../utils/roleUtils';
import '../new-design.css';

const OperationsDashboard = () => {
  const { userRole, clinicId } = getSession();
  const isDoc = isDoctor(userRole);

  const [systemStatus, setSystemStatus] = useState({
    api: 'checking',
    database: 'checking',
    websocket: 'checking',
    storage: 'checking',
  });

  const [metrics, setMetrics] = useState({
    patients: 0,
    appointments: 0,
    users: 0,
    storage: { used_mb: 0, quota_mb: 0 },
  });

  const [syncQueue, setSyncQueue] = useState({ count: 0, failed: 0 });
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const [healthRes, metricsRes, queueRes, errorsRes] = await Promise.allSettled([
        cloudApi.get('/admin/health'),
        cloudApi.get('/admin/metrics'),
        cloudApi.get('/admin/sync-queue'),
        cloudApi.get('/admin/errors'),
      ]);

      if (healthRes.status === 'fulfilled') {
        setSystemStatus({
          api: healthRes.value.data?.api ?? 'unknown',
          database: healthRes.value.data?.db ?? 'unknown',
          websocket: healthRes.value.data?.websocket ?? 'unknown',
          storage: healthRes.value.data?.storage ?? 'unknown',
        });
      }

      if (metricsRes.status === 'fulfilled') {
        setMetrics(metricsRes.value.data);
      }

      if (queueRes.status === 'fulfilled') {
        setSyncQueue(queueRes.value.data);
      }

      if (errorsRes.status === 'fulfilled') {
        setErrors(errorsRes.value.data.errors || []);
      }
    } catch (err) {
      console.warn('[ops] Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'ok':
      case 'online':
      case 'connected':
        return '#22c55e';
      case 'warning':
      case 'checking':
        return '#f59e0b';
      case 'error':
      case 'offline':
      case 'disconnected':
        return '#ef4444';
      default:
        return '#6b7280';
    }
  };

  const StatusBadge = ({ status }) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
      background: `${getStatusColor(status)}20`, color: getStatusColor(status),
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: getStatusColor(status),
      }} />
      {status?.toUpperCase() || 'UNKNOWN'}
    </span>
  );

  const refreshData = () => loadDashboard();

  return (
    <div className="app-container">
      <Sidebar activePage="operations" />

      <div className="main-content" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', margin: 0 }}>
              Operations Dashboard
            </h1>
            <p style={{ color: '#64748b', margin: '4px 0 0' }}>System health and diagnostics</p>
          </div>
          <button
            onClick={refreshData}
            style={{
              padding: '8px 16px', background: '#1D9E75', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            ↻ Refresh
          </button>
        </div>

        {/* System Status Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          <div style={cardStyle}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>API Status</div>
            <StatusBadge status={systemStatus.api} />
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>Database</div>
            <StatusBadge status={systemStatus.database} />
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>WebSocket</div>
            <StatusBadge status={systemStatus.websocket} />
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>Storage</div>
            <StatusBadge status={systemStatus.storage} />
          </div>
        </div>

        {/* Metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          <div style={cardStyle}>
            <div style={{ fontSize: 12, color: '#64748b' }}>Total Patients</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#1e293b' }}>{metrics.patients}</div>
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: 12, color: '#64748b' }}>Appointments</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#1e293b' }}>{metrics.appointments}</div>
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: 12, color: '#64748b' }}>Users</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#1e293b' }}>{metrics.users}</div>
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: 12, color: '#64748b' }}>Storage Used</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1e293b' }}>
              {metrics.storage.used_mb || 0} <span style={{ fontSize: 14, fontWeight: 400 }}>/ {metrics.storage.quota_mb || 500} MB</span>
            </div>
          </div>
        </div>

        {/* Sync Queue Status */}
        <div style={cardStyle}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', margin: '0 0 16px' }}>
            Sync Queue Status
          </h3>
          <div style={{ display: 'flex', gap: 24 }}>
            <div>
              <div style={{ fontSize: 12, color: '#64748b' }}>Pending Items</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#f59e0b' }}>{syncQueue.count}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#64748b' }}>Failed</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: syncQueue.failed > 0 ? '#ef4444' : '#22c55e' }}>
                {syncQueue.failed}
              </div>
            </div>
            {syncQueue.failed > 0 && (
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('retry-sync'))}
                style={{
                  padding: '8px 16px', background: '#ef4444', color: '#fff',
                  border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
                  cursor: 'pointer', marginLeft: 'auto',
                }}
              >
                Retry Failed
              </button>
            )}
          </div>
        </div>

        {/* Error Log */}
        <div style={{ ...cardStyle, marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', margin: 0 }}>
              Recent Errors
            </h3>
            <button
              onClick={() => {
                const data = JSON.stringify({ systemStatus, metrics, syncQueue, errors }, null, 2);
                const blob = new Blob([data], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `medidesk-diagnostics-${new Date().toISOString()}.json`;
                a.click();
              }}
              style={{
                padding: '6px 12px', background: '#f1f5f9', color: '#475569',
                border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13,
                cursor: 'pointer',
              }}
            >
              📥 Export Diagnostics
            </button>
          </div>
          {errors.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>
              ✓ No recent errors
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 12, color: '#64748b' }}>Time</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 12, color: '#64748b' }}>Error</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 12, color: '#64748b' }}>Endpoint</th>
                </tr>
              </thead>
              <tbody>
                {errors.slice(0, 10).map((err, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 12px', fontSize: 13, color: '#64748b' }}>
                      {new Date(err.timestamp).toLocaleString()}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 13, color: '#ef4444' }}>{err.message}</td>
                    <td style={{ padding: '8px 12px', fontSize: 13, color: '#64748b' }}>{err.endpoint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* System Info */}
        <div style={{ ...cardStyle, marginTop: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', margin: '0 0 16px' }}>
            Build Information
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, fontSize: 13 }}>
            <div><span style={{ color: '#64748b' }}>Version:</span> <span style={{ fontWeight: 600 }}>1.0.0</span></div>
            <div><span style={{ color: '#64748b' }}>Environment:</span> <span style={{ fontWeight: 600 }}>production</span></div>
            <div><span style={{ color: '#64748b' }}>Backend:</span> <span style={{ fontWeight: 600 }}>40.81.230.3</span></div>
            <div><span style={{ color: '#64748b' }}>Database:</span> <span style={{ fontWeight: 600 }}>PostgreSQL</span></div>
          </div>
        </div>
      </div>
    </div>
  );
};

const cardStyle = {
  background: '#fff',
  borderRadius: 12,
  padding: 20,
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  border: '1px solid #e2e8f0',
};

export default OperationsDashboard;