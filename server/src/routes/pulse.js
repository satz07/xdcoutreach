const express = require('express');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { aiConfigured } = require('../services/llm');
const pulse = require('../services/pulse');
const companyReport = require('../services/companyReport');

const router = express.Router();
router.use(requireAuth);

router.get('/meta', (_req, res) => {
  res.json({
    taxonomy: pulse.TAXONOMY,
    configured: aiConfigured(),
    youtube: Boolean(process.env.YOUTUBE_API_KEY),
  });
});

router.get('/summary', async (req, res) => {
  try {
    res.json(await pulse.getSummary(req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/items', async (req, res) => {
  try {
    res.json(await pulse.listItems(req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/brief', async (_req, res) => {
  try {
    res.json({ brief: await pulse.latestBrief() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/brief', requireSuperAdmin, async (req, res) => {
  try {
    const days = Number(req.body?.days) === 30 ? 30 : 7;
    res.json({ brief: await pulse.generateBrief({ days, userId: req.user?.id }) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/share', requireSuperAdmin, async (_req, res) => {
  try {
    res.json(await pulse.getShareToken());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/share/rotate', requireSuperAdmin, async (_req, res) => {
  try {
    res.json(await pulse.rotateShareToken());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/company-reports', async (_req, res) => {
  try {
    res.json({ reports: await companyReport.listReports() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/company-reports/:id', async (req, res) => {
  try {
    const report = await companyReport.getReport(Number(req.params.id));
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json({ report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Starts research in the background; the client polls GET /company-reports/:id until status is done or failed. */
router.post('/company-reports', requireSuperAdmin, async (req, res) => {
  if (!aiConfigured()) return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set on the server' });
  try {
    const { company, website, focus } = req.body || {};
    res.json({ report: await companyReport.startReport({ company, website, focus, userId: req.user?.id }) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Starts a collection run in the background; the dashboard polls /summary for `running`. */
router.post('/refresh', requireSuperAdmin, async (_req, res) => {
  if (!aiConfigured()) return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set on the server' });
  if (pulse.isRunning()) return res.json({ started: false, running: true });
  pulse
    .runPulse({ trigger: 'manual', force: true })
    .then((r) => r?.stats && console.log('pulse manual run', JSON.stringify(r.stats), `$${r.cost_usd}`))
    .catch((err) => console.warn('pulse manual run:', err.message));
  res.json({ started: true, running: true });
});

module.exports = router;
