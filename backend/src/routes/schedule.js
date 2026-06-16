'use strict';

const express = require('express');
const router = express.Router();
const { loadState, saveState, addHistoryEntry } = require('../state');
const { broadcastUpdate } = require('../websocket');

// GET /api/schedule — full state
router.get('/', (req, res) => {
  const state = loadState();
  res.json(state);
});

// GET /api/schedule/tables — just the tables
router.get('/tables', (req, res) => {
  const state = loadState();
  res.json(state.tables);
});

// PUT /api/schedule/tables/:tableId — assign GP to table
router.put('/tables/:tableId', (req, res) => {
  const { tableId } = req.params;
  const { gp, status, game } = req.body;
  const updatedBy = req.body.updatedBy || 'admin';

  const state = loadState();
  const table = state.tables.find(t => t.id === tableId);

  if (!table) {
    return res.status(404).json({ error: `Table ${tableId} not found` });
  }

  const previous = { gp: table.gp, status: table.status };

  if (gp !== undefined) table.gp = gp || null;
  if (status !== undefined) table.status = status;
  if (game !== undefined) table.game = game;

  // Mark as updated briefly for visual highlight on TV
  table.updatedAt = new Date().toISOString();

  state.lastUpdate = new Date().toISOString();
  state.updatedBy = updatedBy;

  addHistoryEntry(state, 'TABLE_UPDATE', {
    tableId,
    previous,
    current: { gp: table.gp, status: table.status },
    updatedBy
  });

  saveState(state);

  const wss = req.app.get('wss');
  broadcastUpdate(wss, 'TABLE_UPDATE', {
    tableId,
    table,
    updatedBy,
    timestamp: state.lastUpdate
  });

  res.json({ success: true, table });
});

// POST /api/schedule/tables/bulk — update multiple tables at once (Power Automate)
router.post('/tables/bulk', (req, res) => {
  const { assignments, shift, shiftLabel, updatedBy } = req.body;

  if (!Array.isArray(assignments)) {
    return res.status(400).json({ error: 'assignments must be an array' });
  }

  const state = loadState();

  if (shift) state.shift = shift;
  if (shiftLabel) state.shiftLabel = shiftLabel;

  const updated = [];
  for (const assignment of assignments) {
    const table = state.tables.find(t => t.id === assignment.tableId || t.name === assignment.tableName);
    if (table) {
      table.gp = assignment.gp || null;
      table.status = assignment.gp ? 'occupied' : 'empty';
      table.updatedAt = new Date().toISOString();
      if (assignment.game) table.game = assignment.game;
      updated.push(table.id);
    }
  }

  state.lastUpdate = new Date().toISOString();
  state.updatedBy = updatedBy || 'bulk-update';

  addHistoryEntry(state, 'BULK_UPDATE', {
    count: updated.length,
    tableIds: updated,
    updatedBy: state.updatedBy
  });

  saveState(state);

  const wss = req.app.get('wss');
  broadcastUpdate(wss, 'FULL_STATE', state);

  res.json({ success: true, updated });
});

// POST /api/schedule/shift — change active shift info
router.post('/shift', (req, res) => {
  const { shift, shiftLabel, updatedBy } = req.body;
  const state = loadState();

  if (shift) state.shift = shift;
  if (shiftLabel) state.shiftLabel = shiftLabel;
  state.lastUpdate = new Date().toISOString();
  state.updatedBy = updatedBy || 'admin';

  saveState(state);

  const wss = req.app.get('wss');
  broadcastUpdate(wss, 'SHIFT_UPDATE', { shift: state.shift, shiftLabel: state.shiftLabel });

  res.json({ success: true, shift: state.shift, shiftLabel: state.shiftLabel });
});

// GET /api/schedule/presenters
router.get('/presenters', (req, res) => {
  const state = loadState();
  res.json(state.presenters || []);
});

// POST /api/schedule/presenters — add/update presenter list
router.post('/presenters', (req, res) => {
  const { presenters } = req.body;
  if (!Array.isArray(presenters)) {
    return res.status(400).json({ error: 'presenters must be an array' });
  }

  const state = loadState();
  state.presenters = presenters;
  saveState(state);

  const wss = req.app.get('wss');
  broadcastUpdate(wss, 'PRESENTERS_UPDATE', { presenters });

  res.json({ success: true, count: presenters.length });
});

// GET /api/schedule/history
router.get('/history', (req, res) => {
  const state = loadState();
  const limit = parseInt(req.query.limit) || 50;
  const history = (state.history || []).slice(-limit).reverse();
  res.json(history);
});

// POST /api/schedule/reset — clear all GP assignments
router.post('/reset', (req, res) => {
  const { updatedBy } = req.body;
  const state = loadState();

  state.tables.forEach(t => {
    t.gp = null;
    t.status = 'empty';
    t.updatedAt = new Date().toISOString();
  });

  state.lastUpdate = new Date().toISOString();
  state.updatedBy = updatedBy || 'admin';

  addHistoryEntry(state, 'RESET', { updatedBy: state.updatedBy });
  saveState(state);

  const wss = req.app.get('wss');
  broadcastUpdate(wss, 'FULL_STATE', state);

  res.json({ success: true });
});

module.exports = router;
