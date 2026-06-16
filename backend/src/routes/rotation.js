'use strict';

const express = require('express');
const overrides = require('../services/overrides');
const { requireAuth } = require('../auth/jwt');
const { broadcastEnv } = require('../websocket');
const { currentShift, shiftEndsAt, nextShiftKey } = require('../state');

// Cria um router para um ambiente específico (prod ou qa)
function makeRouter(env) {
  const router = express.Router();

  const SHIFTS = ['manha', 'tarde', 'noite'];

  // GET / — rotação MESCLADA (base + overrides) — consumida pela TV.
  // ?shift=manha|tarde|noite força um turno (SIMULAÇÃO de virada para teste).
  router.get('/', (req, res) => {
    const forced = SHIFTS.includes(req.query.shift) ? req.query.shift : null;
    res.json(overrides.getMerged(env, forced || currentShift()));
  });

  // GET /shifts — diagnóstico: estado dos 3 snapshots + turno atual/seguinte/corte
  router.get('/shifts', (req, res) => {
    const now = new Date();
    const cutoff = shiftEndsAt(now);
    res.json({
      now: now.toISOString(),
      currentShift: currentShift(now),
      nextShift: nextShiftKey(now),
      nextCutoff: cutoff.toISOString(),
      secondsToNextCutoff: Math.max(0, Math.round((cutoff - now) / 1000)),
      shifts: overrides.shiftsStatus(env),
    });
  });

  // GET /overrides — lista ajustes ativos
  router.get('/overrides', (req, res) => res.json(overrides.listOverrides(env, currentShift())));

  // POST /override — cria/atualiza ajuste (exige login + permissão de editar)
  router.post('/override', requireAuth, (req, res) => {
    if (!req.permissions.canEditRotation) return res.status(403).json({ error: 'Sem permissão para editar' });
    const { blockId, brand, nick, name, slotIndex, value } = req.body || {};
    if (!brand || slotIndex === undefined || value === undefined) {
      return res.status(400).json({ error: 'brand, slotIndex e value são obrigatórios' });
    }
    const sh = currentShift();
    const ov = overrides.setOverride(env, sh, { blockId, brand, nick, name, slotIndex, value, by: req.user.username });
    broadcastEnv(req.app.get('wss'), env, 'ROTATION_UPDATE', overrides.getMerged(env, sh));
    res.json({ success: true, override: ov });
  });

  // DELETE /override/:id — remove um ajuste (volta ao valor da planilha)
  router.delete('/override/:id', requireAuth, (req, res) => {
    if (!req.permissions.canEditRotation) return res.status(403).json({ error: 'Sem permissão' });
    overrides.removeOverride(env, currentShift(), req.params.id);
    broadcastEnv(req.app.get('wss'), env, 'ROTATION_UPDATE', overrides.getMerged(env, currentShift()));
    res.json({ success: true });
  });

  // POST /overrides/clear — limpa todos os ajustes do ambiente (admin/sl)
  router.post('/overrides/clear', requireAuth, (req, res) => {
    if (!req.permissions.canEditRotation) return res.status(403).json({ error: 'Sem permissão' });
    overrides.clearOverrides(env, currentShift());
    broadcastEnv(req.app.get('wss'), env, 'ROTATION_UPDATE', overrides.getMerged(env, currentShift()));
    res.json({ success: true });
  });

  return router;
}

module.exports = { makeRouter };
