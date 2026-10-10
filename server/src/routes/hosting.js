const express = require('express');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const hosting = require('../services/hosting');

const router = express.Router();
router.use(requireAuth);

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (!err.status) console.error('[hosting]', req.method, req.path, err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
};

const id = (req, key = 'id') => Number(req.params[key]);

router.get(
  '/events',
  wrap(async (_req, res) => {
    res.json({ events: await hosting.listEvents(), statuses: hosting.EVENT_STATUSES });
  })
);

router.post(
  '/events',
  wrap(async (req, res) => {
    const event = await hosting.createEvent(req.body || {}, req.user.id);
    res.json({ ok: true, event });
  })
);

router.get(
  '/events/:id',
  wrap(async (req, res) => {
    res.json(await hosting.eventOverview(id(req)));
  })
);

router.patch(
  '/events/:id',
  wrap(async (req, res) => {
    res.json({ ok: true, event: await hosting.updateEvent(id(req), req.body || {}) });
  })
);

router.delete(
  '/events/:id',
  requireSuperAdmin,
  wrap(async (req, res) => {
    await hosting.deleteEvent(id(req));
    res.json({ ok: true });
  })
);

router.post(
  '/events/:id/prospectus',
  wrap(async (req, res) => {
    res.json({ ok: true, file: await hosting.setProspectus(id(req), req.body?.file, req.user.id) });
  })
);

router.delete(
  '/events/:id/prospectus',
  wrap(async (req, res) => {
    await hosting.removeProspectus(id(req));
    res.json({ ok: true });
  })
);

router.post(
  '/events/:id/packages',
  wrap(async (req, res) => {
    res.json({ ok: true, package: await hosting.createPackage(id(req), req.body || {}) });
  })
);

router.patch(
  '/packages/:id',
  wrap(async (req, res) => {
    res.json({ ok: true, package: await hosting.updatePackage(id(req), req.body || {}) });
  })
);

router.delete(
  '/packages/:id',
  wrap(async (req, res) => {
    await hosting.deletePackage(id(req));
    res.json({ ok: true });
  })
);

/** POST /events/:id/sponsors { sponsors: [{ company, contact_name, contact_email, package_id, amount, ... }] } */
router.post(
  '/events/:id/sponsors',
  wrap(async (req, res) => {
    const list = Array.isArray(req.body?.sponsors) ? req.body.sponsors : [req.body || {}];
    const ids = await hosting.createSponsors(id(req), list, req.user.id);
    res.json({ ok: true, created: ids.length, ids, skipped: list.length - ids.length });
  })
);

router.post(
  '/events/:id/invite/preview',
  wrap(async (req, res) => {
    const ev = await hosting.getEvent(id(req));
    const s = await hosting.getSponsor(Number(req.body?.sponsor_id));
    if (s.event_id !== ev.id) return res.status(400).json({ error: 'Sponsor is not in this event' });
    res.json(hosting.renderInvite(ev, s, { subject: req.body?.subject, body: req.body?.body, user: req.user }));
  })
);

router.post(
  '/events/:id/invite',
  wrap(async (req, res) => {
    const b = req.body || {};
    const out = await hosting.sendInvites(
      id(req),
      {
        sponsorIds: Array.isArray(b.sponsor_ids) ? b.sponsor_ids : [],
        subject: b.subject,
        body: b.body,
        attachProspectus: b.attach_prospectus !== false,
        saveAsDefault: Boolean(b.save_as_default),
      },
      req.user
    );
    res.json({ ok: true, ...out });
  })
);

router.get(
  '/sponsors/:id',
  wrap(async (req, res) => {
    res.json(await hosting.sponsorDetail(id(req)));
  })
);

router.patch(
  '/sponsors/:id',
  wrap(async (req, res) => {
    res.json({ ok: true, sponsor: await hosting.updateSponsor(id(req), req.body || {}, req.user.id) });
  })
);

router.delete(
  '/sponsors/:id',
  wrap(async (req, res) => {
    await hosting.deleteSponsor(id(req));
    res.json({ ok: true });
  })
);

router.post(
  '/sponsors/:id/notes',
  wrap(async (req, res) => {
    await hosting.addNote(id(req), req.body?.body, req.user.id);
    res.json({ ok: true });
  })
);

router.post(
  '/sponsors/:id/portal/reset',
  wrap(async (req, res) => {
    res.json({ ok: true, sponsor: await hosting.rotatePortal(id(req), req.user.id) });
  })
);

router.post(
  '/sponsors/:id/deliverables',
  wrap(async (req, res) => {
    if (req.body?.defaults) {
      return res.json({ ok: true, added: await hosting.addDefaultDeliverables(id(req), req.user.id) });
    }
    res.json({ ok: true, id: await hosting.addDeliverable(id(req), req.body || {}, req.user.id) });
  })
);

router.patch(
  '/deliverables/:id',
  wrap(async (req, res) => {
    res.json({
      ok: true,
      deliverable: await hosting.updateDeliverable(id(req), req.body || {}, { userId: req.user.id }),
    });
  })
);

router.delete(
  '/deliverables/:id',
  wrap(async (req, res) => {
    await hosting.deleteDeliverable(id(req));
    res.json({ ok: true });
  })
);

router.post(
  '/sponsors/:id/invoices',
  wrap(async (req, res) => {
    const invoice = await hosting.createInvoice(id(req), req.body || {}, req.user.id);
    if (req.body?.send) {
      return res.json({ ok: true, invoice: await hosting.sendInvoice(invoice.id, { message: req.body.message }, req.user) });
    }
    res.json({ ok: true, invoice });
  })
);

router.patch(
  '/invoices/:id',
  wrap(async (req, res) => {
    res.json({ ok: true, invoice: await hosting.updateInvoice(id(req), req.body || {}, req.user.id) });
  })
);

router.post(
  '/invoices/:id/send',
  wrap(async (req, res) => {
    const invoice = await hosting.sendInvoice(
      id(req),
      { message: req.body?.message, reminder: Boolean(req.body?.reminder) },
      req.user
    );
    res.json({ ok: true, invoice });
  })
);

router.delete(
  '/invoices/:id',
  wrap(async (req, res) => {
    await hosting.deleteInvoice(id(req), req.user.id);
    res.json({ ok: true });
  })
);

router.get(
  '/files/:id',
  wrap(async (req, res) => {
    const f = await hosting.getFile(id(req));
    if (!f) return res.status(404).json({ error: 'File not found' });
    res.set('Content-Type', f.mime);
    res.set('Content-Disposition', `inline; filename="${f.filename}"`);
    res.send(f.data);
  })
);

module.exports = router;
