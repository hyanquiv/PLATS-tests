/**
 * openwa/server.js — Gateway WhatsApp con Baileys
 * Misma API REST que el bot espera — sin Chromium, sin puppeteer.
 */
const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const qrcode = require('qrcode');
const express = require('express');
const axios   = require('axios');
const pino    = require('pino');

const WEBHOOK_URL = process.env.WEBHOOK_URL    || 'http://plats-bot:3001/webhook';
const API_KEY     = process.env.OPENWA_API_KEY || 'plats_openwa_key';
const PORT        = parseInt(process.env.PORT  || '8083');
const SESSION_DIR = process.env.SESSION_DIR    || '/sessions';

const logger = pino({ level: 'silent' });

let sock         = null;
let qrActual     = '';
let estadoWA     = 'INITIALIZING';
let reconectando = false;

function normalizarJid(jid) {
  if (!jid) return jid;
  if (jid.includes('@')) return jid;
  return `${jid}@s.whatsapp.net`;
}

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

async function iniciarWA() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version }          = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth:              state,
    logger,
    printQRInTerminal: false,
    getMessage:        async () => undefined,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrActual = qr;
      estadoWA = 'QR_READY';
      console.log(`[WA] QR listo → http://TU_IP:${PORT}`);
      try {
        const str = await qrcode.toString(qr, { type: 'terminal', small: true });
        console.log(str);
      } catch {}
    }

    if (connection === 'open') {
      qrActual     = '';
      estadoWA     = 'CONNECTED';
      reconectando = false;
      console.log('[WA] ✅ Conectado');
      await notificarWebhook({ type: 'ready' });
    }

    if (connection === 'close') {
      estadoWA = 'DISCONNECTED';
      const code  = lastDisconnect?.error?.output?.statusCode;
      const recon = code !== DisconnectReason.loggedOut;
      console.warn(`[WA] Desconectado (${code}). Reconectar: ${recon}`);
      if (recon && !reconectando) {
        reconectando = true;
        setTimeout(iniciarWA, 5000);
      } else if (!recon) {
        estadoWA = 'LOGGED_OUT';
        console.error('[WA] Sesión cerrada. Borra /sessions y reinicia.');
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const from  = msg.key.remoteJid;
      const texto =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text || '';
      if (!texto.trim()) continue;
      console.log(`[WA] 📩 ${from}: ${texto.substring(0, 60)}`);
      await notificarWebhook({ type: 'chat', from, body: texto });
    }
  });
}

// ── API REST ──────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '20mb' }));

app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/health') return next();
  const key = req.headers['x-api-key'] || req.query.apiKey;
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

app.get('/', async (_req, res) => {
  let qrHtml = '';
  if (estadoWA === 'CONNECTED') {
    qrHtml = `<div><div style="font-size:48px;margin-bottom:12px">✅</div>
      <h2 style="color:#4ade80">WhatsApp conectado</h2>
      <p>El bot está activo y escuchando mensajes.</p></div>`;
  } else if (qrActual) {
    try {
      const url = await qrcode.toDataURL(qrActual, { width: 300, margin: 2 });
      qrHtml = `<div>
        <h2>Escanear con WhatsApp</h2>
        <img src="${url}" style="display:block;margin:16px auto;border-radius:12px">
        <p>WhatsApp → <b>Dispositivos vinculados</b> → <b>Vincular dispositivo</b></p>
        <p style="font-size:11px;color:#444;margin-top:8px">Se actualiza cada 5 s</p></div>`;
    } catch {}
  } else {
    qrHtml = `<div><div style="font-size:48px;margin-bottom:12px">⏳</div>
      <h2 style="color:#facc15">Iniciando...</h2></div>`;
  }

  res.send(`<!DOCTYPE html><html lang="es"><head>
    <meta charset="UTF-8"><meta http-equiv="refresh" content="5">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>PLATS Bot QR</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:system-ui,sans-serif;background:#0f0f10;color:#fff;
        min-height:100vh;display:flex;align-items:center;justify-content:center}
      .card{background:#1a1a1d;border:1px solid #2a2a2e;border-radius:20px;
        padding:40px;max-width:400px;width:90%;text-align:center}
      h1{font-size:16px;font-weight:700;margin-bottom:4px}
      .sub{font-size:12px;color:#444;margin-bottom:28px}
      h2{font-size:17px;font-weight:600;margin-bottom:12px}
      p{font-size:13px;color:#888;margin-top:8px;line-height:1.5}
      .badge{display:inline-block;padding:3px 12px;border-radius:20px;
        font-size:11px;font-weight:600;margin-top:20px}
      .CONNECTED{background:#14532d;color:#4ade80}
      .QR_READY{background:#713f12;color:#facc15}
      .DISCONNECTED,.INITIALIZING,.LOGGED_OUT{background:#222;color:#666}
      footer{margin-top:24px;font-size:11px;color:#333;border-top:1px solid #222;padding-top:14px}
    </style>
  </head><body><div class="card">
    <h1>🏛️ PLATS Bot</h1>
    <p class="sub">Corte Superior de Justicia de Arequipa</p>
    ${qrHtml}
    <span class="badge ${estadoWA}">${estadoWA}</span>
    <footer>Baileys · :${PORT}</footer>
  </div></body></html>`);
});

app.get('/health', (_req, res) =>
  res.json({ ok: estadoWA === 'CONNECTED', estado: estadoWA, qr: !!qrActual })
);

app.post('/api/sendText', async (req, res) => {
  if (!sock || estadoWA !== 'CONNECTED')
    return res.status(503).json({ error: 'WhatsApp no conectado' });
  try {
    await sock.sendMessage(normalizarJid(req.body.chatId), { text: req.body.content });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sendImage', async (req, res) => {
  if (!sock || estadoWA !== 'CONNECTED')
    return res.status(503).json({ error: 'WhatsApp no conectado' });
  try {
    await sock.sendMessage(normalizarJid(req.body.chatId), {
      image: Buffer.from(req.body.base64, 'base64'),
      caption: req.body.caption || '',
      mimetype: 'image/png',
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sendButtons', async (req, res) => {
  if (!sock || estadoWA !== 'CONNECTED')
    return res.status(503).json({ error: 'WhatsApp no conectado' });
  const { chatId, title = '', body, footer = '', buttons } = req.body;
  const rowMap = {};
  const lineas = [];
  if (title)  lineas.push(`*${title}*`);
  if (body)   lineas.push(body);
  lineas.push('');
  buttons.forEach((b, i) => {
    const label = b.displayText || b.text;
    lineas.push(`${i + 1}. ${label}`);
    rowMap[String(i + 1)] = b.id;
  });
  if (footer) lineas.push(`\n_${footer}_`);
  lineas.push('\n_Responde con el número_');
  try {
    await sock.sendMessage(normalizarJid(chatId), { text: lineas.join('\n') });
    res.json({ ok: true, rowMap });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sendListMessage', async (req, res) => {
  if (!sock || estadoWA !== 'CONNECTED')
    return res.status(503).json({ error: 'WhatsApp no conectado' });
  const { chatId, title = '', body, footer = '', sections } = req.body;
  const rowMap = {};
  const lineas = [];
  if (title) lineas.push(`*${title}*`);
  if (body)  lineas.push(body);
  let n = 1;
  sections.forEach(s => {
    lineas.push(`\n*${s.title}*`);
    s.rows.forEach(r => {
      lineas.push(`${n}. ${r.title}${r.description ? '  _' + r.description + '_' : ''}`);
      rowMap[String(n)] = r.id;
      n++;
    });
  });
  if (footer) lineas.push(`\n_${footer}_`);
  lineas.push('\n_Responde con el número_');
  try {
    await sock.sendMessage(normalizarJid(chatId), { text: lineas.join('\n') });
    res.json({ ok: true, rowMap });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/getConnectionState', (_req, res) =>
  res.json({ state: estadoWA })
);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[WA] Gateway Baileys en http://0.0.0.0:${PORT}`);
  console.log(`[WA] Webhook → ${WEBHOOK_URL}`);
});

iniciarWA();
