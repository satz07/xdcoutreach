const { pool } = require('../db/pool');

const FIELD_RE = /[ \t]*\{\{\s*(first_name|name|company)\s*\}\}/gi;
const TITLES = /^(mr|mrs|ms|miss|dr|prof|shri|smt|sri)\.?$/i;

function hasMergeFields(s) {
  return /\{\{\s*(first_name|name|company)\s*\}\}/i.test(String(s || ''));
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function firstNameOf(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  while (parts.length > 1 && TITLES.test(parts[0])) parts.shift();
  const first = parts[0] || '';
  // An email-looking or single-letter "name" is worse than no name.
  if (!first || first.includes('@') || first.length < 2) return '';
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** Name/company for a recipient: this event's participant row first, then any event that has a name. */
async function recipientFields(eventId, email) {
  const { rows } = await pool.query(
    `SELECT name, company FROM event_participants
     WHERE LOWER(email) = LOWER($2)
     ORDER BY (event_id = $1) DESC, (NULLIF(TRIM(name), '') IS NOT NULL) DESC, updated_at DESC
     LIMIT 1`,
    [eventId || 0, email]
  );
  const name = String(rows[0]?.name || '').trim();
  return { name, first_name: firstNameOf(name), company: String(rows[0]?.company || '').trim() };
}

/**
 * Replace {{first_name}} / {{name}} / {{company}}. Missing values are removed together with the
 * preceding space, so "નમસ્કાર {{first_name}}," becomes "નમસ્કાર," rather than "નમસ્કાર ,".
 */
function applyMergeFields(s, fields = {}, { html = false } = {}) {
  if (!s) return s;
  return String(s).replace(FIELD_RE, (match, key) => {
    const value = fields[key.toLowerCase()];
    if (!value) return '';
    const lead = match.match(/^[ \t]*/)[0];
    return lead + (html ? escHtml(value) : value);
  });
}

module.exports = { hasMergeFields, recipientFields, applyMergeFields, firstNameOf };
