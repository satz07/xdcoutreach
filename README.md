# Email Agent — XDC Network & Contour

Event invitation email sender with editable templates, multi-recipient sending, PostgreSQL send history, and resend. Built for Sibos 2026 and reusable for future events.

## Stack

- **Backend:** Node.js, Express, Nodemailer
- **Frontend:** React + Vite
- **Database:** PostgreSQL
- **SMTP:** Gmail (`smtp.gmail.com:587`)

## Setup

### 1. PostgreSQL

Using local Postgres (already running):

```bash
createdb email_agent
```

Or with Docker:

```bash
docker compose up -d
# then set DATABASE_URL=postgresql://emailagent:emailagent@localhost:5432/email_agent
```

### 2. Environment

Copy `.env.example` → `.env` and fill SMTP + database values. A working `.env` is already present for local use.

### 3. Install & run

```bash
npm run install:all
node server/scripts/generateLogos.js
npm run dev
```

- UI: http://localhost:5173  
- API: http://localhost:5050  

## Features

- Edit subject and full Sibos invitation content (headline, paragraphs, topics, CTA)
- Live HTML preview with XDC + Contour logos
- Send to any number of recipients (comma / semicolon / newline separated)
- Save template updates to Postgres for reuse
- Send history: who, when, status, errors
- Resend single or selected rows
- Add future events (name, location, dates)

## Production

```bash
npm run build
npm start
```

Serves the built React app from the Express server on `PORT`.

## Security note

Do not commit `.env`. The Gmail app password is sensitive — rotate it if it was shared in chat or committed to a remote repo.
