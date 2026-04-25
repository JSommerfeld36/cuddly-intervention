const { google } = require('googleapis');
const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
let baseUrl = process.env.VERCEL_URL || 'http://localhost:3000';
if (!/^https?:\/\//i.test(baseUrl)) baseUrl = 'http://' + baseUrl;
const REDIRECT_URI = `${baseUrl.replace(/\/$/, '')}/api/auth`;
const SHEET_ID = process.env.SHEET_ID;

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

async function handler(req, res) {
  const { token } = req.headers;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!SHEET_ID) {
    console.error('Missing SHEET_ID in environment');
    return res.status(500).json({ error: 'Server configuration error: SHEET_ID missing' });
  }

  oauth2Client.setCredentials({ access_token: token });

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