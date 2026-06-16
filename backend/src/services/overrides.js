'use strict';

const { randomUUID } = require('crypto');
const { loadBase, loadOverrides, saveOverrides, shiftEndsAt, currentShift, SHIFT_LABEL, SHIFTS } = require('../state');
const { normalizeCell } = require('./rotation');

/**
 * Override = ajuste pontual do SL sobre a base, por (env, turno).
 * Expira no fim do turno corrente (não vaza para o turno/dia seguinte).
 */

function isActive(ov) {
  return !ov.expiresAt || new Date(ov.expiresAt) > new Date();
}

/** Aplica os overrides ativos sobre a base e retorna a rotação mesclada do turno. */
/** Mescla base + overrides de UM turno específico (sem fallback). */
function mergeShift(env, shift) {
  const base = loadBase(env, shift);
  const overrides = loadOverrides(env, shift).filter(isActive);
  const label = SHIFT_LABEL[shift] || null;
  const empty = !base.blocks || base.blocks.length === 0;

  if (empty || overrides.length === 0) {
    return { ...base, shift: base.shift || label, displayShift: shift, awaitingData: empty, overridesApplied: 0 };
  }

  const merged = structuredClone(base);
  let applied = 0;
  for (const ov of overrides) {
    const block = merged.blocks.find(b => b.id === ov.blockId) || merged.blocks.find(b => b.brand === ov.brand);
    if (!block) continue;
    const p = block.presenters.find(x =>
      (ov.nick && x.nick && x.nick.toLowerCase() === ov.nick.toLowerCase()) ||
      (ov.name && x.name && x.name.toLowerCase() === ov.name.toLowerCase())
    );
    if (!p) continue;
    if (ov.slotIndex < 0 || ov.slotIndex >= p.cells.length) continue;
    p.cells[ov.slotIndex] = { ...normalizeCell(ov.value), override: true };
    applied++;
  }
  merged.shift = merged.shift || label;
  merged.displayShift = shift;
  merged.awaitingData = false;
  merged.overridesApplied = applied;
  return merged;
}

/** Estado de todos os snapshots de turno (diagnóstico/observabilidade). */
function shiftsStatus(env = 'prod') {
  return SHIFTS.map(s => {
    const b = loadBase(env, s);
    const has = !!(b.blocks && b.blocks.length);
    const fb = has ? b.blocks[0] : null;
    return {
      shift: s,
      label: SHIFT_LABEL[s],
      hasData: has,
      blocks: has ? b.blocks.length : 0,
      firstSlot: fb && fb.slots ? fb.slots[0] : null,
      lastSlot: fb && fb.slots ? fb.slots[fb.slots.length - 1] : null,
      sheetShiftLabel: b.shift || null,
      lastUpdate: b.lastUpdate || null,
    };
  });
}

/**
 * Rotação que a TV exibe para o turno do relógio.
 * NUNCA mostra dados de outro turno (risco operacional: GP ir à mesa errada).
 * Se o turno atual está vazio, retorna o estado "aguardando" explícito.
 * Aceita override de turno (?shift=) para SIMULAÇÃO/teste de virada.
 */
function getMerged(env = 'prod', shift = null) {
  shift = shift || currentShift();
  return mergeShift(env, shift);
}

/** Cria/atualiza um override no turno corrente (mesmo bloco+nick+slot sobrescreve). */
function setOverride(env, shift, { blockId, brand, nick, name, slotIndex, value, by }) {
  shift = shift || currentShift();
  const list = loadOverrides(env, shift).filter(isActive);
  const filtered = list.filter(o => !((o.blockId || o.brand) === (blockId || brand) && o.nick === nick && o.slotIndex === slotIndex));
  const ov = {
    id: randomUUID(),
    blockId: blockId || brand, brand, nick, name, slotIndex: Number(slotIndex), value,
    by: by || 'sl',
    at: new Date().toISOString(),
    expiresAt: shiftEndsAt().toISOString(),
  };
  filtered.push(ov);
  if (!saveOverrides(env, shift, filtered)) throw new Error('Falha ao gravar o ajuste em disco');
  return ov;
}

function removeOverride(env, shift, id) {
  shift = shift || currentShift();
  const list = loadOverrides(env, shift).filter(isActive);
  if (!saveOverrides(env, shift, list.filter(o => o.id !== id))) throw new Error('Falha ao gravar em disco');
  return { removed: id };
}

function listOverrides(env, shift) {
  shift = shift || currentShift();
  return loadOverrides(env, shift).filter(isActive);
}

function clearOverrides(env, shift) {
  shift = shift || currentShift();
  saveOverrides(env, shift, []);
  return { cleared: true };
}

module.exports = { getMerged, mergeShift, shiftsStatus, setOverride, removeOverride, listOverrides, clearOverrides };
