/**
 * index.js — Punto de entrada del Bot PLATS
 * WhatsApp + panel QR HTTP + pre-auth PLATS + Google Calendar
 */
require('dotenv').config();

const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const qrcode = require('qrcode');
const express = require('express');
const { procesarMensaje } = require('./commands');
const { login } = require('./plats-client');
const { initGoogle } = require('./google-meet');
const logger = require('./logger');

const SESSION_DIR = '/app/sessions';
const PORT = 3001;

let qrActual = '';
let estadoConexion = 'desconectado';
let sock = null;

// ── Panel HTTP ────────────────────────────────────────────────────────────────
const app = express();

app.get('/', async (_req, res) => {
  let qrHtml = '';
  if (qrActual) {
    const svg = await qrcode.toString(qrActual, { type: 'svg' });
    qrHtml = `<div style="text-align:center">
      <h2>Escanear con WhatsApp</h2>
      <div style="display:inline-block;padding:16px;background:#fff;border-radius:12px;box-shadow:0 2px 12px #0002">${svg}</div>
      <p style="color:#666;font-size:13px">WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
    </div>`;
  }
  res.send(`<!DOCTYPE html><html lang="es"><head>
    <meta charset="UTF-8"><meta http-equiv="refresh" content="15">
    <title>PLATS Bot</title>
    <style>body{font-family:system-ui,sans-serif;max-width:600px;margin:40px auto;padding:0 20px}
    .tag{display:inline-block;padding:6px 14px;border-radius:20px;font-weight:600;font-size:14px}
    .conectado{background:#d4edda;color:#155724}.desconectado{background:#f8d7da;color:#721c24}
    .esperando_qr{background:#fff3cd;color:#856404}
    pre{background:#f4f4f4;padding:12px;border-radius:8px;font-size:12px}</style>
  </head><body>
    <h1>🏛️ PLATS Bot WhatsApp</h1>
    <p>Estado: <span class="tag ${estadoConexion}">${estadoConexion.toUpperCase()}</span></p>
    ${qrHtml || (estadoConexion === 'conectado'
      ? '<p>✅ WhatsApp conectado correctamente.</p>'
      : '<p>⏳ Iniciando...</p>')}
    <hr>
    <pre>Backend: ${process.env.PLATS_BASE_URL}\nAdmin  : ${process.env.BOT_ADMIN_PHONE || '—'}</pre>
  </body></html>`);
});

app.get('/health', (_req, res) => res.json({ ok: true, estado: estadoConexion }));
app.listen(PORT, () => logger.info(`Panel en http://0.0.0.0:${PORT}`));

// ── WhatsApp ──────────────────────────────────────────────────────────────────
async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    getMessage: async () => undefined
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) { qrActual = qr; estadoConexion = 'esperando_qr'; }

    if (connection === 'open') {
      qrActual = '';
      estadoConexion = 'conectado';
      logger.info('✅ WhatsApp conectado');
      const admin = process.env.BOT_ADMIN_PHONE;
      if (admin) {
        await sock.sendMessage(`${admin}@s.whatsapp.net`, {
          text: '🤖 *Bot PLATS iniciado*\nEscribe *ayuda* para ver los comandos disponibles.'
        });
      }
    }

    if (connection === 'close') {
      estadoConexion = 'desconectado';
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        logger.warn({ code }, 'Reconectando en 5 s...');
        setTimeout(iniciarBot, 5000);
      } else {
        logger.error('Sesión cerrada. Borra sessions/ y reinicia.');
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const remitente = msg.key.remoteJid;
      if (!remitente) continue;
      const texto =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text || '';
      if (!texto.trim()) continue;
      logger.info({ remitente, texto: texto.substring(0, 80) }, '📩');
      try {
        await sock.sendPresenceUpdate('composing', remitente);
        const respuesta = await procesarMensaje(texto, remitente);
        await sock.sendMessage(remitente, { text: respuesta });
        await sock.sendPresenceUpdate('paused', remitente);
      } catch (err) {
        logger.error({ err }, 'Error en respuesta');
      }
    }
  });
}

// ── Arranque ──────────────────────────────────────────────────────────────────
async function main() {
  logger.info('🏛️ Bot PLATS — Corte Superior de Justicia de Arequipa');
  try { await login(); } catch { logger.warn('Re-auth al primer request'); }
  initGoogle();
  await iniciarBot();
}

main().catch(err => { logger.fatal({ err }, '💥'); process.exit(1); });
