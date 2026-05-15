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

// ── Panel HTTP con QR renderizado ─────────────────────────────────────────────
const app = express();

app.get('/', async (_req, res) => {
  let qrHtml = '';

  if (estadoConexion === 'conectado') {
    qrHtml = `
      <div class="status ok">
        <div class="icon">✅</div>
        <h2>WhatsApp Conectado</h2>
        <p>El bot está activo y escuchando mensajes.</p>
      </div>`;
  } else if (qrActual) {
    try {
      const qrDataUrl = await qrcode.toDataURL(qrActual, { width: 280, margin: 2 });
      qrHtml = `
        <div class="status pending">
          <h2>Escanear QR con WhatsApp</h2>
          <img src="${qrDataUrl}" alt="QR Code" style="border-radius:12px;box-shadow:0 4px 20px #0003">
          <p>WhatsApp → <b>Dispositivos vinculados</b> → <b>Vincular dispositivo</b></p>
          <p class="note">El QR se actualiza automáticamente cada 5 segundos</p>
        </div>`;
    } catch (e) {
      qrHtml = `<pre style="font-size:10px;line-height:1.2">${qrActual}</pre>`;
    }
  } else {
    qrHtml = `
      <div class="status waiting">
        <div class="icon">⏳</div>
        <h2>Generando QR...</h2>
        <p>La página se actualizará automáticamente.</p>
      </div>`;
  }

  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="5">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>PLATS Bot — Panel QR</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, sans-serif;
      background: #0f0f10;
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #1a1a1d;
      border: 1px solid #2a2a2e;
      border-radius: 20px;
      padding: 40px;
      max-width: 420px;
      width: 90%;
      text-align: center;
    }
    .header { margin-bottom: 28px; }
    .header h1 { font-size: 16px; font-weight: 700; color: #fff; }
    .header p  { font-size: 12px; color: #666; margin-top: 4px; }
    .status h2  { font-size: 18px; font-weight: 600; margin-bottom: 16px; }
    .status p   { font-size: 13px; color: #aaa; margin-top: 10px; line-height: 1.5; }
    .status img { margin: 0 auto; display: block; }
    .status.ok   h2 { color: #4ade80; }
    .status.pending h2 { color: #fff; }
    .status.waiting h2 { color: #facc15; }
    .icon { font-size: 48px; margin-bottom: 12px; }
    .note { font-size: 11px !important; color: #555 !important; margin-top: 14px !important; }
    .badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      margin-top: 20px;
    }
    .badge.conectado   { background: #14532d; color: #4ade80; }
    .badge.esperando   { background: #713f12; color: #facc15; }
    .badge.desconectado{ background: #450a0a; color: #f87171; }
    .footer { margin-top: 24px; font-size: 11px; color: #444; border-top: 1px solid #2a2a2e; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>🏛️ PLATS Bot WhatsApp</h1>
      <p>Corte Superior de Justicia de Arequipa</p>
    </div>

    ${qrHtml}

    <span class="badge ${estadoConexion === 'conectado' ? 'conectado' : estadoConexion === 'esperando_qr' ? 'esperando' : 'desconectado'}">
      ${estadoConexion.toUpperCase().replace('_', ' ')}
    </span>

    <div class="footer">
      Backend: ${process.env.PLATS_BASE_URL || '—'}<br>
      Admin: ${process.env.BOT_ADMIN_PHONE || '(no configurado)'}
    </div>
  </div>
</body>
</html>`);
});

app.get('/health', (_req, res) => res.json({ ok: true, estado: estadoConexion, qr: !!qrActual }));
app.get('/qr.png', async (_req, res) => {
  if (!qrActual) return res.status(404).send('Sin QR');
  const buf = await qrcode.toBuffer(qrActual, { width: 400, margin: 2 });
  res.setHeader('Content-Type', 'image/png');
  res.send(buf);
});

app.listen(PORT, '0.0.0.0', () => logger.info(`Panel QR en http://0.0.0.0:${PORT}`));

// ── WhatsApp con Baileys ──────────────────────────────────────────────────────
async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    // Sin printQRInTerminal — lo manejamos nosotros
    getMessage: async () => undefined,
    logger: require('pino')({ level: 'silent' }) // silenciar logs internos de baileys
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {

    // QR nuevo disponible → guardarlo para el panel
    if (qr) {
      qrActual = qr;
      estadoConexion = 'esperando_qr';
      logger.info(`📱 QR listo — abre http://TU_IP:${PORT} y escanea`);
      // También imprimir en terminal como texto (por si acaso)
      try {
        const qrTerminal = await qrcode.toString(qr, { type: 'terminal', small: true });
        console.log('\n' + qrTerminal);
      } catch {}
    }

    if (connection === 'open') {
      qrActual = '';
      estadoConexion = 'conectado';
      logger.info('✅ WhatsApp conectado');

      const admin = process.env.BOT_ADMIN_PHONE;
      if (admin) {
        try {
          await sock.sendMessage(`${admin}@s.whatsapp.net`, {
            text: '🤖 *Bot PLATS iniciado*\nEscribe *ayuda* para ver los comandos disponibles.'
          });
        } catch {}
      }
    }

    if (connection === 'close') {
      qrActual = '';
      estadoConexion = 'desconectado';
      const code = lastDisconnect?.error?.output?.statusCode;
      const reconectar = code !== DisconnectReason.loggedOut;
      logger.warn({ code }, `Conexión cerrada. Reconectar: ${reconectar}`);
      if (reconectar) {
        setTimeout(iniciarBot, 3000);
      } else {
        logger.error('Sesión cerrada por logout. Borra sessions/ y reinicia.');
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

      logger.info({ remitente, texto: texto.substring(0, 80) }, '📩 Mensaje recibido');
      try {
        await sock.sendPresenceUpdate('composing', remitente);
        const respuesta = await procesarMensaje(texto, remitente);
        await sock.sendMessage(remitente, { text: respuesta });
        await sock.sendPresenceUpdate('paused', remitente);
      } catch (err) {
        logger.error({ err }, 'Error procesando mensaje');
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

main().catch(err => { logger.fatal({ err }, '💥 Error fatal'); process.exit(1); });
