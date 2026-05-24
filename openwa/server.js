/**
 * openwa/server.js
 * Gateway WhatsApp propio usando whatsapp-web.js.
 *
 * Expone:
 *   GET  /          → Panel QR (HTML)
 *   GET  /health    → Estado de conexión
 *   POST /api/send  → Enviar mensaje (texto, imagen, botones, lista)
 *
 * Recibe mensajes de WhatsApp y los reenvía como webhook POST
 * al bot en http://plats-bot:3001/webhook
 */

const { Client, LocalAuth, MessageMedia, Buttons, List } = require('whatsapp-web.js');
const qrcode  = require('qrcode');
const express = require('express');
const axios   = require('axios');

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://plats-bot:3001/webhook';
const API_KEY     = process.env.OPENWA_API_KEY      || 'plats_openwa_key';
const PORT        = parseInt(process.env.PORT || '8083');

let qrActual     = '';
let estadoWA     = 'INITIALIZING';
let clienteListo = false;

// ── WhatsApp client ───────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: '/sessions',
    clientId: 'plats-session',
  }),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
    ],
    headless: true,
  },
});

client.on('qr', async (qr) => {
  qrActual = qr;
  estadoWA = 'QR_READY';
  console.log('[WA] QR generado — abre http://0.0.0.0:' + PORT);
  // Imprimir también en terminal
  try {
    const qrStr = await qrcode.toString(qr, { type: 'terminal', small: true });
    console.log(qrStr);
  } catch {}
});

client.on('ready', () => {
  qrActual     = '';
  estadoWA     = 'CONNECTED';
  clienteListo = true;
  console.log('[WA] ✅ WhatsApp conectado');
  notificarWebhook({ type: 'ready', message: 'WhatsApp conectado' });
});

client.on('authenticated', () => {
  estadoWA = 'AUTHENTICATED';
  console.log('[WA] Autenticado');
});

client.on('auth_failure', (msg) => {
  estadoWA = 'AUTH_FAILURE';
  console.error('[WA] Error de autenticación:', msg);
});

client.on('disconnected', (reason) => {
  estadoWA     = 'DISCONNECTED';
  clienteListo = false;
  console.warn('[WA] Desconectado:', reason);
  notificarWebhook({ type: 'disconnected', reason });
  // Reconectar en 10 segundos
  setTimeout(() => client.initialize(), 10_000);
});

// Recibir mensajes y reenviar al bot
client.on('message', async (msg) => {
  if (msg.fromMe) return;

  const payload = {
    type:          msg.type === 'chat' ? 'chat' : msg.type,
    from:          msg.from,
    body:          msg.body,
    // Para respuestas de lista y botones
    selectedRowId: msg.selectedRowId   || null,
    buttonId:      msg.selectedButtonId|| null,
    timestamp:     msg.timestamp,
  };

  console.log(`[WA] 📩 ${msg.from}: ${(msg.body||'').substring(0,60)}`);
  await notificarWebhook(payload);
});

// Respuestas de botón
client.on('message_create', async (msg) => {
  if (!msg.fromMe && msg.type === 'buttons_response') {
    await notificarWebhook({
      type:     'button_response',
      from:     msg.from,
      body:     msg.selectedButtonId || msg.body,
      timestamp: msg.timestamp,
    });
  }
});

async function notificarWebhook(payload) {
  try {
    await axios.post(WEBHOOK_URL, payload, {
      headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
      timeout: 8000,
    });
  } catch (err) {
    console.warn('[WA] Webhook error:', err.message);
  }
}

// ── API REST para enviar mensajes ─────────────────────────────
const app = express();
app.use(express.json({ limit: '20mb' }));

// Middleware de autenticación
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/health') return next();
  const key = req.headers['x-api-key'] || req.query.apiKey;
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

// Panel QR
app.get('/', async (_req, res) => {
  let qrHtml = '';
  if (estadoWA === 'CONNECTED') {
    qrHtml = `<div class="status ok"><div class="icon">✅</div>
      <h2>WhatsApp Conectado</h2><p>El bot está activo.</p></div>`;
  } else if (qrActual) {
    try {
      const dataUrl = await qrcode.toDataURL(qrActual, { width: 300, margin: 2 });
      qrHtml = `<div class="status pending">
        <h2>Escanear QR con WhatsApp</h2>
        <img src="${dataUrl}" style="border-radius:12px;box-shadow:0 4px 20px #0003">
        <p>WhatsApp → <b>Dispositivos vinculados</b> → <b>Vincular dispositivo</b></p>
        <p class="note">Se actualiza cada 5 segundos</p></div>`;
    } catch {}
  } else {
    qrHtml = `<div class="status waiting"><div class="icon">⏳</div>
      <h2>Inicializando...</h2><p>Espera unos segundos.</p></div>`;
  }

  res.send(`<!DOCTYPE html><html lang="es"><head>
    <meta charset="UTF-8"><meta http-equiv="refresh" content="5">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>PLATS Bot — QR</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:system-ui,sans-serif;background:#0f0f10;color:#fff;
           min-height:100vh;display:flex;align-items:center;justify-content:center}
      .card{background:#1a1a1d;border:1px solid #2a2a2e;border-radius:20px;
            padding:40px;max-width:420px;width:90%;text-align:center}
      h1{font-size:16px;font-weight:700;margin-bottom:4px}
      .sub{font-size:12px;color:#555;margin-bottom:28px}
      h2{font-size:18px;font-weight:600;margin-bottom:16px}
      p{font-size:13px;color:#aaa;margin-top:10px;line-height:1.5}
      img{margin:0 auto;display:block}
      .status.ok h2{color:#4ade80}.status.pending h2{color:#fff}.status.waiting h2{color:#facc15}
      .icon{font-size:48px;margin-bottom:12px}
      .note{font-size:11px!important;color:#444!important;margin-top:14px!important}
      .badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;
             font-weight:600;margin-top:20px}
      .CONNECTED{background:#14532d;color:#4ade80}
      .QR_READY,.AUTHENTICATED{background:#713f12;color:#facc15}
      .DISCONNECTED,.AUTH_FAILURE,.INITIALIZING{background:#1a1a1d;color:#888}
      .footer{margin-top:24px;font-size:11px;color:#333;
              border-top:1px solid #222;padding-top:16px}
    </style>
  </head><body><div class="card">
    <h1>🏛️ PLATS Bot WhatsApp</h1>
    <p class="sub">Corte Superior de Justicia de Arequipa</p>
    ${qrHtml}
    <span class="badge ${estadoWA}">${estadoWA}</span>
    <div class="footer">Gateway: whatsapp-web.js | Puerto: ${PORT}</div>
  </div></body></html>`);
});

// Health check
app.get('/health', (_req, res) => res.json({
  ok: clienteListo, estado: estadoWA, qr: !!qrActual
}));

// Endpoint para enviar texto
app.post('/api/sendText', async (req, res) => {
  if (!clienteListo) return res.status(503).json({ error: 'WhatsApp no conectado' });
  const { chatId, content } = req.body;
  try {
    await client.sendMessage(chatId, content);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para enviar imagen (base64)
app.post('/api/sendImage', async (req, res) => {
  if (!clienteListo) return res.status(503).json({ error: 'WhatsApp no conectado' });
  const { chatId, base64, filename = 'imagen.png', caption = '' } = req.body;
  try {
    const media = new MessageMedia('image/png', base64, filename);
    await client.sendMessage(chatId, media, { caption });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para enviar botones (máx 3)
app.post('/api/sendButtons', async (req, res) => {
  if (!clienteListo) return res.status(503).json({ error: 'WhatsApp no conectado' });
  const { chatId, body, title = '', footer = '', buttons } = req.body;
  try {
    const btnMsg = new Buttons(
      body,
      buttons.map(b => ({ id: b.id, body: b.displayText || b.text })),
      title,
      footer
    );
    await client.sendMessage(chatId, btnMsg);
    res.json({ ok: true });
  } catch (err) {
    // Fallback: si botones no soportados, enviar como texto con opciones numeradas
    const texto = `${title ? '*' + title + '*\n' : ''}${body}\n\n` +
      buttons.map((b, i) => `${i + 1}️⃣ ${b.displayText || b.text}`).join('\n') +
      (footer ? `\n\n_${footer}_` : '');
    try {
      await client.sendMessage(chatId, texto);
      res.json({ ok: true, fallback: true });
    } catch (err2) {
      res.status(500).json({ error: err2.message });
    }
  }
});

// Endpoint para enviar lista
app.post('/api/sendListMessage', async (req, res) => {
  if (!clienteListo) return res.status(503).json({ error: 'WhatsApp no conectado' });
  const { chatId, body, title = '', footer = '', buttonText = 'Ver opciones', sections } = req.body;
  try {
    const list = new List(
      body,
      buttonText,
      sections.map(s => ({
        title: s.title,
        rows:  s.rows.map(r => ({ id: r.id, title: r.title, description: r.description || '' }))
      })),
      title,
      footer
    );
    await client.sendMessage(chatId, list);
    res.json({ ok: true });
  } catch (err) {
    // Fallback: texto numerado
    let texto = `${title ? '*' + title + '*\n' : ''}${body}\n`;
    let n = 1;
    sections.forEach(s => {
      texto += `\n*${s.title}*\n`;
      s.rows.forEach(r => { texto += `${n}. ${r.title}\n`; n++; });
    });
    if (footer) texto += `\n_${footer}_`;
    try {
      await client.sendMessage(chatId, texto);
      res.json({ ok: true, fallback: true });
    } catch (err2) {
      res.status(500).json({ error: err2.message });
    }
  }
});

// Estado de conexión (compatible con openwa-client.js existente)
app.get('/api/getConnectionState', (_req, res) => {
  res.json({ state: estadoWA });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[WA] Gateway escuchando en http://0.0.0.0:${PORT}`);
  console.log(`[WA] Webhook → ${WEBHOOK_URL}`);
});

// Inicializar cliente WhatsApp
console.log('[WA] Inicializando cliente WhatsApp...');
client.initialize();
