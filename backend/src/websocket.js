'use strict';

const WebSocket = require('ws');

// Broadcast para todos
function broadcastUpdate(wss, type, payload) {
  if (!wss) return;
  const msg = JSON.stringify({ type, payload, ts: new Date().toISOString() });
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

// Broadcast apenas para clientes de um ambiente (prod/qa)
function broadcastEnv(wss, env, type, payload) {
  if (!wss) return;
  const msg = JSON.stringify({ type, env, payload, ts: new Date().toISOString() });
  let n = 0;
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN && (c.env || 'prod') === env) { c.send(msg); n++; }
  });
  console.log(`[WS:${env}] broadcast '${type}' -> ${n} cliente(s)`);
}

module.exports = { broadcastUpdate, broadcastEnv };
