# cuddly-intervention

Simple Natural Family Planning tracker with Google Sheets backend.

Quick start
- Install dependencies:

```bash
npm install
```

- Run locally (requires Vercel CLI):

```bash
npm install -g vercel   # if you don't have it
vercel dev
# open http://localhost:3000
```

Environment
- Copy `.env.local.example` to `.env.local` and set values:

- `CLIENT_ID` — Google OAuth client ID
- `CLIENT_SECRET` — Google OAuth client secret
- `SHEET_ID` — Google Sheets spreadsheet ID
- `OAUTH_REDIRECT_BASE` — Stable redirect base registered in Google Console (e.g. https://cuddly-intervention.vercel.app)

Register the redirect URI in Google Cloud Console:

1. Set `OAUTH_REDIRECT_BASE` to your stable domain (e.g. `https://cuddly-intervention.vercel.app`).
2. In Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs, add the authorized redirect URI:

```
<OAUTH_REDIRECT_BASE>/api/auth
```

3. When starting the sign-in flow the app will pass the original deployment's origin in the OAuth `state`. The stable redirect will forward the code back to the correct deployment automatically.

Notes
- Authentication is handled server-side in `api/auth.js` and `api/sheets.js`.
- Only whitelisted emails (configured in `api/auth.js`) can access the app.
- The frontend was updated to POST the OAuth `code` to the backend and fetch sheet data.

Security & deployment
- Do NOT commit `.env.local` to git. Use Vercel Environment Variables for production.
- For persistent sessions, the app currently obtains a refresh token on consent; consider storing refresh tokens securely server-side and issuing HTTP-only session cookies.

Files changed
- `index.html`: updated to call backend auth and sheets endpoints.
- `api/auth.js`: OAuth flow, email whitelist, forwards code to frontend.
- `api/sheets.js`: proxies Google Sheets requests using access tokens.

If you want, I can add refresh-token session storage and a logout endpoint before you push.

