'use strict';

/**
 * Parser da matriz de rotação de GPs.
 *
 * A planilha diária tem blocos empilhados (CDA, BLAZE, Shufflers...), cada um:
 *   [data/turno] [MARCA] [07:00] [07:30] ... [14:30]      <- linha de cabeçalho
 *   [Nome Real]  [Nick]  [B]     [6134]  ... [6132]       <- linha de GP
 *   ...
 *   6131 e 6132                                            <- linha de nota (ignorada)
 *
 * Estratégia robusta: as colunas de horário são detectadas pela posição das
 * células HH:MM no cabeçalho. Os valores de cada GP sao lidos EXATAMENTE nas
 * mesmas colunas — assim nao dependemos de "pular N colunas", o que evita
 * desalinhamento quando ha celulas mescladas ou metadados extras.
 */

const BRAND_KEYWORDS = ['CDA', 'BLAZE', 'SHUFFLERS', 'SHUFFLER', 'SPORTSCLUB', 'SPORTS', 'GOAL', 'GOAT', 'VIP'];
const SHIFT_KEYWORDS = [
  { re: /manh[aã]/i, label: 'Manhã' },
  { re: /tarde/i,    label: 'Tarde' },
  { re: /noite/i,    label: 'Noite' },
];

const TIME_RE = /^\d{1,2}:\d{2}$/;
const TABLE_RE = /^61\d{2}$/;
const NOTE_RE = /^\s*\d{3,4}\s*(e|-|,)\s*\d{3,4}/i;       // "6131 e 6132"
const MODEL_RE = /^\s*modelo\s+com/i;                     // "Modelo com 12 Pessoas"
const ROTATION_HDR_RE = /rota[cç][aã]o/i;

function s(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

function stripAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Detecta a marca presente numa linha de cabeçalho. */
function detectBrand(row) {
  for (const cell of row) {
    const up = stripAccents(s(cell)).toUpperCase();
    for (const kw of BRAND_KEYWORDS) {
      if (up === kw || up.includes(kw)) return normalizeBrand(kw);
    }
  }
  return null;
}

function normalizeBrand(kw) {
  const map = {
    CDA: 'CDA',
    BLAZE: 'BLAZE',
    SHUFFLER: 'Shufflers',
    SHUFFLERS: 'Shufflers',
    SPORTS: 'Sports Club',
    SPORTSCLUB: 'Sports Club',
    GOAL: 'Goal',
    GOAT: 'Goal',
    VIP: 'VIP',
  };
  return map[kw] || kw;
}

function detectShift(row) {
  const text = row.map(s).join(' ');
  for (const { re, label } of SHIFT_KEYWORDS) {
    if (re.test(text)) return label;
  }
  return null;
}

function detectDate(row) {
  const text = row.map(s).join(' ');
  const m = text.match(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/);
  if (m) return m[0];
  return null;
}

/** Índices das colunas que contêm horários (HH:MM) no cabeçalho. */
function findSlotColumns(row) {
  const cols = [];
  row.forEach((cell, idx) => {
    if (TIME_RE.test(s(cell))) cols.push(idx);
  });
  return cols;
}

/** Uma linha é cabeçalho de bloco se tem >=2 horários E uma marca. */
function isBlockHeader(row) {
  const slotCols = findSlotColumns(row);
  if (slotCols.length < 2) return false;
  return detectBrand(row) !== null;
}

/**
 * Uma linha "parece" cabeçalho de bloco quando contém a palavra do turno
 * (Manhã/Tarde/Noite). Esse sinal só aparece nos cabeçalhos — linhas de GP,
 * notas e células multi-mesa ("6131/6132") não o têm — então é seguro para
 * distinguir um cabeçalho MAL PREENCHIDO (que falhou em isBlockHeader) de uma
 * linha comum. Usado para transformar erro silencioso em warning visível.
 */
function looksLikeHeaderRow(row) {
  return detectShift(row) !== null;
}

/** Linha de nota/legenda que deve ser ignorada. */
function isNoteRow(row) {
  const first = s(row[0]);
  if (!first) {
    const hasRotationData = row.some(c => {
      const t = normalizeCell(c).type;
      return t === 'table' || t === 'break' || t === 'off' || t === 'all';
    });
    return !hasRotationData;
  }
  if (NOTE_RE.test(first)) return true;
  if (MODEL_RE.test(first)) return true;
  return false;
}

/** Normaliza o valor de uma célula de slot. */
function normalizeCell(value) {
  const v = s(value);
  if (v === '') return { type: 'empty' };
  const up = stripAccents(v).toUpperCase();
  if (up === 'B') return { type: 'break' };
  if (up === 'X') return { type: 'off' };
  if (up === 'ALL') return { type: 'all' };
  if (TABLE_RE.test(v)) return { type: 'table', table: v };
  {
    const parts = v.split(/\s*(?:\/|,|;|\be\b|\s)+\s*/i).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2 && parts.every(p => TABLE_RE.test(p))) {
      return { type: 'tables', tables: parts };
    }
  }
  for (const kw of ['BLAZE', 'CDA']) {
    if (up === kw) return { type: 'provider', value: normalizeBrand(kw) };
  }
  return { type: 'text', value: v };
}

function parseRotation(values, meta = {}) {
  if (!Array.isArray(values) || values.length === 0) {
    return { date: meta.date || null, shift: meta.shift || null, blocks: [], warnings: ['Planilha vazia'] };
  }

  const blocks = [];
  const warnings = [];
  let globalDate = meta.date || null;
  let globalShift = meta.shift || null;

  let i = 0;
  while (i < values.length) {
    const row = values[i] || [];

    if (isBlockHeader(row)) {
      const brand = detectBrand(row);
      const slotCols = findSlotColumns(row);
      const slots = slotCols.map(c => s(row[c]));
      const shift = detectShift(row) || globalShift;
      const date = detectDate(row) || globalDate;
      if (shift && !globalShift) globalShift = shift;
      if (date && !globalDate) globalDate = date;

      const firstSlotCol = slotCols[0];
      const nameCol = firstSlotCol - 2;
      const nickCol = firstSlotCol - 1;
      const effectiveCols = slotCols;

      const presenters = [];
      let j = i + 1;
      while (j < values.length) {
        const r = values[j] || [];
        if (isBlockHeader(r) || looksLikeHeaderRow(r)) break;
        if (isNoteRow(r)) { j++; continue; }

        const name = nameCol >= 0 ? s(r[nameCol]) : s(r[0]);
        const nick = nickCol >= 0 ? s(r[nickCol]) : s(r[1]);
        const cells = effectiveCols.map(c => normalizeCell(r[c]));
        const hasData = cells.some(c => c.type !== 'empty');

        if (!name && !nick && !hasData) { j++; continue; }

        presenters.push({ name, nick, cells });
        j++;
      }

      if (brand === 'Shufflers') {
        for (const p of presenters) {
          let first = -1, last = -1;
          p.cells.forEach((c, idx) => { if (c.type !== 'empty') { if (first < 0) first = idx; last = idx; } });
          if (first >= 0) {
            for (let idx = first; idx <= last; idx++) {
              if (p.cells[idx].type === 'empty') p.cells[idx] = { type: 'todo', inferred: true };
            }
          }
        }
      }

      blocks.push({ brand, shift, date, slots, presenters });
      i = j;
    } else if (looksLikeHeaderRow(row)) {
      // A linha parece cabeçalho (tem turno) mas NÃO virou bloco válido.
      // Em vez de anexar as GPs ao bloco anterior (falha silenciosa que já
      // sumiu com tabelas), registramos um aviso claro e visível.
      const b = detectBrand(row);
      const nSlots = findSlotColumns(row).length;
      let msg;
      if (b && nSlots < 2) {
        msg = 'Tabela "' + b + '" não apareceu: a linha de HORÁRIOS do cabeçalho não está preenchida na planilha (esperado 00:00). Corrija a planilha.';
      } else if (!b && nSlots >= 2) {
        msg = 'Uma tabela não apareceu: o NOME do estúdio no cabeçalho não foi reconhecido — confira a grafia na planilha.';
      } else {
        msg = 'Cabeçalho de tabela incompleto na planilha (nome do estúdio e/ou horários ausentes). Corrija a planilha.';
      }
      warnings.push(msg);
      i++;
    } else {
      i++;
    }
  }

  if (blocks.length === 0) warnings.push('Nenhum bloco de rotação detectado — verificar layout da planilha');

  const brandSeq = {};
  for (const blk of blocks) {
    brandSeq[blk.brand] = (brandSeq[blk.brand] || 0) + 1;
    blk.id = brandSeq[blk.brand] > 1 ? blk.brand + '-' + brandSeq[blk.brand] : blk.brand;
  }

  return {
    date: globalDate,
    shift: globalShift,
    blocks,
    warnings,
    parsedAt: new Date().toISOString(),
  };
}

function activeSlotIndex(slots, now = new Date()) {
  const mins = now.getHours() * 60 + now.getMinutes();
  let active = -1;
  for (let k = 0; k < slots.length; k++) {
    const m = slots[k].match(/^(\d{1,2}):(\d{2})$/);
    if (!m) continue;
    const slotMins = parseInt(m[1]) * 60 + parseInt(m[2]);
    if (slotMins <= mins) active = k;
    else break;
  }
  return active;
}

module.exports = { parseRotation, activeSlotIndex, normalizeCell, isBlockHeader };
