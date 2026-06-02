/**
 * index.js — Punto de entrada PLATS Bot v3.0
 *
 * Arquitectura:
 *   OpenWA  →  POST /webhook  →  router.js  →  handlers/
 *
 * El bot ya NO maneja la conexión WhatsApp directamente.
 * OpenWA es el gateway — expone un dashboard en :8083 con el QR.
 * Este servidor solo recibe webhooks y llama a la API REST de OpenWA.
 */
require('dotenv').config();

const express = require('express');
const { routear }   = require('./router');
const { login }     = require('./plats-client');
const { initGoogle } = require('./google-meet');
const { conectar: conectarDB } = require('./db');
const wa = require('./openwa-client');
const logger = require('./logger');

const PORT = 3001;
const app  = express();
app.use(express.json({ limit: '10mb' })); // imágenes base64 son grandes

// ── Webhook de OpenWA ─────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // responder inmediato para que OpenWA no reintente
  try {
    await routear(req.body);
  } catch (err) {
    logger.error({ err }, 'Error en webhook');
  }
});

// ── Panel de estado ───────────────────────────────────────────
app.get('/', async (_req, res) => {
  const waStatus = await wa.getStatus();
  res.send(`<!DOCTYPE html>
<html lang="es"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="15">
  <title>PLATS Bot — Estado</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:system-ui,sans-serif; background:#0f0f10; color:#fff;
           min-height:100vh; display:flex; align-items:center; justify-content:center; }
    .card { background:#1a1a1d; border:1px solid #2a2a2e; border-radius:20px;
            padding:36px; max-width:440px; width:90%; }
    h1 { font-size:17px; margin-bottom:4px; }
    p  { font-size:12px; color:#666; }
    .row { display:flex; justify-content:space-between; align-items:center;
           padding:10px 0; border-bottom:1px solid #222; font-size:13px; }
    .row:last-child { border:none; }
    .pill { padding:3px 10px; border-radius:20px; font-size:11px; font-weight:600; }
    .ok   { background:#14532d; color:#4ade80; }
    .warn { background:#713f12; color:#facc15; }
    .err  { background:#450a0a; color:#f87171; }
    .hint { margin-top:20px; font-size:12px; color:#444; line-height:1.6; }
    a { color:#4ade80; }
  </style>
</head><body><div class="card">
  <h1>🏛️ PLATS Bot v3.0</h1>
  <p style="margin-bottom:20px">Corte Superior de Justicia de Arequipa</p>
  <div class="row">
    <span>WhatsApp (OpenWA)</span>
    <span class="pill ${waStatus.state === 'CONNECTED' ? 'ok' : 'warn'}">
      ${waStatus.state || 'DESCONOCIDO'}
    </span>
  </div>
  <div class="row">
    <span>Backend PLATS</span>
    <span class="pill ok">http</span>
  </div>
  <div class="row">
    <span>Base de datos</span>
    <span class="pill ok">PostgreSQL</span>
  </div>
  <div class="row">
    <span>Webhook</span>
    <span class="pill ok">:3001/webhook</span>
  </div>
  <div class="hint">
    📱 Panel QR de WhatsApp:<br>
    <a href="http://${process.env.HOST || 'localhost'}:8083" target="_blank">
      http://TU_IP:8083
    </a><br><br>
    Escanea el QR desde WhatsApp → Dispositivos vinculados
  </div>
</div></body></html>`);
});

app.get('/health', (_req, res) =>
  res.json({ ok: true, service: 'plats-bot', version: '3.0' })
);

// ── API REST para el frontend — devuelve mismos campos que el backend Java
const db = require('./db');

app.get('/api/agenda/salas', async (_req, res) => {
  try {
    const salas = await db.getSalas();
    res.json(salas);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/agenda/seleccion', async (req, res) => {
  try {
    const TZ = 'America/Lima';
    const fecha = req.query.fecha ||
      new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
    const mov = parseInt(req.query.movimiento || '0');
    let d = new Date(fecha + 'T12:00:00');
    if (mov !== 0) d.setDate(d.getDate() + mov);
    const fechaFinal = d.toLocaleDateString('sv-SE', { timeZone: TZ });
    const audiencias = await db.getAudienciasPorFecha(fechaFinal);
    res.json({
      audiencias: audiencias.map(a => ({
        id:          String(a.id),
        idSala:      a.id_sala,
        nombreSala:  a.sala_nombre,
        descripcion: a.expediente,
        expediente:  a.expediente,
        internos:    a.internos,
        solicitante: a.solicitante,
        inicio:      String(a.inicio).substring(0, 5),
        fin:         String(a.fin).substring(0, 5),
        fecha:       fechaFinal,
        link:        a.link_meet || '',
        accion:      true,
      })),
      fechaTexto: d.toLocaleDateString('es-PE', {
        weekday: 'long', day: 'numeric', month: 'long',
        year: 'numeric', timeZone: TZ
      }),
      fechaSeleccionada: fechaFinal,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/agenda/:id', async (req, res) => {
  try {
    const { rows } = await db.pool.query(
      `SELECT a.*, s.nombre AS sala_nombre FROM audiencias a
       JOIN salas s ON s.id = a.id_sala WHERE a.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    const a = rows[0];
    res.json({
      id: String(a.id), idSala: a.id_sala, fecha: a.fecha,
      inicio: String(a.inicio).substring(0,5),
      fin:    String(a.fin).substring(0,5),
      expediente: a.expediente, internos: a.internos,
      solicitante: a.solicitante, link: a.link_meet || '',
      comunicacion: a.comunicacion, accion: true,
      fechaHoraRegistro: a.agendado_en,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/agenda/evento', async (req, res) => {
  try {
    const b = req.body;
    const sedes = await db.getSedes();
    const juzgados = await db.getJuzgados(b.idSede || sedes[0]?.id);
    const a = await db.crearAudiencia({
      idSala: parseInt(b.idSala), idSede: b.idSede || sedes[0]?.id,
      idJuzgado: parseInt(b.idInstancia) || juzgados[0]?.id,
      idPenal: null, fecha: b.fecha, inicio: b.inicio, fin: b.fin,
      expediente: b.expediente, internos: b.internos, solicitante: b.solicitante,
      comunicacion: b.comunicacion || 'WHATSAPP', linkMeet: b.link || null,
    });
    res.status(201).json({ id: String(a.id), ...b });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/agenda/evento', async (req, res) => {
  try {
    const b = req.body;
    await db.pool.query(
      `UPDATE audiencias SET id_sala=$1, fecha=$2, inicio=$3, fin=$4,
       expediente=$5, internos=$6, solicitante=$7, link_meet=$8 WHERE id=$9`,
      [b.idSala, b.fecha, b.inicio, b.fin, b.expediente,
       b.internos, b.solicitante, b.link || null, b.id]
    );
    res.json({ ok: true, ...b });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/agenda/evento/:id', async (req, res) => {
  try {
    await db.cancelarAudiencia(req.params.id);
    res.status(204).send();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/sede', async (_req, res) => {
  try { res.json(await db.getSedes()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/instancia/:idSede', async (req, res) => {
  try { res.json(await db.getJuzgados(req.params.idSede)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Arranque ──────────────────────────────────────────────────
async function main() {
  logger.info('🏛️ PLATS Bot v3.0 — Corte Superior de Justicia de Arequipa');

  // Conectar BD
  try {
    await conectarDB();
  } catch (err) {
    logger.error({ err }, '❌ No se pudo conectar a PostgreSQL — reintentando en 10s');
    setTimeout(main, 10_000);
    return;
  }

  // Pre-autenticar PLATS
  try { await login(); } catch { logger.warn('Re-auth PLATS al primer request'); }

  // Google Calendar
  initGoogle();

  // Servidor HTTP
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`✅ Bot escuchando en http://0.0.0.0:${PORT}`);
    logger.info(`📱 Panel QR de OpenWA en http://0.0.0.0:8083`);
  });
}

main().catch(err => { logger.fatal({ err }, '💥'); process.exit(1); });
