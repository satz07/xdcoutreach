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
- `POSTMARK_SERVER_TOKEN` — Postmark Server API token (HTTPS; required on Railway)
- `MAIL_PROVIDER` — `postmark` (default when token is set) or `smtp` for local Gmail
- `POSTMARK_MESSAGE_STREAM` — transactional stream, default `outbound`
- `POSTMARK_BROADCAST_STREAM` — bulk/marketing stream, default `broadcast` (create in Postmark if missing)
- `POSTMARK_BULK_CHUNK` — recipients per bulk request (default `500`, max `2000`)
- `BROADCAST_THRESHOLD` — use bulk/broadcast when recipient count ≥ this (default `2`)
- `MAX_RECIPIENTS_PER_SEND` — hard cap per campaign (default `10000`)
- `AUTO_SEND_BATCH` — pending emails per auto-send tick (default `20`)
- `AUTO_SEND_INTERVAL_MS` — ms between ticks (default `60000` = 1 min)
- `SMTP_FROM` — From address only (must be a verified Postmark sender)

### Auto-send (20/min)

1. History tab → **Start auto-send (20/min)** (any logged-in admin).
2. Server claims next 20 `pending` rows by ID, sends via Postmark, marks `sent`/`failed`.
3. State persists in `app_settings` and resumes after Railway restarts if left running.
4. **Stop auto-send** halts the timer immediately (in-flight batch still finishes).

### Bulk / broadcast sends

1. In Postmark → Message Streams, ensure a **Broadcast** stream exists (default name `broadcast`).
2. Set `POSTMARK_BROADCAST_STREAM=broadcast` on Railway.
3. Compose UI: paste emails or **Upload CSV/TXT**; 2+ recipients use Postmark Bulk API (`/email/bulk`), with automatic fallback to `/email/batch` if bulk is unavailable.
4. Logos in bulk emails use public `APP_URL/logos/…` URLs (set `APP_URL` to the Railway API URL).
5. Raise per-admin send limits in Users before large campaigns.

### Auth model

1. Only the superadmin and **invited** emails can access.
2. Superadmin invites an admin (with optional **email send limit**) → invite link to set password.
3. Admins sign in with **email + password** (no OTP).
4. Superadmin can change each admin's send limit anytime; sends are blocked when the cap is hit.
5. Admins cannot invite others.

### Vercel (UI)

- `VITE_API_URL` — public Railway API URL (no trailing slash), e.g. `https://api-production-df71.up.railway.app`
