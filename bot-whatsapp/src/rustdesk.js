/**
 * rustdesk.js
 * Envía comandos a los equipos de los penales para abrir Google Meet automáticamente.
 *
 * Estrategia A (recomendada): API HTTP de RustDesk Server Pro
 * Estrategia B (fallback): Script PowerShell/bash via SSH al equipo del penal
 *
 * Los equipos del penal deben tener instalado el agente ligero:
 *   penal-agent.js  (incluido más abajo en este archivo como referencia)
 */

const axios = require('axios');
const logger = require('./logger');

// Mapa de penales conocidos: { nombre -> { rustdeskId, ip, agentPort } }
// Editar según la infraestructura real
const PENALES = {
  'SOCABAYA':    { rustdeskId: '100001', ip: '172.28.1.10', agentPort: 3002 },
  'YARABAMBA':   { rustdeskId: '100002', ip: '172.28.1.11', agentPort: 3002 },
  'QOCHAPAMPA':  { rustdeskId: '100003', ip: '172.28.1.12', agentPort: 3002 },
  // Agregar más según necesidad
};

/**
 * Envía el enlace de Meet al agente del penal para que lo abra automáticamente.
 * El agente es un proceso Node.js liviano en el equipo del penal.
 */
async function conectarPenal(nombrePenal, linkMeet, expediente) {
  const penal = PENALES[nombrePenal.toUpperCase()];
  if (!penal) {
    logger.warn({ nombrePenal }, '⚠️  Penal no configurado en el mapa');
    return { ok: false, error: `Penal "${nombrePenal}" no configurado` };
  }

  try {
    // Intentar via agente HTTP ligero primero
    const res = await axios.post(`http://${penal.ip}:${penal.agentPort}/abrir-meet`, {
      link: linkMeet,
      expediente,
      timestamp: new Date().toISOString()
    }, { timeout: 8000 });

    logger.info({ nombrePenal, linkMeet }, '🔗 Meet enviado al penal');
    return { ok: true, respuesta: res.data };

  } catch (err) {
    logger.warn({ err, nombrePenal }, '⚠️  No se pudo conectar con agente del penal');

    // Fallback: intentar via API RustDesk Server Pro si está configurado
    if (process.env.RUSTDESK_API_URL && process.env.RUSTDESK_API_KEY) {
      return await abrirViRustdeskApi(penal, linkMeet, expediente);
    }
    return { ok: false, error: err.message };
  }
}

async function abrirViRustdeskApi(penal, linkMeet, expediente) {
  try {
    await axios.post(`${process.env.RUSTDESK_API_URL}/api/connect`, {
      id: penal.rustdeskId,
      action: 'run_command',
      command: process.platform === 'win32'
        ? `start "" "${linkMeet}"`
        : `xdg-open "${linkMeet}"`
    }, {
      headers: { 'Authorization': `Bearer ${process.env.RUSTDESK_API_KEY}` },
      timeout: 10000
    });
    logger.info({ penal: penal.rustdeskId, linkMeet }, '🔗 Meet abierto via RustDesk API');
    return { ok: true };
  } catch (err) {
    logger.error({ err }, '❌ Error via RustDesk API');
    return { ok: false, error: err.message };
  }
}

function listaPenales() {
  return Object.keys(PENALES);
}

module.exports = { conectarPenal, listaPenales };

/* ─────────────────────────────────────────────────────────────────────────────
   AGENTE LIGERO PARA EL EQUIPO DEL PENAL
   Guardar como penal-agent.js en cada equipo del penal y ejecutar con:
     node penal-agent.js          (en Linux/Windows)
   
   O como servicio:
     pm2 start penal-agent.js --name penal-agent
   ─────────────────────────────────────────────────────────────────────────── */
/*
const express = require('express');
const { exec } = require('child_process');
const app = express();
app.use(express.json());

app.post('/abrir-meet', (req, res) => {
  const { link, expediente } = req.body;
  console.log(`[${new Date().toISOString()}] Abriendo Meet: ${link} (EXP: ${expediente})`);

  // Abrir en el navegador predeterminado
  const cmd = process.platform === 'win32'
    ? `start "" "${link}"`                              // Windows
    : `xdg-open "${link}" || google-chrome "${link}"`;  // Linux

  exec(cmd, (err) => {
    if (err) {
      console.error('Error al abrir navegador:', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
    res.json({ ok: true, mensaje: 'Meet abierto en navegador' });
  });
});

app.listen(3002, '0.0.0.0', () => {
  console.log('Agente penal escuchando en :3002');
});
*/
