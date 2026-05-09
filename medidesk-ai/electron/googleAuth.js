const { shell } = require('electron');
const http = require('http');
const url = require('url');
const https = require('https');
const path = require('path');
const { upsertUser, saveSession } = require('./userStore');

require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_PORT = 9876;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

/**
 * Full OAuth flow.
 * Opens Google in system browser → catches redirect → exchanges code → saves user.
 * Returns the saved user record { googleId, email, name, picture, ... }.
 */
function startGoogleLogin() {
  return new Promise((resolve, reject) => {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      return reject(new Error('GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set in .env'));
    }

    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&access_type=offline` +
      `&prompt=select_account`;

    const server = http.createServer(async (req, res) => {
      const parsed = url.parse(req.url, true);
      if (parsed.pathname !== '/callback') { res.end(); return; }

      const code = parsed.query.code;
      const error = parsed.query.error;

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f172a;color:#fff">
        <h2>${error ? '❌ Login cancelled' : '✅ Login successful!'}</h2>
        <p>You can close this tab and return to MediDesk AI.</p>
      </body></html>`);

      server.close();

      if (error) return reject(new Error('Login cancelled by user'));

      try {
        const tokens = await exchangeCodeForTokens(code);
        const googleUser = await fetchUserInfo(tokens.access_token);

        // Save to users.json + write session.json
        const user = upsertUser(googleUser);
        saveSession(user.googleId);

        // Attach the Google access token so the frontend can exchange it for a JWT
        resolve({ ...user, googleAccessToken: tokens.access_token });
      } catch (err) {
        reject(err);
      }
    });

    server.listen(REDIRECT_PORT, () => shell.openExternal(authUrl));
    server.on('error', (err) => reject(new Error('Auth server error: ' + err.message)));

    setTimeout(() => {
      server.close();
      reject(new Error('Login timed out. Please try again.'));
    }, 5 * 60 * 1000);
  });
}

function exchangeCodeForTokens(code) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString();

    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error_description || parsed.error));
          resolve(parsed);
        } catch { reject(new Error('Failed to parse token response')); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function fetchUserInfo(accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: '/oauth2/v2/userinfo',
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const u = JSON.parse(data);
          resolve({ name: u.name, email: u.email, picture: u.picture, googleId: u.id });
        } catch { reject(new Error('Failed to parse user info')); }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

module.exports = { startGoogleLogin };
