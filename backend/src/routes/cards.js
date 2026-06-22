'use strict';
/**
 * Rotas de cartões (FASE 2 — async, pois o service agora consulta o Postgres):
 *  - /api/cards/*  : gestão (admin)
 *  - /api/lookup   : consulta pública (terminais)
 */
const express = require('express');
const cards = require('../services/cards');
const { requireAuth, requireAdmin } = require('../auth/jwt');

// ---- Router de GESTÃO (admin) ----------------------------------------------
const adminRouter = express.Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get('/', async (req, res) => {
  try { res.json(await cards.listCards()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

adminRouter.post('/', async (req, res) => {
  try {
    const entry = await cards.upsertCard(req.body || {});
    res.json({ success: true, card: entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

adminRouter.delete('/:code', async (req, res) => {
  try {
    const r = await cards.removeCard(req.params.code);
    res.json({ success: true, ...r });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Router de CONSULTA (público) ------------------------------------------
const lookupRouter = express.Router();

lookupRouter.get('/', async (req, res) => {
  const code = (req.query.code || '').toString();
  if (!code.trim()) {
    return res.status(400).json({ ok: false, reason: 'no_code', message: 'Código vazio' });
  }
  const env = req.query.env === 'qa' ? 'qa' : 'prod';
  try {
    res.json(await cards.lookup(code, env));
  } catch (err) {
    console.error('[lookup]', err.message);
    res.status(500).json({ ok: false, reason: 'error', message: 'Erro na consulta' });
  }
});

module.exports = { adminRouter, lookupRouter };
