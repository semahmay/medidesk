import React, { useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getSession } from '../hooks/useClinicSession';
import { isSecretary } from '../utils/roleUtils';
import { useUX } from '../context/UXContext';
import '../new-design.css';

const ROUTE_MAP = {
  patients: '/',
  appointments: '/appointments',
  'medical-reference': '/medical-reference',
  analytics: '/analytics',
  'clinic-chat': '/clinic-chat',
};

const PAGE_FROM_PATH = {
  '/': 'patients',
  '/appointments': 'appointments',
  '/clinic-chat': 'clinic-chat',
  '/analytics': 'analytics',
  '/medical-reference': 'medical-reference',
};

const Sidebar = ({ activePage }) => {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { userRole } = getSession();
  const secretary = isSecretary(userRole);
  const { unreadChatCount } = useUX();

  const active = activePage || PAGE_FROM_PATH[location.pathname] || '';

  const handleNavClick = useCallback((page) => {
    if (ROUTE_MAP[page]) navigate(ROUTE_MAP[page]);
  }, [navigate]);

  return (
    <div className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">M</div>

      {/* Navigation */}
      <div className="sidebar-nav">

        {/* Patients */}
        <div
          className={`sidebar-nav-item ${active === 'patients' ? 'active' : ''}`}
          onClick={() => handleNavClick('patients')}
          title="Patients"
        >
          <svg viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/>
            <rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
        </div>

        {/* Appointments */}
        <div
          className={`sidebar-nav-item ${active === 'appointments' ? 'active' : ''}`}
          onClick={() => handleNavClick('appointments')}
          title="Appointments"
        >
          <svg viewBox="0 0 24 24" fill="none">
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <path d="M16 2v4M8 2v4M3 10h18"/>
          </svg>
        </div>

        {/* Medical Reference — doctor only */}
        {!secretary && (
          <div
            className={`sidebar-nav-item ${active === 'medical-reference' ? 'active' : ''}`}
            onClick={() => handleNavClick('medical-reference')}
            title="Medical Reference"
          >
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4 19.5C4 18.837 4.26339 18.2011 4.73223 17.7322C5.20107 17.2634 5.83696 17 6.5 17H20"/>
              <path d="M6.5 2H20V22H6.5C5.83696 22 5.20107 21.7366 4.73223 21.2678C4.26339 20.7989 4 20.163 4 19.5V6.5C4 5.83696 4.26339 5.20107 4.73223 4.73223C5.20107 4.26339 5.83696 4 6.5 4Z"/>
              <path d="M8 7H16M8 11H16M8 15H13"/>
            </svg>
          </div>
        )}

        {/* Analytics — doctor only */}
        {!secretary && (
          <div
            className={`sidebar-nav-item ${active === 'analytics' ? 'active' : ''}`}
            onClick={() => handleNavClick('analytics')}
            title="Analytics"
          >
            <svg viewBox="0 0 24 24" fill="none">
              <rect x="3" y="10" width="4" height="11" rx="1"/>
              <rect x="10" y="6" width="4" height="15" rx="1"/>
              <rect x="17" y="3" width="4" height="18" rx="1"/>
            </svg>
          </div>
        )}

        

        {/* Clinic Chat — with unread badge */}
        <div
          className={`sidebar-nav-item ${active === 'clinic-chat' ? 'active' : ''}`}
          onClick={() => handleNavClick('clinic-chat')}
          title="Clinic Chat"
          style={{ position: 'relative' }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          {unreadChatCount > 0 && (
            <span style={{
              position: 'absolute',
              top: 4, right: 4,
              minWidth: 16, height: 16,
              background: '#ef4444',
              color: '#fff',
              borderRadius: 8,
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
              lineHeight: 1,
              pointerEvents: 'none',
            }}>
              {unreadChatCount > 99 ? '99+' : unreadChatCount}
            </span>
          )}
        </div>
      </div>

      {/* Settings at bottom */}
      <div className="sidebar-settings">
        <div
          className={`sidebar-nav-item ${active === 'settings' ? 'active' : ''}`}
          title="Settings"
        >
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 1v6M12 17v6M4.22 4.22l4.24 4.24M15.54 15.54l4.24 4.24M1 12h6M17 12h6M4.22 19.78l4.24-4.24M15.54 8.46l4.24-4.24"/>
          </svg>
        </div>
      </div>
    </div>
  );
};

export default React.memo(Sidebar);
