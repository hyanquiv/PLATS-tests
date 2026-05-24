/**
 * openwa-client.js
 * Wrapper sobre la API REST de OpenWA.
 * Documenta: https://docs.openwa.dev/
 *
 * OpenWA expone todo via HTTP POST — el bot nunca toca WhatsApp directamente,
 * solo le habla a OpenWA que hace el trabajo sucio de mantener la sesión.
 */
const axios = require('axios');
const logger = require('./logger');

const BASE  = process.env.OPENWA_URL    || 'http://plats-openwa:8083';
const APIKEY = process.env.OPENWA_API_KEY || 'plats_openwa_key';

const http = axios.create({
  baseURL: BASE,
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': APIKEY,
  },
  timeout: 15_000,
});

// chatId siempre en formato "51999999999@c.us"
function toChatId(phone) {
  const clean = String(phone).replace(/[^0-9]/g, '');
  return clean.includes('@') ? clean : `${clean}@c.us`;
}

// ── Texto simple ──────────────────────────────────────────────
async function sendText(phone, text) {
  const { data } = await http.post('/api/sendText', {
    chatId: toChatId(phone),
    content: text,
  });
  return data;
}

// ── Imagen (para enviar la agenda como PNG) ───────────────────
async function sendImage(phone, base64, caption = '') {
  const { data } = await http.post('/api/sendImage', {
    chatId:   toChatId(phone),
    base64:   base64,
    filename: 'agenda.png',
    caption,
  });
  return data;
}

// ── Botones (máx 3) ───────────────────────────────────────────
// Aparecen como botones tapeables en WhatsApp
async function sendButtons(phone, { title, body, footer = '', buttons }) {
  // buttons: [{ id: 'btn_1', text: '📅 Agendar' }, ...]
  const { data } = await http.post('/api/sendButtons', {
    chatId:  toChatId(phone),
    title,
    body,
    footer,
    buttons: buttons.map((b, i) => ({
      id:          b.id   || `btn_${i}`,
      displayText: b.text,
    })),
  });
  return data;
}

// ── Lista / menú (máx 10 por sección) ────────────────────────
// Aparece como "Ver opciones ▼" — toca para desplegar la lista
async function sendList(phone, { title, body, footer = '', buttonText = 'Ver opciones', sections }) {
  // sections: [{ title: 'Salas', rows: [{ id: 'sala_1', title: 'SALA 1', description: '🏛️ Audiencias grandes' }] }]
  const { data } = await http.post('/api/sendListMessage', {
    chatId:     toChatId(phone),
    title,
    body,
    footer,
    buttonText,
    sections,
  });
  return data;
}

// ── Confirmar / cancelar (2 botones) ─────────────────────────
async function sendConfirm(phone, body, footer = '') {
  return sendButtons(phone, {
    title:   '¿Confirmar?',
    body,
    footer,
    buttons: [
      { id: 'confirm_yes', text: '✅ Confirmar' },
      { id: 'confirm_no',  text: '❌ Cancelar'  },
    ],
  });
}

// ── Verificar que OpenWA esté conectado ───────────────────────
async function getStatus() {
  try {
    const { data } = await http.get('/api/getConnectionState');
    return data;
  } catch {
    return { state: 'OFFLINE' };
  }
}

module.exports = {
  sendText,
  sendImage,
  sendButtons,
  sendList,
  sendConfirm,
  toChatId,
  getStatus,
};
