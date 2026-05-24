/**
 * openwa-client.js — Cliente del gateway WhatsApp (Baileys)
 * El gateway maneja la normalización del JID — aquí solo pasamos el from tal cual.
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

// Cache número→rowId por usuario (TTL 10 min)
const rowMapCache = new NodeCache({ stdTTL: 600 });

// Pasar el JID tal cual — el gateway lo normaliza
function toChatId(jid) { return jid; }

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

async function sendText(phone, text) {
  const { data } = await http.post('/api/sendText', { chatId: toChatId(phone), content: text });
  return data;
}

async function sendImage(phone, base64, caption = '') {
  const { data } = await http.post('/api/sendImage', {
    chatId: toChatId(phone), base64, filename: 'agenda.png', caption,
  });
  return data;
}

async function sendButtons(phone, { title, body, footer = '', buttons }) {
  const { data } = await http.post('/api/sendButtons', {
    chatId: toChatId(phone), title, body, footer,
    buttons: buttons.map((b, i) => ({ id: b.id || `btn_${i}`, displayText: b.text || b.displayText })),
  });
  if (data.rowMap) guardarRowMap(phone, data.rowMap);
  return data;
}

async function sendList(phone, { title, body, footer = '', buttonText, sections }) {
  const { data } = await http.post('/api/sendListMessage', {
    chatId: toChatId(phone), title, body, footer, buttonText, sections,
  });
  if (data.rowMap) guardarRowMap(phone, data.rowMap);
  return data;
}

async function sendConfirm(phone, body, footer = '') {
  return sendButtons(phone, {
    title: '¿Confirmar?', body, footer,
    buttons: [
      { id: 'confirm_yes', text: '✅ Confirmar' },
      { id: 'confirm_no',  text: '❌ Cancelar'  },
    ],
  });
}

async function getStatus() {
  try {
    const { data } = await http.get('/api/getConnectionState');
    return data;
  } catch { return { state: 'OFFLINE' }; }
}

module.exports = {
  sendText, sendImage, sendButtons, sendList, sendConfirm,
  toChatId, getStatus,
  resolverRespuestaNumerica, guardarRowMap,
};
