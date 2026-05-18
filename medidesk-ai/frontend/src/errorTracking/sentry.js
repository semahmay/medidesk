/**
 * Sentry error tracking for MediDesk AI
 * Captures frontend errors, performance issues, and user sessions
 */

import * as Sentry from '@sentry/react';

const SENTRY_DSN = process.env.REACT_APP_SENTRY_DSN;

export function initSentry() {
  if (!SENTRY_DSN) {
    console.warn('[sentry] SENTRY_DSN not set - error tracking disabled');
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 0.5,
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    release: `medidesk-ai@${process.env.REACT_APP_VERSION || '1.0.0'}`,
    ignoreErrors: [
      /Network Error/,
      /Failed to fetch/,
      /timeout/,
      /cloud_timeout/,
      /NO_TOKEN/,
    ],
  });

  console.log('[sentry] Initialized');
}

export function captureError(error, context = {}) {
  if (!SENTRY_DSN) return;
  Sentry.captureException(error, { extra: context });
}

export function captureMessage(message, level = 'info') {
  if (!SENTRY_DSN) return;
  Sentry.captureMessage(message, level);
}

export function setUserContext(user) {
  if (!SENTRY_DSN || !user) return;
  Sentry.setUser({
    id: user.googleId || user.clinicId,
    email: user.email,
    username: user.name,
  });
}

export function clearUserContext() {
  if (!SENTRY_DSN) return;
  Sentry.setUser(null);
}

export const SentryBreadcrumb = {
  add: (category, message, data = {}) => {
    if (!SENTRY_DSN) return;
    Sentry.addBreadcrumb({
      category,
      message,
      level: 'info',
      data,
    });
  },
};

export default {
  initSentry,
  captureError,
  captureMessage,
  setUserContext,
  clearUserContext,
  SentryBreadcrumb,
};