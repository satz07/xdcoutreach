const express = require('express');
const hosting = require('../services/hosting');

const router = express.Router();

// The sponsor page is unauthenticated (the token is the key), so cap requests per IP.
const hits = new Map();
function throttled(ip, limit) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60 * 1000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > limit;
}

router.use((req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;
  if (throttled(ip, req.method === 'GET' ? 120 : 20)) {
    return res.status(429).json({ error: 'Too many requests, try again in a minute.' });
  }
  next();
});

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (!err.status) console.error('[sponsor page]', req.method, err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong. Please try again.' });
  }
};

router.get(
  '/:token',
  wrap(async (req, res) => {
    const view = await hosting.portalView(req.params.token);
    if (!view) return res.status(404).json({ error: 'This link is invalid or has been reset.' });
    res.json(view);
  })
);

router.post(
  '/:token/interest',
  wrap(async (req, res) => {
    await hosting.portalInterest(req.params.token, {
      packageId: req.body?.package_id,
      message: req.body?.message,
    });
    res.json({ ok: true });
  })
);

router.post(
  '/:token/invoices/:id/paid',
  wrap(async (req, res) => {
    await hosting.portalReportPayment(req.params.token, Number(req.params.id), { reference: req.body?.reference });
    res.json({ ok: true });
  })
);

router.patch(
  '/:token/deliverables/:id',
  wrap(async (req, res) => {
    const d = await hosting.portalUpdateDeliverable(req.params.token, Number(req.params.id), {
      link: req.body?.link,
      done: req.body?.done,
    });
    res.json({ ok: true, deliverable: { id: d.id, done: d.done, link: d.link } });
  })
);

router.get(
  '/:token/files/:id',
  wrap(async (req, res) => {
    const f = await hosting.portalFile(req.params.token, Number(req.params.id));
    if (!f) return res.status(404).json({ error: 'File not found' });
    res.set('Content-Type', f.mime);
    res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${f.filename}"`);
    res.send(f.data);
  })
);

module.exports = router;
