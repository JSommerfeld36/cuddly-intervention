const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

// Prefer an explicit stable redirect base. Set `OAUTH_REDIRECT_BASE` in production
// to your stable domain (e.g. https://cuddly-intervention.vercel.app). Fallback
// to VERCEL_URL or localhost for local dev.
let baseUrl = process.env.OAUTH_REDIRECT_BASE || process.env.VERCEL_URL || 'http://localhost:3000';
if (!/^https?:\/\//i.test(baseUrl)) baseUrl = 'http://' + baseUrl;
const REDIRECT_URI = `${baseUrl.replace(/\/$/, '')}/api/auth`;
const ALLOWED_EMAILS = ['joel.sommerfeld36@gmail.com', 'amandamariegordon17@gmail.com'];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing CLIENT_ID or CLIENT_SECRET in environment');
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const TOKENS_FILE = path.resolve(process.cwd(), 'data', 'tokens.json');

function ensureTokensFile() {
  const dir = path.dirname(TOKENS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(TOKENS_FILE)) fs.writeFileSync(TOKENS_FILE, JSON.stringify([]), 'utf8');
}

function readTokens() {
  ensureTokensFile();
  try {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8') || '[]');
  } catch (e) {
    return [];
  }
}

function writeTokens(list) {
  ensureTokensFile();
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function saveSession(sessionId, email, refreshToken) {
  const list = readTokens();
  // Replace existing entry for this email if present
  const filtered = list.filter((r) => r.email !== email);
  filtered.push({ sessionId, email, refreshToken, createdAt: new Date().toISOString() });
  writeTokens(filtered);
}

function findRefreshTokenByEmail(email) {
  const list = readTokens();
  const found = list.find((r) => r.email === email);
  return found ? found.refreshToken : null;
}


async function handler(req, res) {
  if (req.method === 'GET') {
    const { code, state, returnTo } = req.query || {};

    // If Google redirected back with a code, forward to the original requester
    if (code) {
      const forwardTo = state ? decodeURIComponent(state) : (returnTo || '/');
      console.log('Received code from Google, forwarding to:', forwardTo);
      const forwardUrl = `${forwardTo.replace(/\/$/, '')}/?code=${encodeURIComponent(code)}`;
      return res.redirect(forwardUrl);
    }

    // Start auth: accept an optional `returnTo` query param, embed into state
    const clientReturnTo = returnTo || req.query.returnTo || '';
    const stateValue = clientReturnTo ? encodeURIComponent(clientReturnTo) : undefined;

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        // Full spreadsheets scope to allow read/write operations from the app
        'https://www.googleapis.com/auth/spreadsheets',
        'openid',
        'email',
        'profile',
      ],
      prompt: 'consent',
      state: stateValue,
    });
    console.log('Generated auth URL:', authUrl);
    console.log('Using redirect URI:', REDIRECT_URI);
    return res.redirect(authUrl);
  }

  if (req.method === 'POST') {
    const { code } = req.body;
    try {
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const { data } = await oauth2.userinfo.get();

      if (!ALLOWED_EMAILS.includes(data.email)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Create a session id for a secure HttpOnly cookie
      const sessionId = crypto.randomBytes(16).toString('hex');
      const isSecure = /^https:\/\//i.test(baseUrl);

      // Persist the refresh token server-side when available. If Google did not
      // return a refresh token (e.g. returning user), try to reuse an existing
      // refresh token for this email.
      if (tokens.refresh_token) {
        saveSession(sessionId, data.email, tokens.refresh_token);
      } else {
        const existing = findRefreshTokenByEmail(data.email);
        if (existing) {
          saveSession(sessionId, data.email, existing);
        }
      }

      // Set HttpOnly session cookie so the browser sends it on future requests.
      const maxAge = 30 * 24 * 60 * 60; // 30 days
      const cookie = `session=${sessionId}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${isSecure ? '; Secure' : ''}`;
      res.setHeader('Set-Cookie', cookie);

      // Return the current access token for the client to use immediately.
      // The refresh token is persisted server-side to allow later refreshes.
      const accessToken = tokens.access_token || null;
      return res.status(200).json({ success: true, token: accessToken });
    } catch (error) {
      console.error('Auth error:', error);
      if (error.response && error.response.data) {
        console.error('Response data:', error.response.data);
      }
      return res.status(500).json({ error: 'Authentication failed', details: error.message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}

module.exports = handler;