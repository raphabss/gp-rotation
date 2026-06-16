'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');

const ENVS = ['prod', 'qa'];
const SHIFTS = ['manha', 'tarde', 'noite'];
const SHIFT_LABEL = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' };

// Cortes de virada de turno (minutos desde 00:00):
//  06:45 -> manhã | 14:45 -> tarde | 22:45 -> noite (atravessa a meia-noite)
const CUT_MORNING = 6 * 60 + 45;
const CUT_AFTERNOON = 14 * 60 + 45;
const CUT_NIGHT = 22 * 60 + 45;

function currentShift(d = new Date()) {
  const m = d.getHours() * 60 + d.getMinutes();
  if (m >= CUT_MORNING && m < CUT_AFTERNOON) return 'manha';
  if (m >= CUT_AFTERNOON && m < CUT_NIGHT) return 'tarde';
  return 'noite'; // 22:45–23:59 e 00:00–06:44
}

// Momento em que o turno atual termina (próximo corte) — usado p/ expirar overrides.
function shiftEndsAt(d = new Date()) {
  const m = d.getHours() * 60 + d.getMinutes();
  const end = new Date(d);
  if (m >= CUT_MORNING && m < CUT_AFTERNOON) { end.setHours(14, 45, 0, 0); }
  else if (m >= CUT_AFTERNOON && m < CUT_NIGHT) { end.setHours(22, 45, 0, 0); }
  else { // noite: termina às 06:45 do próximo dia (se já passou da meia-noite, hoje)
    if (m >= CUT_NIGHT) { end.setDate(end.getDate() + 1); }
    end.setHours(6, 45, 0, 0);
  }
  return end;
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Turno que entra após o próximo corte (manha -> tarde -> noite -> manha).
function nextShiftKey(d = new Date()) {
  const cur = currentShift(d);
  return cur === 'manha' ? 'tarde' : cur === 'tarde' ? 'noite' : 'manha';
}

function baseFile(env, shift)      { return path.join(DATA_DIR, `rotation.${env}.${shift}.json`); }
function overridesFile(env, shift) { return path.join(DATA_DIR, `overrides.${env}.${shift}.json`); }

const EMPTY_BASE = { date: null, shift: null, source: null, lastUpdate: null, updatedBy: null, blocks: [], warnings: [] };

// ── Base (vinda do Graph), por (env, turno) ──────────────────────────────────
function loadBase(env = 'prod', shift = 'manha') {
  ensureDir();
  try {
    const f = baseFile(env, shift);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (err) { console.error(`[STATE:${env}:${shift}] erro load base:`, err.message); }
  return structuredClone(EMPTY_BASE);
}

function saveBase(env, shift, data) {
  ensureDir();
  try { fs.writeFileSync(baseFile(env, shift), JSON.stringify(data, null, 2), 'utf8'); return true; }
  catch (err) { console.error(`[STATE:${env}:${shift}] erro save base:`, err.message); return false; }
}

// ── Overrides (ajustes ao vivo do SL), por (env, turno) ──────────────────────
function loadOverrides(env = 'prod', shift = 'manha') {
  ensureDir();
  try {
    const f = overridesFile(env, shift);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (err) { console.error(`[STATE:${env}:${shift}] erro load overrides:`, err.message); }
  return [];
}

function saveOverrides(env, shift, list) {
  ensureDir();
  try { fs.writeFileSync(overridesFile(env, shift), JSON.stringify(list, null, 2), 'utf8'); return true; }
  catch (err) { console.error(`[STATE:${env}:${shift}] erro save overrides:`, err.message); return false; }
}

module.exports = {
  ENVS, SHIFTS, SHIFT_LABEL, DATA_DIR, EMPTY_BASE,
  currentShift, shiftEndsAt, nextShiftKey,
  loadBase, saveBase, loadOverrides, saveOverrides,
};
