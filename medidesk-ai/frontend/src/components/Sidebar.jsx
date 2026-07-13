import React, { useCallback, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getSession } from '../hooks/useClinicSession';
import { isSecretary } from '../utils/roleUtils';
import { useUX } from '../context/UXContext';
import { useLanguage } from '../context/LanguageContext';

const ROUTE_MAP = {
  dashboard: '/',
  patients: '/patients',
  appointments: '/appointments',
  'medical-reference': '/medical-reference',
  analytics: '/analytics',
  'clinic-chat': '/clinic-chat',
};

const PAGE_FROM_PATH = {
  '/': 'dashboard',
  '/patients': 'patients',
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
  const { t } = useLanguage();
  const [collapsed, setCollapsed] = useState(false);

  const active = activePage || PAGE_FROM_PATH[location.pathname] || '';

  useEffect(() => {
    const shell = document.querySelector('.app-shell');
    if (!shell) return;
    if (collapsed) shell.classList.add('collapsed');
    else           shell.classList.remove('collapsed');
  }, [collapsed]);

  const handleNavClick = useCallback((page) => {
    if (ROUTE_MAP[page]) navigate(ROUTE_MAP[page]);
  }, [navigate]);

  const NAV_ITEMS = [
    { page: 'dashboard',   label: t('nav.dashboard'),    icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
    { page: 'patients',    label: t('nav.patients'),     icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75' },
    { page: 'appointments',label: t('nav.appointments'), icon: 'M3 4h18v18H3V4zm4-2v4m10-4v4M3 10h18' },
    { page: 'clinic-chat', label: t('nav.chat'),         icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
  ];

  const DOCTOR_ITEMS = [
    { page: 'medical-reference', label: t('nav.medical'),    icon: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z M8 7h8M8 11h8M8 15h5' },
    { page: 'analytics',         label: t('nav.analytics'),  icon: 'M18 20V10M12 20V4M6 20v-6' },
  ];

  return (
    <div className="sidebar">
      <div className="brand">
        <svg className="pulse-mark" viewBox="0 0 32 32" fill="none">
          <path d="M2 16h6l3-9 5 18 4-13 2 4h8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="brand-name">medidesk</span>
      </div>

      <nav className="nav">
        {NAV_ITEMS.map(item => (
          <button
            key={item.page}
            className={`navitem ${active === item.page ? 'active' : ''}`}
            onClick={() => handleNavClick(item.page)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={item.icon} />
            </svg>
            <span className="navlabel">{item.label}</span>
            {item.page === 'clinic-chat' && unreadChatCount > 0 && (
              <span style={{
                marginLeft: 'auto', minWidth: 18, height: 18, borderRadius: 9,
                background: 'var(--danger-600)', color: '#fff',
                fontSize: 10, fontWeight: 700, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                padding: '0 4px', lineHeight: 1,
              }}>
                {unreadChatCount > 99 ? '99+' : unreadChatCount}
              </span>
            )}
          </button>
        ))}

        {!secretary && (
          <>
            <div className="nav-divider" />
            {DOCTOR_ITEMS.map(item => (
              <button
                key={item.page}
                className={`navitem ${active === item.page ? 'active' : ''}`}
                onClick={() => handleNavClick(item.page)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={item.icon} />
                </svg>
                <span className="navlabel">{item.label}</span>
              </button>
            ))}
          </>
        )}
      </nav>

      <div className="nav-divider" />
      <button className="sidebar-foot" onClick={() => setCollapsed(c => !c)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        <span>{t('nav.settings')}</span>
      </button>
    </div>
  );
};

export default React.memo(Sidebar);
