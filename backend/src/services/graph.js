'use strict';

const { ConfidentialClientApplication } = require('@azure/msal-node');
const axios = require('axios');
const { saveBase } = require('../state');
const { parseRotation } = require('./rotation');

const msalConfig = {
  auth: {
    clientId: process.env.GRAPH_CLIENT_ID,
    clientSecret: process.env.GRAPH_CLIENT_SECRET,
    authority: `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}`,
  },
};

let msalClient = null;
function getMsalClient() {
  if (!msalClient) msalClient = new ConfidentialClientApplication(msalConfig);
  return msalClient;
}

async function getToken() {
  const result = await getMsalClient().acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  if (!result || !result.accessToken) throw new Error('Falha ao obter token do Graph');
  return result;
}

/** Metadado leve: data de última modificação do arquivo (p/ pular reprocessamento). */
async function getFileLastModified() {
  const token = await getToken();
  const headers = { Authorization: `Bearer ${token.accessToken}` };
  const siteId = process.env.GRAPH_SITE_ID;
  const filePath = process.env.GRAPH_FILE_PATH;
  if (!siteId || !filePath) return null;
  const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:${filePath}?$select=lastModifiedDateTime,eTag`;
  const r = await axios.get(url, { headers });
  return r.data.eTag || r.data.lastModifiedDateTime || null;
}

/** Lê o usedRange de uma aba e retorna values + text (formatado). */
async function fetchSheetValues(sheetOverride) {
  const token = await getToken();
  const headers = { Authorization: `Bearer ${token.accessToken}` };
  const siteId = process.env.GRAPH_SITE_ID;
  const filePath = process.env.GRAPH_FILE_PATH;
  let sheetName = sheetOverride || process.env.GRAPH_SHEET_NAME;

  if (!siteId || !filePath) throw new Error('GRAPH_SITE_ID e GRAPH_FILE_PATH são obrigatórios');

  const base = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:${filePath}:/workbook`;

  if (!sheetName) {
    const wsResp = await axios.get(`${base}/worksheets`, { headers });
    const sheets = wsResp.data.value || [];
    if (sheets.length === 0) throw new Error('Planilha sem abas');
    sheetName = sheets[0].name;
  }

  const rangeUrl = base + "/worksheets('" + encodeURIComponent(sheetName) + "')/usedRange";
  const resp = await axios.get(rangeUrl, { headers });
  return { values: resp.data.values || [], text: resp.data.text || [], sheetName };
}

/** Lista as abas da planilha. */
async function listWorksheets() {
  const token = await getToken();
  const headers = { Authorization: `Bearer ${token.accessToken}` };
  const siteId = process.env.GRAPH_SITE_ID;
  const filePath = process.env.GRAPH_FILE_PATH;
  const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:${filePath}:/workbook/worksheets`;
  const resp = await axios.get(url, { headers });
  return (resp.data.value || []).map(w => ({ name: w.name, position: w.position, visibility: w.visibility }));
}

/** Lista os arquivos "Month Shift and Rotation" com caminho e data. */
async function findFile() {
  const token = await getToken();
  const headers = { Authorization: 'Bearer ' + token.accessToken };
  const siteId = process.env.GRAPH_SITE_ID;
  const url = 'https://graph.microsoft.com/v1.0/sites/' + siteId + "/drive/root/search(q='Month Shift and Rotation')?$select=name,parentReference,webUrl,lastModifiedDateTime";
  const r = await axios.get(url, { headers });
  return (r.data.value || []).map(i => ({ name: i.name, path: i.parentReference && i.parentReference.path, lastModified: i.lastModifiedDateTime }));
}

function shiftFromName(name) {
  if (/manh/i.test(name)) return 'Manhã';
  if (/tarde/i.test(name)) return 'Tarde';
  if (/noite/i.test(name)) return 'Noite';
  return null;
}

// Classifica uma hora (0-23) na janela de turno:
//   Manhã 07:00–14:59 | Tarde 15:00–22:59 | Noite 23:00–06:59
// (cada turno "pertence" ao seu horário de início)
function shiftOfHour(h) {
  if (h >= 7 && h < 15) return 'manha';
  if (h >= 15 && h < 23) return 'tarde';
  return 'noite'; // 23 e 0–6
}

// Chave de turno (manha|tarde|noite) a partir do dado parseado.
// Primário: rótulo escrito na planilha ("MANHÃ/TARDE/NOITE").
// Robusto: se não houver rótulo, VOTA pela faixa de turno predominante entre
// TODOS os horários de TODOS os blocos (não depende de uma única célula).
// Chave de turno (manha|tarde|noite) a partir do dado parseado.
// PRIORIDADE: votação pelos HORÁRIOS das colunas (objetiva) decide primeiro.
// O rótulo digitado ("Manhã/Tarde/Noite") é só último recurso, porque vem
// errado às vezes (ex.: planilha da noite com slots 23:00 mas rótulo "Tarde").
function shiftKeyFromRotation(rotation) {
  const votes = { manha: 0, tarde: 0, noite: 0 };
  const blocks = (rotation && rotation.blocks) || [];
  for (const b of blocks) {
    for (const sIt of (b.slots || [])) {
      const mm = typeof sIt === 'string' && sIt.match(/^(\d{1,2}):(\d{2})$/);
      if (!mm) continue;
      let h = parseInt(mm[1], 10);
      if (h === 24) h = 0;           // tolera 24:00 -> 00:00
      if (h >= 0 && h <= 23) votes[shiftOfHour(h)]++;
    }
  }
  const total = votes.manha + votes.tarde + votes.noite;
  if (total) {
    // turno com mais votos (horário manda)
    return Object.keys(votes).reduce((a, b) => (votes[b] > votes[a] ? b : a), 'manha');
  }

  // sem horário legível: rótulo como último recurso
  const lbl = (rotation && rotation.shift) || '';
  if (/manh/i.test(lbl)) return 'manha';
  if (/tarde/i.test(lbl)) return 'tarde';
  if (/noite/i.test(lbl)) return 'noite';
  return null;
}

/** Resolve o nome da aba por sheet/pos/last/env. */
async function resolveSheetName(opts) {
  opts = opts || {};
  if (opts.sheet) return opts.sheet;
  const list = (await listWorksheets()).sort((a, b) => a.position - b.position);
  if (opts.pos != null)  return list[parseInt(opts.pos)] && list[parseInt(opts.pos)].name;
  if (opts.last != null) return list[list.length - parseInt(opts.last)] && list[list.length - parseInt(opts.last)].name;
  if (opts.env === 'qa') return process.env.GRAPH_SHEET_NAME_QA || (list[0] && list[0].name);
  return process.env.GRAPH_SHEET_NAME || (list[0] && list[0].name);
}

/** Preview: lê + parseia SEM salvar nem broadcast. Suporta ?raw. */
async function previewRotation(opts) {
  opts = opts || {};
  const name = await resolveSheetName(opts);
  const { values, text, sheetName } = await fetchSheetValues(name);
  const rows = (text && text.length) ? text : values;
  if (opts.raw) return { sheetName, rowCount: rows.length, sample: rows.slice(0, 22) };
  const rotation = parseRotation(rows, { shift: shiftFromName(sheetName) });
  return { sheetName, rowCount: rows.length, rotation };
}

/** Sync real (env-aware): lê, parseia, detecta o turno do dado e salva no snapshot daquele turno. */
async function syncFromSharePoint(wss, env) {
  env = env || 'prod';
  const sheetEnvVar = env === 'qa' ? process.env.GRAPH_SHEET_NAME_QA : process.env.GRAPH_SHEET_NAME;
  const { values, text, sheetName } = await fetchSheetValues(sheetEnvVar);
  const rows = (text && text.length) ? text : values;
  const rotation = parseRotation(rows, { shift: shiftFromName(sheetName) });

  // de qual turno é este dado? (rótulo na planilha ou hora da 1ª coluna)
  const shiftKey = shiftKeyFromRotation(rotation);

  const base = {
    ...rotation,
    source: 'graph-api',
    env,
    sheetName,
    shiftKey,
    lastUpdate: new Date().toISOString(),
    updatedBy: 'graph-api-sync',
  };

  if (shiftKey && rotation.blocks.length > 0) {
    // grava no snapshot do turno detectado (não no turno do relógio):
    // assim o turno seguinte pode ser preparado sem trocar o que está na TV.
    saveBase(env, shiftKey, base);
  }

  if (wss) {
    const { broadcastEnv } = require('../websocket');
    const { getMerged } = require('./overrides');
    const { currentShift } = require('../state');
    // a TV mostra o turno do RELÓGIO (vira sozinha em 06:45/14:45/22:45)
    broadcastEnv(wss, env, 'ROTATION_UPDATE', getMerged(env, currentShift()));
  }
  console.log(`[GRAPH:${env}] Sync OK — aba "${sheetName}", turno detectado=${shiftKey}, ${rotation.blocks.length} bloco(s)`);
  return { env, shiftKey, blocks: rotation.blocks.length, warnings: rotation.warnings };
}

/** Diagnóstico de acesso (mantido para troubleshooting). */
async function diagnose() {
  const token = await getToken();
  const headers = { Authorization: 'Bearer ' + token.accessToken };
  const siteId = process.env.GRAPH_SITE_ID;
  const filePath = process.env.GRAPH_FILE_PATH;
  const out = { siteId, filePath, steps: {} };
  try {
    const r = await axios.get('https://graph.microsoft.com/v1.0/sites/' + siteId + '/drive/root/children?$select=name,folder,file', { headers });
    out.steps.rootChildren = (r.data.value || []).map(i => ({ name: i.name, isFolder: !!i.folder }));
  } catch (e) { out.steps.rootChildren = { status: e.response && e.response.status, detail: (e.response && e.response.data && e.response.data.error && e.response.data.error.message) || e.message }; }
  try {
    const r = await axios.get('https://graph.microsoft.com/v1.0/sites/' + siteId + '/drive/root:' + filePath + '?$select=name,id', { headers });
    out.steps.fileAtPath = { ok: true, name: r.data.name };
  } catch (e) { out.steps.fileAtPath = { status: e.response && e.response.status, detail: (e.response && e.response.data && e.response.data.error && e.response.data.error.message) || e.message }; }
  return out;
}

module.exports = {
  getToken, fetchSheetValues, listWorksheets, findFile, getFileLastModified,
  previewRotation, syncFromSharePoint, diagnose,
};
