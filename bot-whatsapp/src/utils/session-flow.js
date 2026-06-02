/**
 * session-flow.js
 * Maneja el estado de la conversación paso a paso por usuario.
 * Cada número de WhatsApp tiene su propio estado independiente.
 *
 * Pasos del flujo:
 *  0  → Menú principal (botones)
 *  1  → Sede solicitante (lista)
 *  2  → Juzgado (lista, filtrada por sede)
 *  3  → Sala (lista)
 *  4  → Fecha (lista: próximos 7 días)
 *  5  → Horario como INTERVALO de slots (ej: "2-4")
 *         — muestra la lista numerada de slots disponibles
 *         — el usuario responde con dos números "X-Y"
 *  6  → Internos (texto libre, validado con regex internos)
 *  7  → Expediente (texto libre, validado con regex expediente)
 *  8  → Penal (lista con email_calendar)
 *  9  → Confirmar (botones: Confirmar / Cancelar)
 */

const NodeCache = require('node-cache');
const { validar, normalizarExpediente, normalizarNombre, parsearIntervaloHorario } = require('./validators');

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

  // ── Paso 5: Horario por intervalo (texto libre con slots numerados) ─────────
  if (paso === 5) {
    const slots = Array.isArray(datos._slots) ? datos._slots : [];
    const { ok, inicio, fin } = parsearIntervaloHorario(textoUsuario, slots.length);
    if (!ok || !slots.length) {
      const lineas = ['Formato inválido. Responde con el intervalo deseado usando los números de los slots:'];
      slots.forEach((s, i) => lineas.push(`${i + 1}. ${s.inicio} – ${s.fin}`));
      lineas.push('Ej: `2-4` = desde el slot 2 hasta el slot 4.');
      return {
        respuesta: lineas.join('
'),
        siguientePaso: 5,
        datos
      };
    }
    const nuevosDatos = {
      ...datos,
      inicio: slots[inicio].inicio,
      fin:    slots[fin].fin,
    };
    setSession(phone, { paso: 6, datos: nuevosDatos });
    return {
      respuesta:
        `✅ Horario seleccionado: *${slots[inicio].inicio} – ${slots[fin].fin}*

` +
        `Ahora escribe el nombre completo del interno o internos.
` +
        `Ejemplo: _Carlos Mamani Quispe_
` +
        `Para varios: _Carlos Mamani, Rosa Flores_`,
      siguientePaso: 6,
      datos: nuevosDatos
    };
  }

  // ── Paso 6: Internos (texto libre con validación) ─────────────
  if (paso === 6) {
    const { ok, mensaje } = validar('internos', textoUsuario);
    if (!ok) {
      return {
        respuesta:
          `${mensaje}

` +
          `Escribe el nombre completo del interno o internos.
` +
          `Ejemplo: _Carlos Mamani Quispe_
` +
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
        `✅ Interno(s): *${nombreNorm}*

` +
        `Ahora escribe el *número de expediente*
` +
        `Formato: _00000-AAAA-00_
` +
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
          `${mensaje}

` +
          `Escribe el expediente en el formato correcto.
` +
          `Ejemplo: _09167-2025-90_`,
        siguientePaso: 7,
        datos
      };
    }
    const nuevosDatos = { ...datos, expediente: expNorm };
    setSession(phone, { paso: 8, datos: nuevosDatos });
    return {
      respuesta:
        `✅ Expediente: *${expNorm}*

` +
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
    penalName, emailPenal, linkMeet
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
    `🏢 *Penal:* ${penalName}\n` +
    `📧 *Penal (Google Calendar):* ${emailPenal || '—'}\n` +
    `🔗 *Meet:* ${linkMeet || '(se generará automáticamente)'}\n\n` +
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
