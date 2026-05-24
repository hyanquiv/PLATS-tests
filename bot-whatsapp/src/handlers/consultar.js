/**
 * handlers/consultar.js
 * Consulta de agenda del día y búsqueda por expediente.
 * Envía la agenda como imagen PNG + texto resumen.
 */
const wa     = require('../openwa-client');
const db     = require('../db');
const { generarImagenAgenda } = require('../agenda-image');
const logger = require('../logger');

function todayPeru() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Lima' });
}

function fechaLabel(fecha) {
  return new Date(fecha + 'T12:00:00').toLocaleDateString('es-PE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'America/Lima',
  });
}

// ── Agenda del día como imagen ────────────────────────────────
async function enviarAgendaHoy(phone, fecha = null) {
  const f = fecha || todayPeru();
  await wa.sendText(phone, `⏳ Generando agenda del ${fechaLabel(f)}...`);

  try {
    const [audiencias, salas] = await Promise.all([
      db.getAudienciasPorFecha(f),
      db.getSalas(),
    ]);

    if (audiencias.length === 0) {
      await wa.sendButtons(phone, {
        title: `📅 ${fechaLabel(f)}`,
        body:  '✨ No hay audiencias programadas para este día.',
        buttons: [
          { id: 'menu_agendar', text: '📅 Agendar audiencia' },
          { id: 'menu_inicio',  text: '🏠 Menú principal'    },
        ],
      });
      return;
    }

    // Generar imagen
    const imgBuffer = await generarImagenAgenda(audiencias, f, salas);
    const base64    = imgBuffer.toString('base64');

    // Enviar imagen
    await wa.sendImage(
      phone,
      base64,
      `📅 Agenda del ${fechaLabel(f)} — ${audiencias.length} audiencia${audiencias.length !== 1 ? 's' : ''}`
    );

    // Enviar también resumen en texto (más fácil de copiar)
    const resumen = audiencias.map(a =>
      `${a.inicio}–${a.fin} | ${a.sala_nombre}\n` +
      `EXP. ${a.expediente}  •  ${a.internos}`
    ).join('\n\n');

    await wa.sendText(phone,
      `📋 *Resumen ${fechaLabel(f)}*\n\n${resumen}`
    );

  } catch (err) {
    logger.error({ err }, 'Error generando agenda');
    await wa.sendText(phone, `❌ Error generando la agenda: ${err.message}`);
  }
}

// ── Buscar por expediente ─────────────────────────────────────
async function consultarExpediente(phone, expediente) {
  await wa.sendText(phone, `🔍 Buscando expediente *${expediente}*...`);

  try {
    const audiencias = await db.getAudienciaPorExpediente(expediente);

    if (audiencias.length === 0) {
      await wa.sendButtons(phone, {
        title: `🔍 EXP. ${expediente}`,
        body:  'No se encontraron audiencias con ese expediente.',
        buttons: [
          { id: 'menu_agendar', text: '📅 Agendar nueva'   },
          { id: 'menu_inicio',  text: '🏠 Menú principal'  },
        ],
      });
      return;
    }

    const texto = audiencias.map(a =>
      `📄 *EXP. ${a.expediente}*\n` +
      `🏛️ ${a.sala_nombre} | ⚖️ ${a.juzgado_nombre}\n` +
      `📅 ${a.fecha} | 🕐 ${a.inicio}–${a.fin}\n` +
      `👤 ${a.internos}\n` +
      `🏢 ${a.penal_nombre || '—'}\n` +
      (a.link_meet ? `🎥 ${a.link_meet}` : '🎥 Sin Meet') +
      `\n🆔 ID: ${a.id}`
    ).join('\n\n─────────────\n\n');

    await wa.sendText(phone,
      `🔍 *Resultados para ${expediente}*\n` +
      `(${audiencias.length} encontrada${audiencias.length !== 1 ? 's' : ''})\n\n${texto}`
    );

  } catch (err) {
    logger.error({ err }, 'Error consultando expediente');
    await wa.sendText(phone, `❌ Error buscando el expediente: ${err.message}`);
  }
}

// ── Selector de fecha para consulta ──────────────────────────
async function menuConsultar(phone) {
  await wa.sendButtons(phone, {
    title: '🔍 Consultar agenda',
    body:  '¿Qué deseas consultar?',
    buttons: [
      { id: 'consulta_hoy',       text: '📅 Agenda de hoy'      },
      { id: 'consulta_expediente',text: '🔍 Buscar expediente'   },
      { id: 'menu_inicio',        text: '🏠 Menú principal'      },
    ],
  });
}

async function pedirExpediente(phone) {
  const { setSession } = require('../utils/session-flow');
  setSession(phone, { paso: 'esperando_expediente', datos: {} });
  await wa.sendText(phone,
    `🔍 *Buscar por expediente*\n\n` +
    `Escribe el número de expediente:\n` +
    `Formato: _00000-AAAA-00_\n` +
    `Ejemplo: _09167-2025-90_`
  );
}

module.exports = {
  enviarAgendaHoy,
  consultarExpediente,
  menuConsultar,
  pedirExpediente,
};
