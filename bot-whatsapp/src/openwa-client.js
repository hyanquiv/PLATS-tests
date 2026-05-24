/**
 * openwa-client.js
 * Wrapper sobre la API REST del gateway WhatsApp propio.
 * Maneja el fallback de botones/listas a texto numerado.
 */
const axios     = require('axios');
const NodeCache = require('node-cache');
const logger    = require('./logger');

const BASE   = process.env.OPENWA_URL     || 'http://plats-openwa:8083';
const APIKEY = process.env.OPENWA_API_KEY || 'plats_openwa_key';

const http = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json', 'x-api-key': APIKEY },
  timeout: 15_000,
});

// Cache: guarda el mapa número→rowId por usuario (TTL 10 min)
// Cuando el usuario escribe "3", el router lo convierte al rowId real
const rowMapCache = new NodeCache({ stdTTL: 600 });

function toChatId(phone) {
  const s = String(phone);
  // Si ya trae sufijo (@c.us, @lid, @g.us) preservarlo tal cual
  if (s.includes('@')) return s;
  // Si es solo número, agregar @c.us como fallback
  return s.replace(/[^0-9]/g, '') + '@c.us';
}

/**
 * Resuelve una respuesta numérica ("1","2"...) al rowId real.
 * Devuelve null si no hay mapa o el texto no es número.
 */
function resolverRespuestaNumerica(phone, texto) {
  const n = texto.trim();
  if (!/^\d+$/.test(n)) return null;
  const mapa = rowMapCache.get(phone);
  if (!mapa) return null;
  return mapa[n] || null;
}

function guardarRowMap(phone, rowMap) {
  if (rowMap) rowMapCache.set(phone, rowMap);
}

// ── Texto ─────────────────────────────────────────────────────
async function sendText(phone, text) {
  const { data } = await http.post('/api/sendText', {
    chatId: toChatId(phone), content: text,
  });
  return data;
}

// ── Imagen ────────────────────────────────────────────────────
async function sendImage(phone, base64, caption = '') {
  const { data } = await http.post('/api/sendImage', {
    chatId: toChatId(phone), base64, filename: 'agenda.png', caption,
  });
  return data;
}

// ── Botones (→ texto numerado) ────────────────────────────────
async function sendButtons(phone, { title, body, footer = '', buttons }) {
  const { data } = await http.post('/api/sendButtons', {
    chatId: toChatId(phone), title, body, footer,
    buttons: buttons.map((b, i) => ({
      id:          b.id   || `btn_${i}`,
      displayText: b.text || b.displayText,
    })),
  });
  // Guardar mapa número→id para resolver respuesta del usuario
  const mapa = {};
  buttons.forEach((b, i) => { mapa[String(i + 1)] = b.id || `btn_${i}`; });
  guardarRowMap(phone, mapa);
  return data;
}

// ── Lista (→ texto numerado con secciones) ────────────────────
async function sendList(phone, { title, body, footer = '', buttonText, sections }) {
  const { data } = await http.post('/api/sendListMessage', {
    chatId: toChatId(phone), title, body, footer, buttonText, sections,
  });
  // El gateway devuelve rowMap con número→rowId
  if (data.rowMap) guardarRowMap(phone, data.rowMap);
  return data;
}

// ── Confirmar (2 botones) ─────────────────────────────────────
async function sendConfirm(phone, body, footer = '') {
  return sendButtons(phone, {
    title: '¿Confirmar?', body, footer,
    buttons: [
      { id: 'confirm_yes', text: '✅ Confirmar' },
      { id: 'confirm_no',  text: '❌ Cancelar'  },
    ],
  });
}

// ── Estado de OpenWA ──────────────────────────────────────────
async function getStatus() {
  try {
    const { data } = await http.get('/api/getConnectionState');
    return data;
  } catch {
    return { state: 'OFFLINE' };
  }
}

module.exports = {
  sendText, sendImage, sendButtons, sendList, sendConfirm,
  toChatId, getStatus,
  resolverRespuestaNumerica, guardarRowMap,
};
