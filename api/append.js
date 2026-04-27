const { google } = require('googleapis');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });

const SHEET_ID = process.env.SHEET_ID;
const SESSION_SECRET = process.env.SESSION_SECRET;
const ALLOWED_EMAILS = ['joel.sommerfeld36@gmail.com', 'amandamariegordon17@gmail.com'];

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
  const [emailEnc, expiresAtStr, sig] = parts;
  const payload = `${emailEnc}.${expiresAtStr}`;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  const expiresAt = parseInt(expiresAtStr, 10);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
  const email = decodeURIComponent(emailEnc);
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
    console.error('Append error:', gErr || e.message);
    return res.status(500).json({ error: 'Failed to append row', details: gErr || e.message });
  }
};
