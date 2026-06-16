'use strict';

const express = require('express');
const router = express.Router();
const graph = require('../services/graph');

const enabled = () => process.env.GRAPH_ENABLED === 'true';

// GET /api/graph/status
router.get('/status', async (req, res) => {
  if (!enabled()) return res.json({ enabled: false, message: 'Defina GRAPH_ENABLED=true para ativar.' });
  try { await graph.getToken(); res.json({ enabled: true, status: 'connected' }); }
  catch (err) { res.status(503).json({ enabled: true, status: 'error', message: err.message }); }
});

// GET /api/graph/worksheets
router.get('/worksheets', async (req, res) => {
  if (!enabled()) return res.status(400).json({ error: 'Graph desativado' });
  try { res.json({ worksheets: await graph.listWorksheets() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/graph/findfile
router.get('/findfile', async (req, res) => {
  if (!enabled()) return res.status(400).json({ error: 'Graph desativado' });
  try { res.json(await graph.findFile()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/graph/diag
router.get('/diag', async (req, res) => {
  if (!enabled()) return res.status(400).json({ error: 'Graph desativado' });
  try { res.json(await graph.diagnose()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/graph/preview?sheet=&pos=&last=&raw=&env=
router.get('/preview', async (req, res) => {
  if (!enabled()) return res.status(400).json({ error: 'Graph desativado' });
  try {
    res.json(await graph.previewRotation({
      sheet: req.query.sheet, pos: req.query.pos, last: req.query.last,
      raw: req.query.raw, env: req.query.env,
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/graph/sync?env=prod|qa
router.post('/sync', async (req, res) => {
  if (!enabled()) return res.status(400).json({ error: 'Graph desativado' });
  try {
    res.json({ success: true, result: await graph.syncFromSharePoint(req.app.get('wss'), req.query.env || 'prod') });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
