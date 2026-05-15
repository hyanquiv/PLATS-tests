'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

// Mapa de sala PLATS → Device ID de RustDesk en el penal
// Se configura en .env como: PENAL_DEVICES=1:ABC123,2:DEF456
function getDeviceMap() {
  const map = {};
  const raw = process.env.PENAL_DEVICES || '';
  raw.split(',').forEach(pair => {
    const [sala, device] = pair.split(':');
    if (sala && device) map[sala.trim()] = device.trim();
  });
  return map;
}

/**
 * Envía comando al servidor RustDesk para que el equipo del penal
 * abra automáticamente el link de Meet en el navegador.
 *
 * Requiere tener un agente HTTP liviano corriendo en el penal que
 * escuche comandos (ver scripts/agente-penal.js).
 */
async function abrirMeetEnPenal(idSala, meetLink) {
  const deviceMap = getDeviceMap();
  const deviceId = deviceMap[String(idSala)];

  if (!deviceId) {
    logger.warn({ idSala }, 'No hay dispositivo RustDesk configurado para esta sala');
    return { ok: false, msg: 'Sin dispositivo configurado' };
  }

  try {
    // Opción A: API del servidor RustDesk (si tienen relay propio con API habilitada)
    if (process.env.RUSTDESK_API_URL) {
      const res = await axios.post(
        `${process.env.RUSTDESK_API_URL}/api/command`,
        {
          device_id: deviceId,
          command: 'open_url',
          params: { url: meetLink }
        },
        {
          headers: { Authorization: `Bearer ${process.env.RUSTDESK_TOKEN}` },
          timeout: 8000
        }
      );
      logger.info({ idSala, deviceId, meetLink }, '✅ Comando enviado a penal via RustDesk API');
      return { ok: true, deviceId };
    }

    // Opción B: Agente HTTP liviano directo en el penal (ver agente-penal.js)
    const agenteUrl = process.env[`PENAL_AGENTE_SALA_${idSala}`];
    if (agenteUrl) {
      await axios.post(`${agenteUrl}/abrir-meet`, { url: meetLink }, { timeout: 8000 });
      logger.info({ idSala, agenteUrl }, '✅ Meet abierto via agente penal');
      return { ok: true };
    }

    return { ok: false, msg: 'No hay método de conexión al penal configurado' };

  } catch (err) {
    logger.error({ err, idSala }, '❌ Error al enviar comando al penal');
    return { ok: false, msg: err.message };
  }
}

module.exports = { abrirMeetEnPenal };
