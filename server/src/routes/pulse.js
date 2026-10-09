const express = require('express');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { aiConfigured } = require('../services/llm');
const pulse = require('../services/pulse');
const companyReport = require('../services/companyReport');

const router = express.Router();
router.use(requireAuth);

router.get('/meta', async (req, res) => {
  try {
    const [entity, entities] = await Promise.all([pulse.getEntity(req.query.entity), pulse.listEntities()]);
    res.json({
      taxonomy: pulse.taxonomyFor(entity),
      entity,
      entities,
      configured: aiConfigured(),
      youtube: Boolean(process.env.YOUTUBE_API_KEY),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/entities', async (_req, res) => {
  try {
    res.json({ entities: await pulse.listEntities() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Start tracking a company; its first collection and brief run in the background. */
router.post('/entities', requireSuperAdmin, async (req, res) => {
  if (!aiConfigured()) return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set on the server' });
  try {
    const { name, aliases, website, description } = req.body || {};
    res.json({ entity: await pulse.addEntity({ name, aliases, website, description, userId: req.user?.id }) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/entities/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { name, aliases, website, description } = req.body || {};
    res.json({ entity: await pulse.updateEntity(Number(req.params.id), { name, aliases, website, description }) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/entities/:id', requireSuperAdmin, async (req, res) => {
  try {
    res.json(await pulse.removeEntity(Number(req.params.id)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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

router.get('/brief', async (req, res) => {
  try {
    const entity = await pulse.getEntity(req.query.entity);
    res.json({ brief: await pulse.latestBrief(entity?.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/brief', requireSuperAdmin, async (req, res) => {
  try {
    const days = Number(req.body?.days) === 30 ? 30 : 7;
    const entity = await pulse.getEntity(req.body?.entity);
    res.json({ brief: await pulse.generateBrief({ days, userId: req.user?.id, entityId: entity?.id }) });
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
router.post('/refresh', requireSuperAdmin, async (req, res) => {
  if (!aiConfigured()) return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set on the server' });
  const entity = await pulse.getEntity(req.body?.entity).catch(() => null);
  if (!entity) return res.status(404).json({ error: 'Company not found' });
  if (pulse.isRunning(entity.id)) return res.json({ started: false, running: true });
  pulse
    .runPulse({ entityId: entity.id, trigger: 'manual', force: true })
    .then((r) => r?.stats && console.log(`pulse manual run ${entity.name}`, JSON.stringify(r.stats), `$${r.cost_usd}`))
    .catch((err) => console.warn('pulse manual run:', err.message));
  res.json({ started: true, running: true });
});

module.exports = router;
