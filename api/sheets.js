const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
// Prefer an explicit stable redirect base for OAuth flows
let baseUrl = process.env.OAUTH_REDIRECT_BASE || process.env.VERCEL_URL || 'http://localhost:3000';
if (!/^https?:\/\//i.test(baseUrl)) baseUrl = 'http://' + baseUrl;
const REDIRECT_URI = `${baseUrl.replace(/\/$/, '')}/api/auth`;
const SHEET_ID = process.env.SHEET_ID;

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

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

async function handler(req, res) {
  const { token } = req.headers;

  let accessToken = token;

  if (!accessToken) {
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies.session;
    if (!sessionId) return res.status(401).json({ error: 'Unauthorized' });

    const list = readTokens();
    const entry = list.find((r) => r.sessionId === sessionId);
    if (!entry || !entry.refreshToken) return res.status(401).json({ error: 'Unauthorized' });

    // Exchange refresh token for an access token
    oauth2Client.setCredentials({ refresh_token: entry.refreshToken });
    try {
      const at = await oauth2Client.getAccessToken();
      accessToken = at && at.token ? at.token : at;
    } catch (e) {
      console.error('Failed to refresh access token:', e);
      return res.status(401).json({ error: 'Unauthorized', details: e.message });
    }
  }

  if (!SHEET_ID) {
    console.error('Missing SHEET_ID in environment');
    return res.status(500).json({ error: 'Server configuration error: SHEET_ID missing' });
  }

  oauth2Client.setCredentials({ access_token: accessToken });

  try {
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A:E',
    });

    res.status(200).json(data);
  } catch (error) {
    console.error('Sheets API error:', error);
    if (error.response && error.response.data) console.error('Response data:', error.response.data);
    res.status(500).json({ error: 'Failed to fetch data', details: error.message });
  }
}

module.exports = handler;