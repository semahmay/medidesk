/**
 * Operations Dashboard - Internal admin/diagnostics panel
 * Accessible at /operations route
 */

import React, { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
import cloudApi from '../cloudApi';


const OperationsDashboard = ({ currentUser }) => {
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
  const [, setLoading] = useState(true);

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
    <span className="text-sm font-semibold" style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 20,
      background: `${getStatusColor(status)}20`, color: getStatusColor(status),
    }}>
      <span className="rounded-full" style={{
        width: 8, height: 8,
        background: getStatusColor(status),
      }} />
      {status?.toUpperCase() || 'UNKNOWN'}
    </span>
  );

  const refreshData = () => loadDashboard();

  return (
    <div className="app-shell">
      <TopBar currentUser={currentUser} />
      <Sidebar activePage="operations" />
      <div className="main-content page-transition" style={{ overflowY: 'auto', padding: '24px 32px' }}>
        <div className="flex-row justify-between items-center" style={{ marginBottom: 24 }}>
          <div>
            <h1 className="font-bold text-slate-dark" style={{ fontSize: 24, margin: 0 }}>
              Operations Dashboard
            </h1>
            <p className="text-slate mt-4">System health and diagnostics</p>
          </div>
          <button
            onClick={refreshData}
            className="btn-primary flex-row items-center gap-8 font-semibold"
          >
            ↻ Refresh
          </button>
        </div>

        {/* System Status Cards */}
        <div className="grid-4" style={{ marginBottom: 24 }}>
          <div className="card p-20">
            <div className="text-sm text-slate mb-8">API Status</div>
            <StatusBadge status={systemStatus.api} />
          </div>
          <div className="card p-20">
            <div className="text-sm text-slate mb-8">Database</div>
            <StatusBadge status={systemStatus.database} />
          </div>
          <div className="card p-20">
            <div className="text-sm text-slate mb-8">WebSocket</div>
            <StatusBadge status={systemStatus.websocket} />
          </div>
          <div className="card p-20">
            <div className="text-sm text-slate mb-8">Storage</div>
            <StatusBadge status={systemStatus.storage} />
          </div>
        </div>

        {/* Metrics */}
        <div className="grid-4" style={{ marginBottom: 24 }}>
          <div className="card p-20">
            <div className="text-sm text-slate">Total Patients</div>
            <div className="text-3xl font-bold text-slate-dark">{metrics.patients}</div>
          </div>
          <div className="card p-20">
            <div className="text-sm text-slate">Appointments</div>
            <div className="text-3xl font-bold text-slate-dark">{metrics.appointments}</div>
          </div>
          <div className="card p-20">
            <div className="text-sm text-slate">Users</div>
            <div className="text-3xl font-bold text-slate-dark">{metrics.users}</div>
          </div>
          <div className="card p-20">
            <div className="text-sm text-slate">Storage Used</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1e293b' }}>
              {metrics.storage.used_mb || 0} <span className="text-md font-normal">/ {metrics.storage.quota_mb || 500} MB</span>
            </div>
          </div>
        </div>

        {/* Sync Queue Status */}
        <div className="card p-20">
          <h3 className="text-lg font-semibold text-slate-dark" style={{ margin: '0 0 16px' }}>
            Sync Queue Status
          </h3>
          <div style={{ display: 'flex', gap: 24 }}>
            <div>
              <div className="text-sm text-slate">Pending Items</div>
              <div className="font-bold" style={{ fontSize: 24, color: '#f59e0b' }}>{syncQueue.count}</div>
            </div>
            <div>
              <div className="text-sm text-slate">Failed</div>
              <div className="font-bold" style={{ fontSize: 24, color: syncQueue.failed > 0 ? '#ef4444' : '#22c55e' }}>
                {syncQueue.failed}
              </div>
            </div>
            {syncQueue.failed > 0 && (
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('retry-sync'))}
                className="rounded-md text-md font-semibold cursor-pointer"
                style={{
                  padding: '8px 16px', background: '#ef4444', color: '#fff',
                  border: 'none', marginLeft: 'auto',
                }}
              >
                Retry Failed
              </button>
            )}
          </div>
        </div>

        {/* Error Log */}
        <div className="card p-20 mt-16">
          <div className="flex-row justify-between items-center mb-16">
            <h3 className="text-lg font-semibold text-slate-dark" style={{ margin: 0 }}>
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
              className="bg-slate-100 rounded text-base cursor-pointer"
              style={{
                padding: '6px 12px', color: '#475569',
                border: '1px solid #e2e8f0',
              }}
            >
              📥 Export Diagnostics
            </button>
          </div>
          {errors.length === 0 ? (
            <div className="p-20 text-center text-slate">
              ✓ No recent errors
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr className="border-b">
                  <th className="text-sm text-slate" style={{ textAlign: 'left', padding: '8px 12px' }}>Time</th>
                  <th className="text-sm text-slate" style={{ textAlign: 'left', padding: '8px 12px' }}>Error</th>
                  <th className="text-sm text-slate" style={{ textAlign: 'left', padding: '8px 12px' }}>Endpoint</th>
                </tr>
              </thead>
              <tbody>
                {errors.slice(0, 10).map((err, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td className="text-base text-slate" style={{ padding: '8px 12px' }}>
                      {new Date(err.timestamp).toLocaleString()}
                    </td>
                    <td className="text-base" style={{ padding: '8px 12px', color: '#ef4444' }}>{err.message}</td>
                    <td className="text-base text-slate" style={{ padding: '8px 12px' }}>{err.endpoint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* System Info */}
        <div className="card p-20 mt-16">
          <h3 className="text-lg font-semibold text-slate-dark" style={{ margin: '0 0 16px' }}>
            Build Information
          </h3>
          <div className="grid-2 gap-12 text-base">
            <div><span className="text-slate">Version:</span> <span className="font-semibold">1.0.0</span></div>
            <div><span className="text-slate">Environment:</span> <span className="font-semibold">production</span></div>
            <div><span className="text-slate">Backend:</span> <span className="font-semibold">{process.env.REACT_APP_CLOUD_URL?.replace('/api', '') || 'Not configured'}</span></div>
            <div><span className="text-slate">Database:</span> <span className="font-semibold">PostgreSQL</span></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OperationsDashboard;