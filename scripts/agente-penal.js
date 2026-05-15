'use strict';

/**
 * AGENTE PENAL - Instalar en cada equipo del penal
 * 
 * Este pequeño servidor HTTP escucha comandos del bot y abre
 * el navegador con el link de Google Meet automáticamente.
 * 
 * Instalación en el penal:
 *   1. Instalar Node.js
 *   2. npm install express open
 *   3. node agente-penal.js
 *   4. Configurar como servicio de Windows/Linux para que arranque automáticamente
 * 
 * En el .env del servidor principal:
 *   PENAL_AGENTE_SALA_5=http://192.168.1.xxx:4000
 */

const express = require('express');
const { exec } = require('child_process');
const os = require('os');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4000;
const TOKEN = process.env.AGENTE_TOKEN || 'plats2026';

// Middleware de autenticación simple
app.use((req, res, next) => {
  const auth = req.headers['x-token'] || req.query.token;
  if (auth !== TOKEN) return res.status(401).json({ error: 'No autorizado' });
  next();
});

// Abrir URL en el navegador predeterminado
app.post('/abrir-meet', async (req, res) => {
  const { url } = req.body;

  if (!url || !url.startsWith('https://meet.google.com')) {
    return res.status(400).json({ error: 'URL inválida' });
  }

  console.log(`[${new Date().toISOString()}] Abriendo Meet: ${url}`);

  let cmd;
  switch (os.platform()) {
    case 'win32':  cmd = `start chrome "${url}"`; break;
    case 'darwin': cmd = `open "${url}"`; break;
    default:       cmd = `xdg-open "${url}" || chromium-browser "${url}" || google-chrome "${url}"`; break;
  }

  exec(cmd, (err) => {
    if (err) {
      console.error('Error al abrir navegador:', err);
      return res.status(500).json({ error: 'No se pudo abrir el navegador' });
    }
    res.json({ ok: true, url });
  });
});

// Health check
app.get('/ping', (req, res) => res.json({ ok: true, hostname: os.hostname() }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🟢 Agente Penal corriendo en puerto ${PORT}`);
  console.log(`   Hostname: ${os.hostname()}`);
  console.log(`   Token: ${TOKEN}`);
});
