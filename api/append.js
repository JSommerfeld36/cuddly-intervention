const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });

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

function getServiceAccountAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON missing');
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

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
  if (!entry) return res.status(401).json({ error: 'Unauthorized' });

  const { values } = req.body || {};
  if (!values || !Array.isArray(values)) return res.status(400).json({ error: 'Missing values array in request body' });

  try {
    const auth = getServiceAccountAuth();
    const sheets = google.sheets({ version: 'v4', auth });

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
    return res.status(500).json({ error: 'Failed to append row', details: gErr || e.message });
  }
};
