/**
 * useClinicSession.js
 *
 * PHASE 1 REFACTOR:
 * getSession() now reads from the in-memory store in App.jsx instead of localStorage.
 * saveSession() still writes to disk via IPC (used by JoinClinic after login).
 * localStorage writes are kept as a fallback for browser/dev mode only.
 *
 * hasSession() is kept for JoinClinic compatibility but reads from memory.
 */

import { getSession as getMemorySession, setSession as setMemorySession } from '../App';

export const getSession = () => getMemorySession();

export const saveSession = ({ clinicId, userRole, userName = '' }) => {
  // Update in-memory store immediately
  setMemorySession({ clinicId, userRole, userName });

  // Persist to Electron disk so it survives restarts
  if (window.electronAPI?.saveClinicSession) {
    window.electronAPI.saveClinicSession({ clinicId, userRole, userName });
  }

  // Keep localStorage as fallback for browser dev mode
  localStorage.setItem('clinic_id', clinicId);
  localStorage.setItem('user_role', userRole);
  if (userName) localStorage.setItem('user_name', userName);
};

export const clearSession = () => {
  setMemorySession({ clinicId: '', userRole: '', userName: '' });
  localStorage.removeItem('clinic_id');
  localStorage.removeItem('user_role');
  localStorage.removeItem('user_name');
};

// hasSession reads from memory — no localStorage dependency
export const hasSession = () => !!getMemorySession().clinicId;
