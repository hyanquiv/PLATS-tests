/**
 * session-flow.js
 * Flujo de agendamiento simplificado — solo los campos necesarios.
 *
 * Pasos:
 *  0  → Menú principal
 *  1  → Seleccionar sede
 *  2  → Seleccionar juzgado
 *  3  → Seleccionar fecha
 *  4  → Seleccionar horario (intervalo de slots, ej: 2-4)
 *  5  → Escribir internos       ← VALIDADO con regex
 *  6  → Escribir expediente     ← VALIDADO con regex
 *  7  → Confirmar solicitante   ← Obtenido de usuario WhatsApp o ingresado manualmente
 *  8  → Confirmar resumen
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
 */
async function procesarPaso(phone, textoUsuario) {
  const session = getSession(phone);
  const { paso, datos } = session;

  // ── Paso 5: Internos ──────────────────────────────────────────
  if (paso === 5) {
    const { ok, mensaje } = validar('internos', textoUsuario);
    if (!ok) {
      return {
        respuesta:
          `${mensaje}\n\n` +
          `Escribe el nombre completo del interno o internos.\n` +
          `Ejemplo: _Carlos Mamani Quispe_\n` +
          `Para varios: _Carlos Mamani, Rosa Flores_`,
        siguientePaso: 5,
        datos
      };
    }
    const nombreNorm = normalizarNombre(textoUsuario);
    const nuevosDatos = { ...datos, internos: nombreNorm };
    setSession(phone, { paso: 6, datos: nuevosDatos });
    return {
      respuesta:
        `✅ Interno(s): *${nombreNorm}*\n\n` +
        `📄 *Paso 6 de 7 — Expediente*\n\n` +
        `Escribe el número de expediente.\n` +
        `Formato: _12345-AAAA-00_  (5 dígitos, año, 0 al 99)\n` +
        `Ejemplo: _09167-2025-90_`,
      siguientePaso: 6,
      datos: nuevosDatos
    };
  }

  // ── Paso 6: Expediente ────────────────────────────────────────
  if (paso === 6) {
    const expNorm = normalizarExpediente(textoUsuario);
    const { ok, mensaje } = validar('expediente', expNorm);
    if (!ok) {
      return {
        respuesta:
          `${mensaje}\n\n` +
          `Escribe el expediente en el formato correcto.\n` +
          `Formato: _12345-AAAA-00_\n` +
          `Ejemplo: _09167-2025-90_`,
        siguientePaso: 6,
        datos
      };
    }
    const nuevosDatos = { ...datos, expediente: expNorm };
    setSession(phone, { paso: 7, datos: nuevosDatos });

    // Si ya tenemos el solicitante desde el perfil WhatsApp, saltar al paso 8
    if (nuevosDatos.solicitante) {
      setSession(phone, { paso: 8, datos: nuevosDatos });
      return {
        respuesta:
          `✅ Expediente: *${expNorm}*\n\n` +
          `👤 Solicitante detectado: *${nuevosDatos.solicitante}*\n\n` +
          `¿Es correcto? Responde *SI* para continuar o escribe el nombre correcto.`,
        siguientePaso: 8,
        datos: nuevosDatos
      };
    }

    return {
      respuesta:
        `✅ Expediente: *${expNorm}*\n\n` +
        `👤 *Paso 7 de 7 — Solicitante*\n\n` +
        `Escribe tu nombre completo (quien solicita la audiencia).\n` +
        `Ejemplo: _Dr. Juan Pérez Vargas_`,
      siguientePaso: 7,
      datos: nuevosDatos
    };
  }

  // ── Paso 7: Solicitante (fallback manual) ─────────────────────
  if (paso === 7) {
    const { ok, mensaje } = validar('solicitante', textoUsuario);
    if (!ok) {
      return {
        respuesta:
          `${mensaje}\n\n` +
          `Escribe el nombre del solicitante.\n` +
          `Ejemplo: _Dr. Juan Pérez Vargas_`,
        siguientePaso: 7,
        datos
      };
    }
    const solNorm = normalizarNombre(textoUsuario);
    const nuevosDatos = { ...datos, solicitante: solNorm };
    setSession(phone, { paso: 8, datos: nuevosDatos });
    return {
      respuesta:
        `✅ Solicitante: *${solNorm}*`,
      siguientePaso: 8,
      datos: nuevosDatos,
      mostrarConfirmacion: true
    };
  }

  // ── Paso 8: Confirmar solicitante detectado ───────────────────
  if (paso === 8) {
    const txt = textoUsuario.trim().toUpperCase();
    if (txt === 'SI' || txt === 'SÍ') {
      // Solicitante confirmado, ir a resumen
      return {
        respuesta: null,
        siguientePaso: 8,
        datos,
        mostrarConfirmacion: true
      };
    } else {
      // El usuario quiere cambiar el nombre
      const { ok, mensaje } = validar('solicitante', textoUsuario);
      if (!ok) {
        return {
          respuesta:
            `${mensaje}\n\nEscribe el nombre correcto del solicitante.\n` +
            `Ejemplo: _Dr. Juan Pérez Vargas_\n\nO responde *SI* para confirmar el nombre detectado.`,
          siguientePaso: 8,
          datos
        };
      }
      const solNorm = normalizarNombre(textoUsuario);
      const nuevosDatos = { ...datos, solicitante: solNorm };
      setSession(phone, { paso: 8, datos: nuevosDatos });
      return {
        respuesta: `✅ Solicitante actualizado: *${solNorm}*`,
        siguientePaso: 8,
        datos: nuevosDatos,
        mostrarConfirmacion: true
      };
    }
  }

  return { respuesta: null, siguientePaso: paso, datos };
}

/**
 * Genera el resumen final antes de confirmar.
 */
function generarResumen(datos) {
  const {
    sedeNombre, juzgadoNombre,
    fecha, fechaLabel, inicio, fin,
    internos, expediente, solicitante,
    linkMeet
  } = datos;

  return (
    `📋 *Resumen de la audiencia*\n\n` +
    `🏛️ *Sede:* ${sedeNombre || '—'}\n` +
    `⚖️ *Juzgado:* ${juzgadoNombre || '—'}\n` +
    `📅 *Fecha:* ${fechaLabel || fecha || '—'}\n` +
    `🕐 *Horario:* ${inicio} – ${fin}\n` +
    `👤 *Interno(s):* ${internos || '—'}\n` +
    `📄 *Expediente:* ${expediente || '—'}\n` +
    `🙋 *Solicitante:* ${solicitante || '—'}\n` +
    (linkMeet ? `🎥 *Meet:* _(se generará al confirmar)_\n` : `🎥 *Meet:* _(se generará al confirmar)_\n`) +
    `\n¿Confirmas el agendamiento?`
  );
}

module.exports = {
  getSession,
  setSession,
  clearSession,
  procesarPaso,
  generarResumen,
};
