'use strict';

const express = require('express');
const router = express.Router();
const { loadState, saveState, addHistoryEntry } = require('../state');
const { broadcastUpdate } = require('../websocket');

/**
 * POST /api/webhook/sharepoint
 * Called by Power Automate when the SharePoint spreadsheet is updated.
 * 
 * Expected payload:
 * {
 *   secret: "WEBHOOK_SECRET",
 *   shift: "A",
 *   shiftLabel: "Turno A - Manhã",
 *   updatedBy: "joao.silva@spingaming.com.br",
 *   assignments: [
 *     { tableName: "Mesa 01", gp: "Ana Paula", game: "Baccarat" },
 *     { tableName: "Mesa 02", gp: "Carlos Mendes", game: "Roulette" },
 *     ...
 *   ]
 * }
 */
router.post('/sharepoint', (req, res) => {
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'spingaming-2024';

  // Validate secret
  if (req.body.secret !== WEBHOOK_SECRET) {
    console.warn('[WEBHOOK] Unauthorized attempt from', req.ip);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { assignments, shift, shiftLabel, updatedBy } = req.body;

  if (!Array.isArray(assignments) || assignments.length === 0) {
    return res.status(400).json({ error: 'assignments array is required' });
  }

  console.log(`[WEBHOOK] Received update from Power Automate — ${assignments.length} assignment(s) — by ${updatedBy}`);

  const state = loadState();

  if (shift) state.shift = shift;
  if (shiftLabel) state.shiftLabel = shiftLabel;

  const updated = [];
  const notFound = [];

  for (const assignment of assignments) {
    // Match by ID or name (case-insensitive)
    const table = state.tables.find(t =>
      t.id === assignment.tableId ||
      t.name?.toLowerCase() === assignment.tableName?.toLowerCase()
    );

    if (table) {
      table.gp = assignment.gp || null;
      table.status = assignment.gp ? 'occupied' : 'empty';
      table.updatedAt = new Date().toISOString();
      if (assignment.game) table.game = assignment.game;
      updated.push(table.id);
    } else {
      notFound.push(assignment.tableName || assignment.tableId);
    }
  }

  state.lastUpdate = new Date().toISOString();
  state.updatedBy = updatedBy || 'power-automate';

  addHistoryEntry(state, 'WEBHOOK_UPDATE', {
    source: 'sharepoint',
    updatedCount: updated.length,
    notFound,
    updatedBy: state.updatedBy
  });

  saveState(state);

  const wss = req.app.get('wss');
  broadcastUpdate(wss, 'FULL_STATE', state);

  console.log(`[WEBHOOK] Updated ${updated.length} tables. Not found: ${notFound.join(', ') || 'none'}`);

  res.json({
    success: true,
    updated: updated.length,
    notFound,
    timestamp: state.lastUpdate
  });
});

/**
 * GET /api/webhook/test
 * Used by Power Automate for initial connection validation
 */
router.get('/test', (req, res) => {
  res.json({ status: 'GP Rotation Webhook OK', ts: new Date().toISOString() });
});

module.exports = router;
