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
- `SUPERADMIN_PASSWORD` — initial / reset password for the superadmin
- `INVITE_TTL_DAYS` — optional, default `7`
- `RESEND_API_KEY` — optional HTTPS provider
- `POSTMARK_SERVER_TOKEN` — optional HTTPS provider (Postmark Server API token)
- `MAIL_PROVIDER` — `postmark` | `resend` | `smtp` (auto-picks postmark/resend if token/key is set)
- `POSTMARK_MESSAGE_STREAM` — optional, default `outbound`
- `SMTP_FROM` — must match a verified sender/domain on Postmark or Resend

### Auth model

1. Only the superadmin and **invited** emails can access.
2. Superadmin invites an admin (with optional **email send limit**) → invite link to set password.
3. Admins sign in with **email + password** (no OTP).
4. Superadmin can change each admin's send limit anytime; sends are blocked when the cap is hit.
5. Admins cannot invite others.

### Vercel (UI)

- `VITE_API_URL` — public Railway API URL (no trailing slash), e.g. `https://api-production-df71.up.railway.app`
