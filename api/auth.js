const { google } = require('googleapis');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const ALLOWED_EMAILS = ['joel.sommerfeld36@gmail.com', 'amandamariegordon17@gmail.com'];

let baseUrl = process.env.OAUTH_REDIRECT_BASE || process.env.VERCEL_URL || 'http://localhost:3000';
if (!/^https?:\/\//i.test(baseUrl)) baseUrl = 'http://' + baseUrl;
const REDIRECT_URI = `${baseUrl.replace(/\/$/, '')}/api/auth`;

if (!CLIENT_ID || !CLIENT_SECRET) console.error('Missing CLIENT_ID or CLIENT_SECRET');
if (!SESSION_SECRET) console.error('Missing SESSION_SECRET');

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

function signSession(email) {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const emailB64 = Buffer.from(email, 'utf8').toString('base64url');
  const payload = `${emailB64}.${expiresAt}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

async function handler(req, res) {
  if (req.method === 'GET') {
    const { code, state, returnTo } = req.query || {};

    if (code) {
      const forwardTo = state ? decodeURIComponent(state) : (returnTo || '/');
      const forwardUrl = `${forwardTo.replace(/\/$/, '')}/?code=${encodeURIComponent(code)}`;
      return res.redirect(forwardUrl);
    }

    const clientReturnTo = returnTo || '';
    const stateValue = clientReturnTo ? encodeURIComponent(clientReturnTo) : undefined;

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'online',
      scope: ['openid', 'email', 'profile'],
      prompt: 'consent',
      state: stateValue,
    });
    return res.redirect(authUrl);
  }

  if (req.method === 'POST') {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'Missing code' });
    if (!SESSION_SECRET) return res.status(500).json({ error: 'Server misconfigured: SESSION_SECRET missing' });

    try {
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const { data } = await oauth2.userinfo.get();

      if (!ALLOWED_EMAILS.includes(data.email)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const sessionValue = signSession(data.email);
      const isSecure = /^https:\/\//i.test(baseUrl);
      const cookie = `session=${sessionValue}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; SameSite=Lax${isSecure ? '; Secure' : ''}`;
      res.setHeader('Set-Cookie', cookie);

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Auth error:', error);
      if (error.response && error.response.data) console.error('Response data:', error.response.data);
      return res.status(500).json({ error: 'Authentication failed', details: error.message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}

module.exports = handler;
