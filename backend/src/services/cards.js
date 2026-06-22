'use strict';
/**
 * cards.js — resolução Código de barras -> GP (via PostgreSQL) + consulta das mesas.
 *
 * FASE 2: a fonte da verdade dos cartões é o Postgres (gp.staff / view gp.card_lookup),
 * não mais o data/cards.json. A lógica de cálculo de mesas é IDÊNTICA à anterior.
 */
const { pool, resolveCard } = require('./db');
const { currentShift } = require('../state');
const { getMerged } = require('./overrides');

function norm(v)     { return String(v == null ? '' : v).trim(); }
function codeKey(v)  { return norm(v).toUpperCase(); }
function nickKey(v)  { return norm(v).toLowerCase(); }

// ---- CRUD (agora sobre gp.staff) ------------------------------------------

// Formato que a aba "Cartões" do admin espera: { code, nick, name }
async function listCards() {
  const { rows } = await pool.query(
    `SELECT barcode AS code, screen_name AS nick, name
       FROM gp.staff
      ORDER BY active DESC, screen_name NULLS LAST, barcode`
  );
  return rows;
}

/**
 * Cria/atualiza a associação código -> GP.
 * Se o barcode já existe, atualiza nick (screen_name) e nome.
 * Se não existe, insere uma linha mínima ativa (cartão avulso).
 */
async function upsertCard({ code, nick, name }) {
  code = codeKey(code);
  nick = norm(nick);
  name = norm(name);
  if (!code) throw new Error('Código obrigatório');
  if (!nick && !name) throw new Error('Informe ao menos o nick ou o nome do GP');
  const { rows } = await pool.query(
    `INSERT INTO gp.staff (barcode, screen_name, name, active, source)
       VALUES ($1, NULLIF($2,''), NULLIF($3,''), TRUE, 'admin:cards')
     ON CONFLICT (barcode) DO UPDATE SET
       screen_name = COALESCE(NULLIF(EXCLUDED.screen_name,''), gp.staff.screen_name),
       name        = COALESCE(NULLIF(EXCLUDED.name,''),        gp.staff.name),
       updated_at  = now()
     RETURNING barcode AS code, screen_name AS nick, name`,
    [code, nick, name]
  );
  return rows[0];
}

/**
 * "Remove" o cartão. ATENÇÃO (mudança de semântica): a linha agora é uma PESSOA
 * (staff). Em vez de apagar, fazemos SOFT-DISABLE (active=false): o cartão deixa
 * de responder na Consulta, mas o histórico do staff é preservado.
 */
async function removeCard(code) {
  const { rowCount } = await pool.query(
    `UPDATE gp.staff SET active = FALSE, updated_at = now()
      WHERE barcode = $1 AND active = TRUE`,
    [codeKey(code)]
  );
  return { removed: rowCount };
}

// ---- consulta (lookup) -----------------------------------------------------

/** Acha o GP na rotação atual pelo nick/nome do cartão. (inalterado) */
function findPresenter(rotation, card) {
  const wantNick = nickKey(card.nick);
  const wantName = nickKey(card.name);
  for (const b of rotation.blocks || []) {
    for (const p of b.presenters || []) {
      const pn = nickKey(p.nick);
      const pm = nickKey(p.name);
      if ((wantNick && pn && pn === wantNick) || (wantName && pm && pm === wantName)) {
        return { block: b, presenter: p };
      }
    }
  }
  return null;
}

function isRealTable(cell) { return cell && (cell.type === 'table' || cell.type === 'tables'); }
function tableLabel(cell) {
  if (!cell) return '';
  if (cell.type === 'table')  return cell.table;
  if (cell.type === 'tables') return cell.tables.join(' / ');
  return '';
}

/** Índice da coluna do horário atual (último slot <= agora). (inalterado) */
function activeIndex(slots, now = new Date()) {
  const m = now.getHours() * 60 + now.getMinutes();
  let a = -1;
  for (let k = 0; k < slots.length; k++) {
    const t = String(slots[k]).match(/^(\d{1,2}):(\d{2})$/);
    if (!t) continue;
    const sm = (+t[1]) * 60 + (+t[2]);
    if (sm <= m) a = k; else break;
  }
  return a;
}

/**
 * Consulta as mesas de um GP a partir do código de barras.
 * Regras inalteradas: "agora" = activeIndex; se break, lista próximas 4 mesas reais;
 * se mesa, mostra a atual + próximas 3 (4 no total); cada item traz o horário.
 */
async function lookup(code, env = 'prod') {
  const card = await resolveCard(code);   // Postgres; normaliza caixa/espaços do barcode
  if (!card) {
    return { ok: false, reason: 'unknown_card', message: 'Cartão não cadastrado' };
  }

  const shift = currentShift();
  const rotation = getMerged(env, shift);
  if (!rotation || !rotation.blocks || rotation.blocks.length === 0 || rotation.awaitingData) {
    return {
      ok: false, reason: 'no_rotation',
      gp: { nick: card.nick, name: card.name },
      message: 'Sem rotação publicada para o turno atual',
    };
  }

  const found = findPresenter(rotation, card);
  if (!found) {
    return {
      ok: false, reason: 'gp_not_in_shift',
      gp: { nick: card.nick, name: card.name },
      message: 'Você não está na rotação do turno atual',
    };
  }

  const { block, presenter } = found;
  const slots = block.slots || [];
  const cells = presenter.cells || [];

  const nowIdx = activeIndex(slots);
  const curCell = nowIdx >= 0 ? cells[nowIdx] : null;
  const onBreak = !isRealTable(curCell);

  const items = [];
  let startNext = nowIdx + 1;
  if (!onBreak && nowIdx >= 0) {
    items.push({ when: slots[nowIdx] || '', table: tableLabel(curCell), now: true });
  }
  for (let k = startNext; k < cells.length && items.length < 4; k++) {
    if (isRealTable(cells[k])) {
      items.push({ when: slots[k] || '', table: tableLabel(cells[k]), now: false });
    }
  }

  return {
    ok: true,
    gp: { nick: presenter.nick, name: presenter.name },
    brand: block.brand,
    shift,
    shiftLabel: rotation.shift || null,
    onBreak,
    now: slots[nowIdx] || null,
    tables: items,
    message: items.length ? null : 'Sem mais mesas neste turno',
  };
}

module.exports = { listCards, upsertCard, removeCard, lookup };
