const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
let baseUrl = process.env.OAUTH_REDIRECT_BASE || process.env.VERCEL_URL || 'http://localhost:3000';
if (!/^https?:\/\//i.test(baseUrl)) baseUrl = 'http://' + baseUrl;
const REDIRECT_URI = `${baseUrl.replace(/\/$/, '')}/api/auth`;
const SHEET_ID = process.env.SHEET_ID;

const TOKENS_FILE = path.resolve(process.cwd(), 'data', 'tokens.json');

function readTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8') || '[]');
  } catch (e) {
    return [];
  }
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').map(c => c.trim()).reduce((acc, pair) => {
    const [k, ...v] = pair.split('=');
    acc[k] = decodeURIComponent(v.join('='));
    return acc;
  }, {});
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  if (!SHEET_ID) {
    console.error('Missing SHEET_ID in environment');
    return res.status(500).json({ error: 'Server configuration error: SHEET_ID missing' });
  }

  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies.session;
  if (!sessionId) return res.status(401).json({ error: 'Unauthorized' });

  const list = readTokens();
  const entry = list.find((r) => r.sessionId === sessionId);
  if (!entry || !entry.refreshToken) return res.status(401).json({ error: 'Unauthorized' });

  const { values } = req.body || {};
  if (!values || !Array.isArray(values)) return res.status(400).json({ error: 'Missing values array in request body' });

  try {
    oauth2Client.setCredentials({ refresh_token: entry.refreshToken });
    const at = await oauth2Client.getAccessToken();
    const accessToken = at && at.token ? at.token : at;

    oauth2Client.setCredentials({ access_token: accessToken });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    const range = `${process.env.SHEET_NAME || 'Sheet1'}!A:E`;
    const resp = await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [values] },
    });

    return res.status(200).json({ success: true, result: resp.data });
  } catch (e) {
    const gErr = e && e.response && e.response.data ? e.response.data : null;
    console.error('Append error for session', sessionId, gErr || e.message);

    // If Google reports insufficient scopes, ask the client to re-consent (request new scopes)
    const insufficient = gErr && gErr.error && (gErr.error.code === 403 || /insufficient authentication scopes/i.test(gErr.error.message || ''));
    if (insufficient) {
      // Build an auth URL to re-prompt consent. Use Referer/Origin to return the user back.
      const returnTo = req.headers.referer || req.headers.origin || baseUrl;
      const stateValue = returnTo ? encodeURIComponent(returnTo) : undefined;
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
          'https://www.googleapis.com/auth/spreadsheets',
          'openid',
          'email',
          'profile',
        ],
        prompt: 'consent',
        state: stateValue,
      });
      return res.status(403).json({ error: 'insufficient_scopes', authUrl });
    }

    return res.status(500).json({ error: 'Failed to append row', details: gErr || e.message });
  }
};
