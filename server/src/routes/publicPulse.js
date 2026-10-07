const express = require('express');
const pulse = require('../services/pulse');

const router = express.Router();

// Per-IP throttle: the link is unauthenticated, so cap how hard anyone can hit the summary queries.
const hits = new Map();
function throttled(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60 * 1000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 120;
}

router.use('/:token', async (req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;
  if (throttled(ip)) return res.status(429).json({ error: 'Too many requests, try again in a minute.' });
  try {
    if (!(await pulse.isValidShareToken(req.params.token))) {
      return res.status(404).json({ error: 'This link is invalid or has been reset.' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:token/meta', (_req, res) => {
  res.json({ taxonomy: pulse.TAXONOMY });
});

router.get('/:token/summary', async (req, res) => {
  try {
    const summary = await pulse.getSummary(req.query);
    summary.last_run = summary.last_run ? { finished_at: summary.last_run.finished_at } : null;
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: 'Could not load the dashboard.' });
  }
});

router.get('/:token/items', async (req, res) => {
  try {
    res.json(await pulse.listItems(req.query));
  } catch (err) {
    res.status(500).json({ error: 'Could not load mentions.' });
  }
});

router.get('/:token/brief', async (_req, res) => {
  try {
    const brief = await pulse.latestBrief();
    res.json({
      brief: brief && {
        content: brief.content,
        period_start: brief.period_start,
        period_end: brief.period_end,
        item_count: brief.item_count,
        created_at: brief.created_at,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not load the brief.' });
  }
});

module.exports = router;
