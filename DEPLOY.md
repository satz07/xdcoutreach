# XDC Outreach — deploy notes

## Architecture

- **Vercel** (`xdcoutreach.vercel.app`) — React UI
- **Railway** — Express API + Postgres + SMTP

## Required env vars

### Railway (API)

- `DATABASE_URL` — from Railway Postgres plugin
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `CORS_ORIGINS` — e.g. `https://xdcoutreach.vercel.app`
- `FRONTEND_URL` — same as Vercel URL (used in invite emails)
- `APP_URL` — public Railway API URL (for absolute logo links in emails if needed)
- `JWT_SECRET` — long random string (required for login sessions)
- `SUPERADMIN_EMAIL` — default `satheesh@xinfin.org`
- `OTP_TTL_MINUTES` — optional, default `10`

### Auth model

1. Only invited emails (plus the seeded superadmin) can request an OTP.
2. Everyone signs in with **email → OTP → JWT** (no passwords).
3. **Superadmin** can invite admins (Invite Admins tab) and deactivate them.
4. **Admins** can compose/send emails but cannot invite anyone.

### Vercel (UI)

- `VITE_API_URL` — public Railway API URL (no trailing slash), e.g. `https://api-production-df71.up.railway.app`
