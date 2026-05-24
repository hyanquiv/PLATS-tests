/**
 * session-flow.js
 * Maneja el estado de la conversación paso a paso por usuario.
 * Cada número de WhatsApp tiene su propio estado independiente.
 *
 * Pasos del flujo:
 *  0  → Menú principal (botones)
 *  1  → Seleccionar sede
 *  2  → Seleccionar juzgado
 *  3  → Seleccionar sala
 *  4  → Seleccionar fecha
 *  5  → Seleccionar horario (solo slots libres)
 *  6  → Escribir internos       ← VALIDADO con regex
 *  7  → Escribir expediente      ← VALIDADO con regex
 *  8  → Seleccionar penal
 *  9  → Confirmar resumen
 */

const NodeCache = require('node-cache');
const { validar, normalizarExpediente, normalizarNombre } = require('./validators');

// Sesiones expiran en 15 minutos de inactividad
const sessions = new NodeCache({ stdTTL: 900, checkperiod: 120 });

function getSession(phone) {
  return sessions.get(phone) || { paso: 0, datos: {} };
}

function setSession(phone, data) {
  sessions.set(phone, data);
}

function clearSession(phone) {
  sessions.del(phone);
}

/**
 * Procesa la respuesta del usuario en el paso actual.
 * Retorna { respuesta, siguientePaso, datos, completado }
 */
async function procesarPaso(phone, textoUsuario) {
  const session = getSession(phone);
  const { paso, datos } = session;

  // ── Paso 6: Internos (texto libre con validación) ─────────────
  if (paso === 6) {
    const { ok, mensaje } = validar('internos', textoUsuario);
    if (!ok) {
      return {
        respuesta:
          `${mensaje}\n\n` +
          `Escribe el nombre completo del interno o internos.\n` +
          `Ejemplo: _Carlos Mamani Quispe_\n` +
          `Para varios: _Carlos Mamani, Rosa Flores_`,
        siguientePaso: 6,
        datos
      };
    }
    const nombreNorm = normalizarNombre(textoUsuario);
    const nuevosDatos = { ...datos, internos: nombreNorm };
    setSession(phone, { paso: 7, datos: nuevosDatos });
    return {
      respuesta:
        `✅ Interno(s): *${nombreNorm}*\n\n` +
        `Ahora escribe el *número de expediente*\n` +
        `Formato: _00000-AAAA-00_\n` +
        `Ejemplo: _09167-2025-90_`,
      siguientePaso: 7,
      datos: nuevosDatos
    };
  }

  // ── Paso 7: Expediente (texto libre con validación) ────────────
  if (paso === 7) {
    const expNorm = normalizarExpediente(textoUsuario);
    const { ok, mensaje } = validar('expediente', expNorm);
    if (!ok) {
      return {
        respuesta:
          `${mensaje}\n\n` +
          `Escribe el expediente en el formato correcto.\n` +
          `Ejemplo: _09167-2025-90_`,
        siguientePaso: 7,
        datos
      };
    }
    const nuevosDatos = { ...datos, expediente: expNorm };
    setSession(phone, { paso: 8, datos: nuevosDatos });
    return {
      respuesta:
        `✅ Expediente: *${expNorm}*\n\n` +
        `Selecciona el *establecimiento penal* del interno:`,
      siguientePaso: 8,
      datos: nuevosDatos,
      mostrarListaPenales: true
    };
  }

  // Para los demás pasos (selectores) el flujo se maneja
  // en commands.js con botones/listas de OpenWA
  return { respuesta: null, siguientePaso: paso, datos };
}

/**
 * Genera el resumen final antes de confirmar.
 */
function generarResumen(datos) {
  const {
    sedeName, juzgadoName, salaName,
    fecha, inicio, fin,
    internos, expediente,
    penalName
  } = datos;

  return (
    `📋 *Resumen de la audiencia*\n\n` +
    `🏛️ *Sede:* ${sedeName}\n` +
    `⚖️ *Juzgado:* ${juzgadoName}\n` +
    `🚪 *Sala:* ${salaName}\n` +
    `📅 *Fecha:* ${fecha}\n` +
    `🕐 *Horario:* ${inicio} – ${fin}\n` +
    `👤 *Interno(s):* ${internos}\n` +
    `📄 *Expediente:* ${expediente}\n` +
    `🏢 *Penal:* ${penalName}\n\n` +
    `¿Confirmas el agendamiento?`
  );
}

module.exports = {
  getSession,
  setSession,
  clearSession,
  procesarPaso,
  generarResumen,
};
