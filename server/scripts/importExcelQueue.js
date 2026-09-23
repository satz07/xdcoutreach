#!/usr/bin/env node
/**
 * Wipe email_sends / email_campaigns and import unique emails from an xlsx as pending.
 *
 * Usage:
 *   DATABASE_URL=... node server/scripts/importExcelQueue.js /path/to/file.xlsx
 *
 * Or via Railway:
 *   railway run node server/scripts/importExcelQueue.js ~/Downloads/SatishEmailer.xlsx
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const xlsxPath = process.argv[2] || path.join(process.env.HOME || '', 'Downloads/SatishEmailer.xlsx');

async function loadEmails(filePath) {
  // Prefer python openpyxl via temp venv if available; else unzip XML parse is complex.
  // Use `xlsx` npm if present, otherwise spawn python.
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(filePath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    return extractFromRows(rows);
  } catch (_) {
    const { spawnSync } = require('child_process');
    const py = `
import re, json, sys
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1], read_only=True, data_only=True)
ws = wb[wb.sheetnames[0]]
email_re = re.compile(r'[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}', re.I)
seen=set(); out=[]
for row in ws.iter_rows(values_only=True):
    for cell in (row or []):
        if cell is None: continue
        for m in email_re.findall(str(cell)):
            e=m.lower()
            if e not in seen:
                seen.add(e); out.append(e)
print(json.dumps(out))
`;
    const venvPy = '/tmp/xlsx-venv/bin/python';
    const bin = fs.existsSync(venvPy) ? venvPy : 'python3';
    const r = spawnSync(bin, ['-c', py, filePath], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    if (r.status !== 0) {
      throw new Error(r.stderr || r.stdout || 'Failed to parse xlsx');
    }
    return JSON.parse(r.stdout);
  }
}

function extractFromRows(rows) {
  const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    for (const cell of row || []) {
      if (cell == null || cell === '') continue;
      const matches = String(cell).match(emailRe) || [];
      for (const m of matches) {
        const e = m.toLowerCase();
        if (seen.has(e)) continue;
        seen.add(e);
        out.push(e);
      }
    }
  }
  return out;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  if (!fs.existsSync(xlsxPath)) {
    console.error('File not found:', xlsxPath);
    process.exit(1);
  }

  console.log('Parsing', xlsxPath);
  const emails = await loadEmails(xlsxPath);
  console.log('Unique emails:', emails.length);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : undefined,
  });

  const client = await pool.connect();
  try {
    const tmpl = await client.query(
      `SELECT * FROM email_templates WHERE is_default = TRUE ORDER BY updated_at DESC LIMIT 1`
    );
    if (!tmpl.rows[0]) throw new Error('No default email template in DB');
    const subject = tmpl.rows[0].subject;
    const html = tmpl.rows[0].html_body;
    const eventId = tmpl.rows[0].event_id;
    const templateId = tmpl.rows[0].id;

    const user = await client.query(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [(process.env.SUPERADMIN_EMAIL || 'satheesh@xinfin.org').toLowerCase()]
    );
    const senderId = user.rows[0]?.id || null;

    await client.query('BEGIN');
    await client.query('DELETE FROM email_sends');
    await client.query('DELETE FROM email_campaigns');

    const campaign = await client.query(
      `INSERT INTO email_campaigns
        (event_id, template_id, subject, html_body, recipients_raw, total_recipients, status, sent_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)
       RETURNING id`,
      [eventId, templateId, subject, html, `${emails.length} imported from xlsx`, emails.length, senderId]
    );
    const campaignId = campaign.rows[0].id;

    const chunk = 200;
    for (let i = 0; i < emails.length; i += chunk) {
      const slice = emails.slice(i, i + chunk);
      const values = [];
      const params = [];
      let p = 1;
      for (const email of slice) {
        values.push(`($${p++},$${p++},$${p++},$${p++},$${p++},'pending',$${p++})`);
        params.push(campaignId, eventId, email, subject, html, senderId);
      }
      await client.query(
        `INSERT INTO email_sends
          (campaign_id, event_id, recipient_email, subject, html_body, status, sent_by_user_id)
         VALUES ${values.join(',')}`,
        params
      );
      process.stdout.write(`\rInserted ${Math.min(i + chunk, emails.length)}/${emails.length}`);
    }
    await client.query('COMMIT');
    console.log('\nDone. campaign_id=', campaignId);

    const counts = await pool.query(`SELECT status, COUNT(*)::int AS n FROM email_sends GROUP BY status`);
    console.log('Status counts:', Object.fromEntries(counts.rows.map((r) => [r.status, r.n])));
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
