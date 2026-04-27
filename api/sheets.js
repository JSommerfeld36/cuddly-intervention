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

async function handler(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies.session;
  if (!sessionId) return res.status(401).json({ error: 'Unauthorized' });

  const list = readTokens();
  const entry = list.find((r) => r.sessionId === sessionId);
  if (!entry) return res.status(401).json({ error: 'Unauthorized' });

  if (!SHEET_ID) {
    console.error('Missing SHEET_ID in environment');
    return res.status(500).json({ error: 'Server configuration error: SHEET_ID missing' });
  }

  try {
    const auth = getServiceAccountAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${process.env.SHEET_NAME || 'Sheet1'}!A:E`,
    });

    res.status(200).json(data);
  } catch (error) {
    console.error('Sheets API error:', error);
    if (error.response && error.response.data) console.error('Response data:', error.response.data);
    res.status(500).json({ error: 'Failed to fetch data', details: error.message });
  }
}

module.exports = handler;
