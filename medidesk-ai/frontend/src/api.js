import axios from 'axios';

export const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// Holds the googleId once set — never cleared during a session
let _googleId = null;

/**
 * Set the user ID once after login. Called from App.jsx before any page renders.
 * All subsequent API calls will include this header automatically.
 */
export function setUserId(googleId) {
  _googleId = googleId || null;
}

/** Clear on logout */
export function clearUserId() {
  _googleId = null;
}

// Axios instance with automatic X-User-ID header
const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  if (_googleId) {
    config.headers['X-User-ID'] = _googleId;
  }
  return config;
});

export default api;

// Retry wrapper — retries up to `retries` times with 1s delay between attempts
export const fetchWithRetry = async (fn, retries = 3) => {
  try {
    return await fn();
  } catch (e) {
    if (retries <= 0) throw e;
    await new Promise(r => setTimeout(r, 1000));
    return fetchWithRetry(fn, retries - 1);
  }
};
