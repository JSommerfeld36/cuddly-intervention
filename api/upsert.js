const { google } = require('googleapis');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });

const SHEET_ID = process.env.SHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || 'Sheet1';
const SESSION_SECRET = process.env.SESSION_SECRET;
const ALLOWED_EMAILS = ['joel.sommerfeld36@gmail.com', 'amandamariegordon17@gmail.com'];
const COL_COUNT = 6;

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').map(c => c.trim()).reduce((acc, pair) => {
    const [k, ...v] = pair.split('=');
    acc[k] = v.join('=');
    return acc;
  }, {});
}

function verifySession(sessionValue) {
  if (!sessionValue || !SESSION_SECRET) return null;
  const parts = sessionValue.split('.');
  if (parts.length !== 3) return null;
  const [emailB64, expiresAtStr, sig] = parts;
  const payload = `${emailB64}.${expiresAtStr}`;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  const expiresAt = parseInt(expiresAtStr, 10);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
  const email = Buffer.from(emailB64, 'base64url').toString('utf8');
  if (!ALLOWED_EMAILS.includes(email)) return null;
  return { email };
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

function dateOnly(s) {
  return (s || '').split(' ')[0];
}

function boolStr(v) {
  if (v === true) return 'TRUE';
  if (v === false) return 'FALSE';
  return '';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const cookies = parseCookies(req.headers.cookie);
  const session = verifySession(cookies.session);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  if (!SHEET_ID) {
    console.error('Missing SHEET_ID in environment');
    return res.status(500).json({ error: 'Server configuration error: SHEET_ID missing' });
  }

  const body = req.body || {};
  const { date, cycle_number, cycle_start, test_level, cycle_day, intercourse } = body;
  if (!date) return res.status(400).json({ error: 'Missing date' });

  try {
    const auth = getServiceAccountAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:F`,
    });
    const rows = data.values || [];

    const target = dateOnly(date);
    let foundIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (dateOnly(rows[i][0]) === target) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex === -1) {
      const newRow = [
        date,
        cycle_number ?? '',
        boolStr(cycle_start),
        test_level ?? '',
        cycle_day ?? '',
        boolStr(intercourse),
      ];
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A:F`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [newRow] },
      });
      return res.status(200).json({ success: true, action: 'inserted' });
    }

    const existing = rows[foundIndex] || [];
    const merged = [];
    for (let i = 0; i < COL_COUNT; i++) merged[i] = existing[i] ?? '';

    merged[0] = date;
    if (cycle_number !== undefined) merged[1] = cycle_number;
    if (cycle_start !== undefined) merged[2] = boolStr(cycle_start);
    if (test_level !== undefined) merged[3] = test_level;
    if (cycle_day !== undefined) merged[4] = cycle_day;
    if (intercourse !== undefined) merged[5] = boolStr(intercourse);

    const sheetRow = foundIndex + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A${sheetRow}:F${sheetRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [merged] },
    });

    return res.status(200).json({ success: true, action: 'updated' });
  } catch (e) {
    const gErr = e && e.response && e.response.data ? e.response.data : null;
    console.error('Upsert error:', gErr || e.message);
    return res.status(500).json({ error: 'Failed to save row' });
  }
};
