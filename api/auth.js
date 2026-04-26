const { google } = require('googleapis');
const path = require('path');
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
        'https://www.googleapis.com/auth/spreadsheets.readonly',
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

      return res.status(200).json({ token: tokens.access_token });
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