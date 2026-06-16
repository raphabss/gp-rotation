'use strict';

const express = require('express');
const http = require('http');
const url = require('url');
const WebSocket = require('ws');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const { getMerged } = require('./services/overrides');
const { broadcastEnv } = require('./websocket');
const { currentShift } = require('./state');
const graphRouter = require('./routes/graph');
const { makeRouter } = require('./routes/rotation');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');

const app = express();
const server = http.createServer(app);

// ─── WebSocket (env-aware: /ws?env=qa) ───────────────────────────────────────
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const q = url.parse(req.url, true).query;
  ws.env = q.env === 'qa' ? 'qa' : 'prod';
  // envia o estado mesclado do ambiente do cliente
  ws.send(JSON.stringify({ type: 'ROTATION_UPDATE', env: ws.env, payload: getMerged(ws.env, currentShift()) }));
  ws.on('error', (err) => console.error('[WS] error:', err.message));
});

app.set('wss', wss);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use(morgan('combined'));

// ─── Static ──────────────────────────────────────────────────────────────────
const tvPath = process.env.TV_PATH || path.join(__dirname, '../frontend-tv');
const adminPath = process.env.ADMIN_PATH || path.join(__dirname, '../frontend-admin');
console.log(`[STATIC] TV: ${tvPath} (${fs.existsSync(tvPath)}) | Admin: ${adminPath} (${fs.existsSync(adminPath)})`);

if (fs.existsSync(tvPath)) {
  app.use('/tv', express.static(tvPath));
  app.use('/qa/tv', express.static(tvPath));   // mesma TV, ambiente qa (detectado no front)
}
if (fs.existsSync(adminPath)) {
  app.use('/admin', express.static(adminPath));
}

// ─── Auth & Users ──────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);

// ─── Rotation (prod + qa) ────────────────────────────────────────────────────
app.use('/api/rotation', makeRouter('prod'));
app.use('/api/qa/rotation', makeRouter('qa'));

// ─── Graph ─────────────────────────────────────────────────────────────────
app.use('/api/graph', graphRouter);

// ─── Health ────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const prod = getMerged('prod', currentShift());
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    connectedClients: wss.clients.size,
    prod: { date: prod.date, shift: prod.shift, blocks: (prod.blocks || []).length, overrides: prod.overridesApplied || 0 },
    version: '2.0.0',
  });
});

app.get('/', (req, res) => res.redirect('/tv'));

// ─── Sync: a cada 15s, mas só relê a planilha se ela MUDOU (lastModified) ─────
// Além disso, faz o broadcast na virada de turno (06:45/14:45/22:45) mesmo sem
// mudança na planilha, para a TV trocar de turno sozinha.
const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS || '15000', 10);
let _syncing = false;
let _lastModifiedSeen = null;
let _lastShiftBroadcast = null;

async function syncTick() {
  if (process.env.GRAPH_ENABLED !== 'true') return;
  if (_syncing) return;                 // evita sobreposição se um ciclo demorar
  _syncing = true;
  try {
    const graphService = require('./services/graph');

    // 1) Virada de turno: se o turno do relógio mudou, rebroadcast (TV vira sozinha)
    const sh = currentShift();
    if (sh !== _lastShiftBroadcast) {
      _lastShiftBroadcast = sh;
      for (const env of ['prod', 'qa']) {
        if (env === 'qa' && !process.env.GRAPH_SHEET_NAME_QA) continue;
        try { broadcastEnv(wss, env, 'ROTATION_UPDATE', getMerged(env, sh)); } catch (e) {}
      }
    }

    // 2) Releitura da planilha só quando ela mudou (checagem leve de metadados)
    let changed = true;
    try {
      const lm = await graphService.getFileLastModified();
      if (lm && lm === _lastModifiedSeen) changed = false;
      else _lastModifiedSeen = lm;
    } catch (e) {
      // se a checagem leve falhar, cai pro comportamento de sincronizar mesmo assim
      changed = true;
    }
    if (!changed) return;

    for (const env of ['prod', 'qa']) {
      if (env === 'qa' && !process.env.GRAPH_SHEET_NAME_QA) continue;
      try { await graphService.syncFromSharePoint(wss, env); }
      catch (err) { console.error(`[SYNC:${env}]`, err.message); }
    }
  } finally {
    _syncing = false;
  }
}
setInterval(syncTick, SYNC_INTERVAL_MS);

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎰 GP Rotation Server v2 na porta ${PORT}`);
  console.log(`   TV prod  → /tv        | TV qa → /qa/tv`);
  console.log(`   Admin    → /admin`);
  console.log(`   API prod → /api/rotation | qa → /api/qa/rotation\n`);
});

module.exports = { app, server, wss };
